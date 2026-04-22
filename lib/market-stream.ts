import { fetchMassiveStockSnapshots, getMassiveApiKey } from "./providers/massive";
import { getDynamicMarketUniverse } from "./market-universe";
import type { QuoteFetchResult, QuoteSnapshot, QuoteState, QuoteFetchSummary, QuoteFreshness } from "./market-data";
import type { WatchlistTicker } from "./watchlist";
import type { VolumeSnapshot } from "./volume-data";

type StreamConnectionState = "idle" | "connecting" | "connected" | "disconnected" | "degraded";

type SymbolLiveState = {
  ticker: string;
  price: number;
  changePercent: number;
  lastUpdated: string;
  currentVolume: number | null;
  averageVolume: number | null;
  provider: "massive";
};

type MarketStreamHealth = {
  status: StreamConnectionState;
  connected: boolean;
  realtime: boolean;
  mode: "realtime" | "delayed" | "unknown";
  lastMessageAt: string | null;
  lastBootstrapAt: string | null;
  lastForcedDisconnectAt: string | null;
  subscribedSymbolCount: number;
  activeUniverseSize: number;
  snapshotSymbolCount: number;
  messagesPerMinute: number;
  reconnectCount: number;
  streamStarted: boolean;
  uptimeMs: number;
  reconnectScheduled: boolean;
  stale: boolean;
  degraded: boolean;
};

type DynamicUniverseState = {
  symbols: WatchlistTicker[];
  lastRefreshedAt: number;
  source: "live" | "cache" | "fallback_empty";
  reasonsBySymbol: Record<string, string>;
  topSymbols: string[];
  discoveredCount: number;
  selectedCount: number;
};

const WS_ENDPOINT = process.env.MASSIVE_WS_URL?.trim() || "wss://socket.massive.com/stocks";
const STREAM_STALE_AFTER_MS = 20_000;
const STREAM_HEALTH_INTERVAL_MS = 5_000;
const UNIVERSE_REFRESH_MS = 60_000;
const BOOTSTRAP_REFRESH_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const UNIVERSE_CAP = 50;

const symbolState = new Map<string, SymbolLiveState>();
const messageTimestamps: number[] = [];
const subscribedSymbols = new Set<string>();

let streamSocket: WebSocket | null = null;
let started = false;
let streamState: StreamConnectionState = "idle";
let reconnectCount = 0;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastMessageAt = 0;
let lastBootstrapAt = 0;
let lastForcedDisconnectAt = 0;
let streamStartedAt = 0;
let inBootstrap = false;
let dynamicUniverse: DynamicUniverseState = {
  symbols: [],
  lastRefreshedAt: 0,
  source: "fallback_empty",
  reasonsBySymbol: {},
  topSymbols: [],
  discoveredCount: 0,
  selectedCount: 0,
};

function nowIso() {
  return new Date().toISOString();
}

function cleanupOldMessageTimestamps(now = Date.now()) {
  while (messageTimestamps.length > 0 && now - messageTimestamps[0] > 60_000) {
    messageTimestamps.shift();
  }
}

function markMessageReceived() {
  const now = Date.now();
  lastMessageAt = now;
  messageTimestamps.push(now);
  cleanupOldMessageTimestamps(now);
}

function parseNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function updateSymbolState(partial: {
  ticker: string;
  price?: number | null;
  changePercent?: number | null;
  timestamp?: string | null;
  currentVolume?: number | null;
  averageVolume?: number | null;
}) {
  const ticker = partial.ticker.trim().toUpperCase();
  if (!ticker) return;

  const existing = symbolState.get(ticker);
  const price = partial.price ?? existing?.price ?? null;
  const changePercent = partial.changePercent ?? existing?.changePercent ?? null;
  if (price === null || changePercent === null) {
    return;
  }

  symbolState.set(ticker, {
    ticker,
    price,
    changePercent,
    lastUpdated: partial.timestamp ?? existing?.lastUpdated ?? nowIso(),
    currentVolume:
      partial.currentVolume !== undefined ? partial.currentVolume : existing?.currentVolume ?? null,
    averageVolume:
      partial.averageVolume !== undefined ? partial.averageVolume : existing?.averageVolume ?? null,
    provider: "massive",
  });
}

function parsePotentialTickUpdate(payload: unknown): Array<{
  ticker: string;
  price?: number | null;
  changePercent?: number | null;
  timestamp?: string | null;
  currentVolume?: number | null;
}> {
  if (!payload) return [];
  const rows = Array.isArray(payload) ? payload : [payload];
  const updates: Array<{
    ticker: string;
    price?: number | null;
    changePercent?: number | null;
    timestamp?: string | null;
    currentVolume?: number | null;
  }> = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const entry = row as Record<string, unknown>;
    const tickerRaw = entry.sym ?? entry.symbol ?? entry.ticker;
    const ticker = typeof tickerRaw === "string" ? tickerRaw.trim().toUpperCase() : "";
    if (!ticker) continue;

    const price = parseNumber(entry.p) ?? parseNumber(entry.price) ?? parseNumber(entry.c);
    const changePercent = parseNumber(entry.dp) ?? parseNumber(entry.changePercent) ?? parseNumber(entry.todaysChangePerc);
    const currentVolume = parseNumber(entry.v) ?? parseNumber(entry.volume) ?? parseNumber(entry.dayVolume);
    const timestampRaw = parseNumber(entry.t) ?? parseNumber(entry.timestamp);
    const timestamp =
      timestampRaw !== null
        ? new Date(timestampRaw > 9_999_999_999_999 ? Math.floor(timestampRaw / 1_000_000) : timestampRaw).toISOString()
        : nowIso();

    updates.push({
      ticker,
      price,
      changePercent,
      timestamp,
      currentVolume,
    });
  }

  return updates;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectCount += 1;
  reconnectAttempt += 1;
  const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, reconnectAttempt - 1));
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectSocket();
  }, backoff);
}

function closeSocket() {
  if (!streamSocket) return;
  try {
    streamSocket.close();
  } catch {
    // ignore
  }
  streamSocket = null;
}

function buildSubscribePayload() {
  const symbols = [...subscribedSymbols];
  if (!symbols.length) return null;
  // Massive socket payloads differ by account tier; send broad-compatible shapes.
  return [
    { action: "subscribe", params: symbols.map((ticker) => `T.${ticker}`).join(",") },
    { action: "subscribe", symbols },
  ];
}

function sendAuthAndSubscribe() {
  if (!streamSocket || streamSocket.readyState !== WebSocket.OPEN) return;
  const key = getMassiveApiKey();
  if (!key) return;
  const payloads = [
    { action: "auth", params: key },
    { action: "authenticate", apiKey: key },
  ];
  for (const payload of payloads) {
    try {
      streamSocket.send(JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  const subscribePayloads = buildSubscribePayload();
  if (!subscribePayloads) return;
  for (const payload of subscribePayloads) {
    try {
      streamSocket.send(JSON.stringify(payload));
    } catch {
      // ignore
    }
  }
}

async function connectSocket() {
  if (streamSocket || streamState === "connecting") return;
  const key = getMassiveApiKey();
  if (!key) {
    streamState = "degraded";
    return;
  }

  streamState = "connecting";
  try {
    streamSocket = new WebSocket(WS_ENDPOINT);
  } catch {
    streamState = "degraded";
    streamSocket = null;
    scheduleReconnect();
    return;
  }

  streamSocket.addEventListener("open", () => {
    streamState = "connected";
    reconnectAttempt = 0;
    sendAuthAndSubscribe();
  });

  streamSocket.addEventListener("message", (event) => {
    markMessageReceived();
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(event.data));
    } catch {
      return;
    }
    const updates = parsePotentialTickUpdate(parsed);
    for (const update of updates) {
      updateSymbolState(update);
    }
  });

  const onDisconnect = () => {
    closeSocket();
    streamState = "disconnected";
    scheduleReconnect();
  };

  streamSocket.addEventListener("error", onDisconnect);
  streamSocket.addEventListener("close", onDisconnect);
}

async function refreshUniverse() {
  const discovered = await getDynamicMarketUniverse({
    cap: UNIVERSE_CAP,
  });
  dynamicUniverse = {
    symbols: discovered.candidates,
    lastRefreshedAt: Date.now(),
    source: discovered.source,
    reasonsBySymbol: discovered.reasonsBySymbol,
    topSymbols: discovered.topSymbols,
    discoveredCount: discovered.discoveredCount,
    selectedCount: discovered.selectedCount,
  };

  subscribedSymbols.clear();
  for (const symbol of discovered.candidates) {
    subscribedSymbols.add(symbol.ticker);
  }
  sendAuthAndSubscribe();
}

async function bootstrapQuotes() {
  if (inBootstrap) return;
  if (subscribedSymbols.size === 0) return;
  inBootstrap = true;
  try {
    const response = await fetchMassiveStockSnapshots([...subscribedSymbols]);
    const payload = response.payload as { tickers?: Array<Record<string, unknown>> };
    if (!Array.isArray(payload.tickers)) return;

    for (const row of payload.tickers) {
      const ticker = typeof row.ticker === "string" ? row.ticker.trim().toUpperCase() : "";
      if (!ticker) continue;
      const price =
        parseNumber(row.lastTrade && (row.lastTrade as Record<string, unknown>).p) ??
        parseNumber(row.day && (row.day as Record<string, unknown>).c);
      const changePercent = parseNumber(row.todaysChangePerc);
      const dayVolume = parseNumber(row.day && (row.day as Record<string, unknown>).v);
      const prevVolume = parseNumber(row.prevDay && (row.prevDay as Record<string, unknown>).v);
      const averageVolume = prevVolume !== null && prevVolume > 0 ? prevVolume : null;
      updateSymbolState({
        ticker,
        price,
        changePercent,
        currentVolume: dayVolume,
        averageVolume,
        timestamp: nowIso(),
      });
    }
    lastBootstrapAt = Date.now();
  } catch {
    streamState = streamState === "connected" ? "connected" : "degraded";
  } finally {
    inBootstrap = false;
  }
}

function monitorStreamHealth() {
  const now = Date.now();
  cleanupOldMessageTimestamps(now);
  if (streamState === "connected" && lastMessageAt > 0 && now - lastMessageAt > STREAM_STALE_AFTER_MS) {
    streamState = "degraded";
    closeSocket();
    scheduleReconnect();
  }
}

export async function startMarketStream() {
  if (started) return;
  started = true;
  streamStartedAt = Date.now();

  try {
    await refreshUniverse();
    await bootstrapQuotes();
  } catch {
    // keep degraded fallback, timers still run.
  }

  await connectSocket();

  setInterval(() => {
    void refreshUniverse();
  }, UNIVERSE_REFRESH_MS);

  setInterval(() => {
    void bootstrapQuotes();
  }, BOOTSTRAP_REFRESH_MS);

  setInterval(() => {
    monitorStreamHealth();
  }, STREAM_HEALTH_INTERVAL_MS);
}

function freshnessFromTimestamp(timestamp: string): QuoteFreshness {
  const ageMs = Math.max(0, Date.now() - new Date(timestamp).getTime());
  if (ageMs <= 20_000) return "fresh";
  if (ageMs <= 60_000) return "cached";
  return "stale";
}

export function getSymbolSnapshot(symbol: string): QuoteSnapshot | null {
  const entry = symbolState.get(symbol.trim().toUpperCase());
  if (!entry) return null;
  return {
    ticker: entry.ticker,
    price: entry.price,
    changePercent: entry.changePercent,
    timestamp: entry.lastUpdated,
    lastUpdated: entry.lastUpdated,
    freshness: freshnessFromTimestamp(entry.lastUpdated),
    provider: "massive",
  };
}

export function getMarketSnapshot(tickers?: string[]) {
  const selected = tickers && tickers.length > 0 ? tickers : [...subscribedSymbols];
  const quotes = selected
    .map((ticker) => getSymbolSnapshot(ticker))
    .filter((quote): quote is QuoteSnapshot => Boolean(quote));
  const quoteStates: Record<string, QuoteState> = {};
  const summary: QuoteFetchSummary = {
    requested: selected.length,
    fresh: 0,
    cached: 0,
    stale: 0,
    failed: 0,
    servedFromCache: 0,
    fetchedFromMassive: quotes.length,
    fetchedFromFinnhub: 0,
    fetchedFromTwelveData: 0,
  };

  const quoteMap = new Map(quotes.map((quote) => [quote.ticker, quote]));
  for (const ticker of selected) {
    const normalized = ticker.trim().toUpperCase();
    const quote = quoteMap.get(normalized);
    if (!quote) {
      summary.failed += 1;
      quoteStates[normalized] = {
        ticker: normalized,
        available: false,
        freshness: "missing",
        lastUpdated: null,
        provider: null,
      };
      continue;
    }

    if (quote.freshness === "fresh") summary.fresh += 1;
    if (quote.freshness === "cached") {
      summary.cached += 1;
      summary.servedFromCache += 1;
    }
    if (quote.freshness === "stale") summary.stale += 1;

    quoteStates[normalized] = {
      ticker: normalized,
      available: true,
      freshness: quote.freshness,
      lastUpdated: quote.lastUpdated,
      provider: quote.provider,
    };
  }

  return {
    quotes,
    summary,
    quoteStates,
    cacheTtlMs: 20_000,
    staleAfterMs: 60_000,
    refreshBatchSize: Math.min(10, Math.max(1, selected.length)),
    degraded: streamState !== "connected" && streamState !== "connecting",
  };
}

export function getDynamicUniverse() {
  return {
    symbols: dynamicUniverse.symbols,
    source: dynamicUniverse.source,
    reasonsBySymbol: dynamicUniverse.reasonsBySymbol,
    topSymbols: dynamicUniverse.topSymbols,
    discoveredCount: dynamicUniverse.discoveredCount,
    selectedCount: dynamicUniverse.selectedCount,
  };
}

export function getVolumeSnapshotsForSymbols(tickers: string[]): VolumeSnapshot[] {
  const snapshots: VolumeSnapshot[] = [];
  for (const ticker of tickers) {
    const entry = symbolState.get(ticker.trim().toUpperCase());
    if (!entry) continue;
    if (entry.currentVolume === null) continue;
    const averageVolume = entry.averageVolume ?? null;
    if (averageVolume === null || averageVolume <= 0) continue;
    snapshots.push({
      ticker: entry.ticker,
      company: entry.ticker,
      price: entry.price,
      changePercent: entry.changePercent,
      currentVolume: entry.currentVolume,
      averageVolume,
      recentBars: [],
      lastUpdated: entry.lastUpdated,
      freshness: freshnessFromTimestamp(entry.lastUpdated),
    });
  }
  return snapshots;
}

export function getMarketStreamHealth(): MarketStreamHealth {
  const now = Date.now();
  cleanupOldMessageTimestamps(now);
  const stale = lastMessageAt > 0 ? now - lastMessageAt > STREAM_STALE_AFTER_MS : started && streamState !== "connecting";
  const degraded = streamState === "degraded" || streamState === "disconnected" || (streamState === "connected" && stale);
  const mode: MarketStreamHealth["mode"] =
    streamState === "connected" && !stale
      ? "realtime"
      : streamState !== "idle" && symbolState.size > 0
        ? "delayed"
        : "unknown";

  return {
    status: streamState,
    connected: streamState === "connected",
    realtime: streamState === "connected" && !stale,
    mode,
    lastMessageAt: lastMessageAt ? new Date(lastMessageAt).toISOString() : null,
    lastBootstrapAt: lastBootstrapAt ? new Date(lastBootstrapAt).toISOString() : null,
    lastForcedDisconnectAt: lastForcedDisconnectAt ? new Date(lastForcedDisconnectAt).toISOString() : null,
    subscribedSymbolCount: subscribedSymbols.size,
    activeUniverseSize: dynamicUniverse.symbols.length,
    snapshotSymbolCount: symbolState.size,
    messagesPerMinute: messageTimestamps.length,
    reconnectCount,
    streamStarted: started,
    uptimeMs: streamStartedAt ? Math.max(0, now - streamStartedAt) : 0,
    reconnectScheduled: reconnectTimer !== null,
    stale,
    degraded,
  };
}

export function forceMarketStreamReconnectForDebug() {
  if (process.env.NODE_ENV === "production") {
    return {
      ok: false,
      reason: "disabled_in_production",
      health: getMarketStreamHealth(),
    } as const;
  }

  if (!started) {
    return {
      ok: false,
      reason: "stream_not_started",
      health: getMarketStreamHealth(),
    } as const;
  }

  lastForcedDisconnectAt = Date.now();
  streamState = "disconnected";
  closeSocket();
  scheduleReconnect();

  return {
    ok: true,
    reason: "reconnect_triggered",
    health: getMarketStreamHealth(),
  } as const;
}

export function getQuoteFetchResultFromStream(tickers: string[]): QuoteFetchResult {
  const snapshot = getMarketSnapshot(tickers);
  return {
    ok: true,
    quotes: snapshot.quotes,
    degraded: false,
    summary: snapshot.summary,
    quoteStates: snapshot.quoteStates,
    cacheTtlMs: snapshot.cacheTtlMs,
    staleAfterMs: snapshot.staleAfterMs,
    refreshBatchSize: snapshot.refreshBatchSize,
  };
}
