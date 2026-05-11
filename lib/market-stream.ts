import { fetchMassiveRecentIntradayForSymbols, fetchMassiveStockSnapshots, getMassiveApiKey } from "./providers/massive";
import { getDynamicMarketUniverse } from "./market-universe";
import type { QuoteFetchResult, QuoteSnapshot, QuoteState, QuoteFetchSummary, QuoteFreshness } from "./market-data";
import { consumeRateLimitToken } from "./request-rate-limiter";
import { getSignalRuntimeConfig } from "./signal-runtime-config";
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
  dayHigh: number | null;
  dayLow: number | null;
  minuteBucket: string | null;
  minuteOpen: number | null;
  minuteHigh: number | null;
  minuteLow: number | null;
  minuteClose: number | null;
  minuteVolume: number | null;
  previousMinuteHigh: number | null;
  previousMinuteLow: number | null;
  previousMinuteVolume: number | null;
  oneMinuteChangePercent: number | null;
  fiveMinuteChangePercent: number | null;
  greenCandleCount: number | null;
  breakoutAboveRecentHigh: boolean;
  sma5: number | null;
  sma10: number | null;
  smaMomentumConfirmed: boolean;
  provider: "massive";
};

export type SymbolIntradayState = {
  ticker: string;
  dayHigh: number | null;
  dayLow: number | null;
  lastPrice: number;
  lastUpdated: string;
  previousMinuteHigh: number | null;
  previousMinuteLow: number | null;
  currentMinuteHigh: number | null;
  currentMinuteLow: number | null;
  currentMinuteVolume: number | null;
  previousMinuteVolume: number | null;
  oneMinuteChangePercent: number | null;
  fiveMinuteChangePercent: number | null;
  greenCandleCount: number | null;
  breakoutAboveRecentHigh: boolean;
  sma5: number | null;
  sma10: number | null;
  smaMomentumConfirmed: boolean;
};

type MarketStreamHealth = {
  status: StreamConnectionState;
  connected: boolean;
  authenticated?: boolean;
  subscribed?: boolean;
  realtime: boolean;
  mode: "realtime" | "delayed" | "unknown";
  lastMessageAt: string | null;
  lastWebSocketConnectAt: string | null;
  lastBootstrapAt: string | null;
  lastForcedDisconnectAt: string | null;
  subscribedSymbolCount: number;
  subscribedTradeCount: number;
  subscribedAggregateCount: number;
  activeUniverseSize: number;
  snapshotSymbolCount: number;
  messagesPerMinute: number;
  reconnectCount: number;
  streamStarted: boolean;
  uptimeMs: number;
  reconnectScheduled: boolean;
  reconnecting: boolean;
  inBootstrap: boolean;
  rateBudgetLimited: boolean;
  lastRateBudgetLimitedAt: string | null;
  stale: boolean;
  degraded: boolean;
  wsMessagesReceived: number;
  wsUpdatesApplied: number;
  snapshotUpdatesApplied: number;
  lastWsUpdateAt: string | null;
  lastTradeAt: string | null;
  lastAggregateAt: string | null;
  lastSnapshotUpdateAt: string | null;
  wsMessageSamples: Array<{
    messageType: string;
    keys: string[];
    updatesParsed: number;
  }>;
  statusOnlyStream: boolean;
  aggregateUnauthorized: boolean;
  appStartedAt: string | null;
  lastDiscoveryAt: string | null;
  lastDiscoveryStatus: string | null;
  lastUniverseCount: number;
  startup: {
    massiveKeyConfigured: boolean;
    discoveryAttempted: boolean;
    websocketAttempted: boolean;
  };
  degradedReason?: string | null;
};

type DynamicUniverseState = {
  symbols: WatchlistTicker[];
  lastRefreshedAt: number;
  source: "live" | "cache" | "fallback_empty";
  reasonsBySymbol: Record<string, string>;
  topSymbols: string[];
  discoveredCount: number;
  selectedCount: number;
  discoveredBeforeFilters: number;
  scannerThresholds: {
    minPrice: number;
    maxPrice: number;
    minVolume: number;
    minRelativeVolume: number;
    minAbsChangePercent: number;
    bullishOnly: boolean;
  };
  rejectionReasonCounts: Record<string, number>;
  topCandidates: Array<{
    ticker: string;
    price: number;
    changePercent: number;
    currentVolume: number;
    relativeVolume: number | null;
    reason: string;
  }>;
};

type MarketStreamManager = {
  symbolState: Map<string, SymbolLiveState>;
  messageTimestamps: number[];
  subscribedSymbols: Set<string>;
  dynamicUniverse: DynamicUniverseState;
  streamSocket: WebSocket | null;
  connectPromise: Promise<void> | null;
  started: boolean;
  streamState: StreamConnectionState;
  reconnectCount: number;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  lastMessageAt: number;
  lastBootstrapAt: number;
  lastForcedDisconnectAt: number;
  streamStartedAt: number;
  inBootstrap: boolean;
  healthInterval: ReturnType<typeof setInterval> | null;
  universeInterval: ReturnType<typeof setInterval> | null;
  bootstrapInterval: ReturnType<typeof setInterval> | null;
  shutdownRegistered: boolean;
  socketGeneration: number;
  lastRateBudgetLimitedAt: number;
  rateBudgetLimited: boolean;
  wsMessagesReceived: number;
  wsUpdatesApplied: number;
  snapshotUpdatesApplied: number;
  lastWsUpdateAt: number;
  lastSnapshotUpdateAt: number;
  isAuthenticated: boolean;
  hasSubscribed: boolean;
  wsMessageSamples: Array<{
    messageType: string;
    keys: string[];
    updatesParsed: number;
  }>;
  lastStatusOnlyFallbackAt: number;
  degradedReason: string | null;
  wsMessageTypeLogSet: Set<string>;
  subscribedTradeSymbols: Set<string>;
  subscribedAggregateSymbols: Set<string>;
  aggregateUnauthorized: boolean;
  appStartedAt: number;
  lastWebSocketConnectAt: number;
  lastDiscoveryAt: number;
  lastDiscoveryStatus: string | null;
  lastUniverseCount: number;
  lastTradeAt: number;
  lastAggregateAt: number;
  startupMassiveKeyConfigured: boolean;
  startupDiscoveryAttempted: boolean;
  startupWebsocketAttempted: boolean;
};

const WS_ENDPOINT = process.env.MASSIVE_WS_URL?.trim() || "wss://socket.massive.com/stocks";
const STREAM_HEALTH_INTERVAL_MS = 5_000;
const DEFAULT_BOOTSTRAP_REFRESH_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const CLOSE_CODE_NORMAL = 1000;

declare global {
  var __pulseGridMarketStreamManager__: MarketStreamManager | undefined;
}

function createManager(): MarketStreamManager {
  return {
    symbolState: new Map(),
    messageTimestamps: [],
    subscribedSymbols: new Set(),
    subscribedTradeSymbols: new Set(),
    subscribedAggregateSymbols: new Set(),
    dynamicUniverse: {
      symbols: [],
      lastRefreshedAt: 0,
      source: "fallback_empty",
      reasonsBySymbol: {},
      topSymbols: [],
      discoveredCount: 0,
      selectedCount: 0,
      discoveredBeforeFilters: 0,
      scannerThresholds: {
        minPrice: 0.1,
        maxPrice: 20,
        minVolume: 0,
        minRelativeVolume: 0,
        minAbsChangePercent: 0,
        bullishOnly: false,
      },
      rejectionReasonCounts: {},
      topCandidates: [],
    },
    streamSocket: null,
    connectPromise: null,
    started: false,
    streamState: "idle",
    reconnectCount: 0,
    reconnectAttempt: 0,
    reconnectTimer: null,
    lastMessageAt: 0,
    lastBootstrapAt: 0,
    lastForcedDisconnectAt: 0,
    streamStartedAt: 0,
    inBootstrap: false,
    healthInterval: null,
    universeInterval: null,
    bootstrapInterval: null,
    shutdownRegistered: false,
    socketGeneration: 0,
    lastRateBudgetLimitedAt: 0,
    rateBudgetLimited: false,
    wsMessagesReceived: 0,
    wsUpdatesApplied: 0,
    snapshotUpdatesApplied: 0,
    lastWsUpdateAt: 0,
    lastSnapshotUpdateAt: 0,
    isAuthenticated: false,
    hasSubscribed: false,
    wsMessageSamples: [],
    lastStatusOnlyFallbackAt: 0,
    degradedReason: null,
    wsMessageTypeLogSet: new Set<string>(),
    aggregateUnauthorized: false,
    appStartedAt: 0,
    lastWebSocketConnectAt: 0,
    lastDiscoveryAt: 0,
    lastDiscoveryStatus: null,
    lastUniverseCount: 0,
    lastTradeAt: 0,
    lastAggregateAt: 0,
    startupMassiveKeyConfigured: false,
    startupDiscoveryAttempted: false,
    startupWebsocketAttempted: false,
  };
}

const manager = globalThis.__pulseGridMarketStreamManager__ ?? createManager();
globalThis.__pulseGridMarketStreamManager__ = manager;

function nowIso() {
  return new Date().toISOString();
}

function log(event: string, details?: Record<string, unknown>) {
  console.log("[market-stream]", event, {
    ts: nowIso(),
    status: manager.streamState,
    socketGeneration: manager.socketGeneration,
    subscribedSymbolCount: manager.subscribedSymbols.size,
    reconnectAttempt: manager.reconnectAttempt,
    reconnectScheduled: manager.reconnectTimer !== null,
    ...(details ?? {}),
  });
}

function cleanupOldMessageTimestamps(now = Date.now()) {
  while (manager.messageTimestamps.length > 0 && now - manager.messageTimestamps[0] > 60_000) {
    manager.messageTimestamps.shift();
  }
}

function markMessageReceived() {
  const now = Date.now();
  manager.lastMessageAt = now;
  manager.messageTimestamps.push(now);
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
  dayHigh?: number | null;
  dayLow?: number | null;
  oneMinuteChangePercent?: number | null;
  fiveMinuteChangePercent?: number | null;
  greenCandleCount?: number | null;
  breakoutAboveRecentHigh?: boolean;
  sma5?: number | null;
  sma10?: number | null;
  smaMomentumConfirmed?: boolean;
  source?: "ws" | "snapshot";
}) {
  const ticker = partial.ticker.trim().toUpperCase();
  if (!ticker) return;

  const existing = manager.symbolState.get(ticker);
  const price = partial.price ?? existing?.price ?? null;
  const changePercent = partial.changePercent ?? existing?.changePercent ?? null;
  if (price === null || changePercent === null) {
    return;
  }

  const timestampIso = partial.timestamp ?? existing?.lastUpdated ?? nowIso();
  const minuteBucket = timestampIso.slice(0, 16);
  const previousMinuteSameBucket = existing?.minuteBucket && existing.minuteBucket === minuteBucket;
  const previousMinuteVolume = existing?.minuteVolume ?? null;
  const nextMinuteVolume =
    partial.currentVolume !== undefined
      ? (partial.currentVolume ?? null)
      : previousMinuteSameBucket
        ? existing?.minuteVolume ?? null
        : null;
  const priorMinuteClose = existing?.minuteClose ?? price;
  const minuteOpen =
    previousMinuteSameBucket
      ? existing?.minuteOpen ?? price
      : partial.currentVolume !== undefined && partial.currentVolume !== null
        ? price
        : priorMinuteClose;
  const minuteHigh = previousMinuteSameBucket
    ? Math.max(existing?.minuteHigh ?? price, price)
    : price;
  const minuteLow = previousMinuteSameBucket
    ? Math.min(existing?.minuteLow ?? price, price)
    : price;

  manager.symbolState.set(ticker, {
    ticker,
    price,
    changePercent,
    lastUpdated: timestampIso,
    currentVolume:
      partial.currentVolume !== undefined ? partial.currentVolume : existing?.currentVolume ?? null,
    averageVolume:
      partial.averageVolume !== undefined ? partial.averageVolume : existing?.averageVolume ?? null,
    dayHigh:
      partial.dayHigh !== undefined
        ? partial.dayHigh
        : existing?.dayHigh !== null && existing?.dayHigh !== undefined
          ? Math.max(existing.dayHigh, price)
          : price,
    dayLow:
      partial.dayLow !== undefined
        ? partial.dayLow
        : existing?.dayLow !== null && existing?.dayLow !== undefined
          ? Math.min(existing.dayLow, price)
          : price,
    minuteBucket,
    minuteOpen,
    minuteHigh,
    minuteLow,
    minuteClose: price,
    minuteVolume: nextMinuteVolume,
    previousMinuteHigh: previousMinuteSameBucket ? existing?.previousMinuteHigh ?? null : existing?.minuteHigh ?? null,
    previousMinuteLow: previousMinuteSameBucket ? existing?.previousMinuteLow ?? null : existing?.minuteLow ?? null,
    previousMinuteVolume: previousMinuteSameBucket ? existing?.previousMinuteVolume ?? null : previousMinuteVolume,
    oneMinuteChangePercent: partial.oneMinuteChangePercent ?? existing?.oneMinuteChangePercent ?? null,
    fiveMinuteChangePercent: partial.fiveMinuteChangePercent ?? existing?.fiveMinuteChangePercent ?? null,
    greenCandleCount: partial.greenCandleCount ?? existing?.greenCandleCount ?? null,
    breakoutAboveRecentHigh: partial.breakoutAboveRecentHigh ?? existing?.breakoutAboveRecentHigh ?? false,
    sma5: partial.sma5 ?? existing?.sma5 ?? null,
    sma10: partial.sma10 ?? existing?.sma10 ?? null,
    smaMomentumConfirmed: partial.smaMomentumConfirmed ?? existing?.smaMomentumConfirmed ?? false,
    provider: "massive",
  });
  if (partial.source === "ws") {
    manager.wsUpdatesApplied += 1;
    manager.lastWsUpdateAt = Date.now();
  } else {
    manager.snapshotUpdatesApplied += 1;
    manager.lastSnapshotUpdateAt = Date.now();
  }
}

function parsePotentialTickUpdate(payload: unknown): Array<{
  ticker: string;
  price?: number | null;
  changePercent?: number | null;
  timestamp?: string | null;
  currentVolume?: number | null;
  dayHigh?: number | null;
  dayLow?: number | null;
}> {
  if (!payload) return [];
  const rows = Array.isArray(payload) ? payload : [payload];
  const updates: Array<{
    ticker: string;
    price?: number | null;
    changePercent?: number | null;
    timestamp?: string | null;
    currentVolume?: number | null;
    dayHigh?: number | null;
    dayLow?: number | null;
  }> = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const entry = row as Record<string, unknown>;
    const tickerRaw = entry.sym ?? entry.symbol ?? entry.ticker ?? entry.S;
    const ticker = typeof tickerRaw === "string" ? tickerRaw.trim().toUpperCase() : "";
    if (!ticker) continue;

    const price =
      parseNumber(entry.p) ??
      parseNumber(entry.price) ??
      parseNumber(entry.c) ??
      parseNumber(entry.close);
    const changePercent = parseNumber(entry.dp) ?? parseNumber(entry.changePercent) ?? parseNumber(entry.todaysChangePerc);
    const currentVolume = parseNumber(entry.v) ?? parseNumber(entry.volume) ?? parseNumber(entry.dayVolume);
    const dayHigh = parseNumber(entry.h) ?? parseNumber(entry.dayHigh);
    const dayLow = parseNumber(entry.l) ?? parseNumber(entry.dayLow);
    const timestampRaw = parseNumber(entry.t) ?? parseNumber(entry.e) ?? parseNumber(entry.timestamp);
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
      dayHigh,
      dayLow,
    });
  }

  return updates;
}

function captureWsMessageSample(parsed: unknown, updatesParsed: number) {
  if (manager.wsMessageSamples.length >= 12) return;
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!first || typeof first !== "object") return;
  const entry = first as Record<string, unknown>;
  const keys = Object.keys(entry).slice(0, 12);
  const messageType =
    (typeof entry.ev === "string" && entry.ev) ||
    (typeof entry.event === "string" && entry.event) ||
    (typeof entry.status === "string" && `status:${entry.status}`) ||
    "unknown";
  if (!manager.wsMessageTypeLogSet.has(messageType)) {
    manager.wsMessageTypeLogSet.add(messageType);
    console.log("[massive-ws] raw sample", { messageType, updatesParsed, keys });
  }
  manager.wsMessageSamples.push({
    messageType,
    keys,
    updatesParsed,
  });
}

function buildSubscribePayload() {
  const symbols = [...manager.subscribedSymbols];
  if (!symbols.length) return null;
  manager.subscribedTradeSymbols = new Set(symbols);
  manager.subscribedAggregateSymbols = new Set(symbols);
  return {
    action: "subscribe",
    params: symbols.flatMap((ticker) => [`T.${ticker}`, `AM.${ticker}`]).join(","),
  };
}

function sendAuth(socket = manager.streamSocket) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const key = getMassiveApiKey();
  if (!key) return;
  try {
    socket.send(JSON.stringify({ action: "auth", params: key }));
  } catch (error) {
    log("send_auth_failed", { error: error instanceof Error ? error.message : String(error) });
  }

}

function sendSubscribe(socket = manager.streamSocket) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const subscribePayload = buildSubscribePayload();
  if (!subscribePayload) return;

  try {
    socket.send(JSON.stringify(subscribePayload));
    manager.hasSubscribed = true;
    console.log("[massive-ws] subscribed symbols count:", manager.subscribedSymbols.size);
  } catch (error) {
    log("send_subscribe_failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

function payloadHasAuthSuccess(payload: unknown) {
  const rows = Array.isArray(payload) ? payload : [payload];
  return rows.some((row) => {
    if (!row || typeof row !== "object") return false;
    const entry = row as Record<string, unknown>;
    const status = typeof entry.status === "string" ? entry.status.toLowerCase() : "";
    const message = typeof entry.message === "string" ? entry.message.toLowerCase() : "";
    return status === "auth_success" || message.includes("authenticated");
  });
}

function clearReconnectTimer() {
  if (!manager.reconnectTimer) return;
  clearTimeout(manager.reconnectTimer);
  manager.reconnectTimer = null;
}

function scheduleReconnect(reason: string) {
  if (!manager.started) return;
  if (manager.reconnectTimer) {
    log("reconnect_already_scheduled", { reason });
    return;
  }

  manager.reconnectCount += 1;
  manager.reconnectAttempt += 1;
  console.log("[massive-ws] reconnecting");
  const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, manager.reconnectAttempt - 1));
  log("reconnect_start", { reason, attempt: manager.reconnectAttempt, backoffMs: backoff });
  log("reconnect_scheduled", { reason, backoffMs: backoff });
  manager.reconnectTimer = setTimeout(() => {
    manager.reconnectTimer = null;
    void connectSocket("scheduled_reconnect");
  }, backoff);
}

function clearSocketReference(socket: WebSocket) {
  if (manager.streamSocket === socket) {
    manager.streamSocket = null;
  }
}

function closeSocketInternal(reason: string, options?: { socket?: WebSocket; suppressReconnect?: boolean }) {
  const socket = options?.socket ?? manager.streamSocket;
  if (!socket) return;

  clearSocketReference(socket);
  try {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close(CLOSE_CODE_NORMAL, reason.slice(0, 120));
    }
  } catch (error) {
    log("close_failed", { reason, error: error instanceof Error ? error.message : String(error) });
  }

  manager.streamState = options?.suppressReconnect ? "disconnected" : manager.streamState;
  log("socket_closed", { reason, suppressReconnect: options?.suppressReconnect ?? false });
}

function registerShutdownHandlers() {
  if (manager.shutdownRegistered) return;
  manager.shutdownRegistered = true;

  const shutdown = (signal: string) => {
    log("shutdown", { signal });
    clearReconnectTimer();
    closeSocketInternal(`shutdown:${signal}`, { suppressReconnect: true });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("beforeExit", () => shutdown("beforeExit"));
}

async function connectSocket(reason: string) {
  if (manager.connectPromise) {
    log("connect_joined", { reason });
    return manager.connectPromise;
  }

  if (manager.streamSocket && (manager.streamSocket.readyState === WebSocket.OPEN || manager.streamSocket.readyState === WebSocket.CONNECTING)) {
    log("connect_skipped_existing_socket", { reason, readyState: manager.streamSocket.readyState });
    return;
  }

  const key = getMassiveApiKey();
  console.log("[massive] api key configured:", Boolean(key));
  if (!key) {
    manager.streamState = "degraded";
    manager.degradedReason = "Massive API key is missing.";
    log("connect_blocked_missing_api_key", { reason });
    return;
  }

  manager.connectPromise = (async () => {
    manager.streamState = "connecting";
    console.log("[massive-ws] connecting");
    clearReconnectTimer();
    const generation = manager.socketGeneration + 1;
    manager.socketGeneration = generation;

    let socket: WebSocket;
    try {
      socket = new WebSocket(WS_ENDPOINT);
    } catch (error) {
      manager.streamState = "degraded";
      manager.streamSocket = null;
      manager.degradedReason = "WebSocket constructor failed.";
      log("connect_constructor_failed", { reason, error: error instanceof Error ? error.message : String(error) });
      scheduleReconnect("constructor_failed");
      return;
    }

    manager.streamSocket = socket;
    log("connect_opening", { reason, generation });

    socket.addEventListener("open", () => {
      if (manager.streamSocket !== socket) {
        log("socket_open_ignored_stale", { generation });
        closeSocketInternal("stale_open_socket", { socket, suppressReconnect: true });
        return;
      }

      const wasReconnecting = manager.reconnectAttempt > 0;
      manager.streamState = "connected";
      manager.degradedReason = null;
      console.log("[massive-ws] connected");
      manager.lastWebSocketConnectAt = Date.now();
      manager.isAuthenticated = false;
      manager.hasSubscribed = false;
      manager.reconnectAttempt = 0;
      log("socket_open", { generation });
      if (wasReconnecting) {
        log("reconnect_end", { generation });
      }
      sendAuth(socket);
    });

    socket.addEventListener("message", (event) => {
      if (manager.streamSocket !== socket) {
        return;
      }

      markMessageReceived();
      manager.wsMessagesReceived += 1;
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!manager.isAuthenticated && payloadHasAuthSuccess(parsed)) {
        manager.isAuthenticated = true;
        log("socket_authenticated", { generation });
        console.log("[massive-ws] authenticated");
        sendSubscribe(socket);
      }
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const entry = row as Record<string, unknown>;
        const status = typeof entry.status === "string" ? entry.status.toLowerCase() : "";
        const message = typeof entry.message === "string" ? entry.message.toLowerCase() : "";
        if ((status.includes("unauthorized") || message.includes("unauthorized")) && message.includes("am.")) {
          manager.aggregateUnauthorized = true;
        }
        const ev = typeof entry.ev === "string" ? entry.ev.toUpperCase() : "";
        const tsRaw = parseNumber(entry.t) ?? parseNumber(entry.sip_timestamp);
        const ts = tsRaw !== null ? (tsRaw > 9_999_999_999_999 ? Math.floor(tsRaw / 1_000_000) : tsRaw) : Date.now();
        if (ev === "T") {
          manager.lastTradeAt = Date.now();
        }
        if (ev === "AM") {
          manager.lastAggregateAt = Date.now();
          const symbol = typeof entry.sym === "string" ? entry.sym.trim().toUpperCase() : "";
          const open = parseNumber(entry.o);
          const high = parseNumber(entry.h);
          const low = parseNumber(entry.l);
          const close = parseNumber(entry.c);
          const volume = parseNumber(entry.v);
          if (symbol && close !== null) {
            updateSymbolState({
              ticker: symbol,
              price: close,
              timestamp: new Date(ts).toISOString(),
              currentVolume: volume,
              dayHigh: high,
              dayLow: low,
              source: "ws",
            });
            if (open !== null) {
              const existing = manager.symbolState.get(symbol);
              if (existing) {
                const greenCount = (existing.greenCandleCount ?? 0) + (close > open ? 1 : 0);
                updateSymbolState({
                  ticker: symbol,
                  greenCandleCount: greenCount,
                  source: "ws",
                });
              }
            }
          }
        }
      }

      const updates = parsePotentialTickUpdate(parsed);
      console.log("[massive-ws] message received");
      captureWsMessageSample(parsed, updates.length);
      for (const update of updates) {
        console.log("[massive-ws] trade parsed", {
          symbol: update.ticker,
          price: update.price ?? null,
          timestamp: update.timestamp ?? null,
        });
        updateSymbolState({
          ...update,
          source: "ws",
        });
      }
      if (updates.length > 0) {
        console.log("[massive-ws] ws updates applied count", manager.wsUpdatesApplied);
        manager.degradedReason = null;
      }
    });

    const onDisconnect = (eventType: "error" | "close", event?: Event) => {
      const wasActiveSocket = manager.streamSocket === socket;
      clearSocketReference(socket);

      if (!wasActiveSocket) {
        log("socket_disconnect_ignored_stale", { generation, eventType });
        return;
      }

      manager.streamState = "disconnected";
      manager.degradedReason = `WebSocket ${eventType} event received.`;
      manager.isAuthenticated = false;
      manager.hasSubscribed = false;
      console.log("[massive-ws] disconnected");
      log("socket_disconnect", {
        generation,
        eventType,
        code: event && "code" in event ? (event as CloseEvent).code : undefined,
        reason: event && "reason" in event ? (event as CloseEvent).reason : undefined,
      });
      scheduleReconnect(eventType);
    };

    socket.addEventListener("error", (event) => {
      onDisconnect("error", event);
    });
    socket.addEventListener("close", (event) => {
      onDisconnect("close", event);
    });
  })().finally(() => {
    manager.connectPromise = null;
  });

  return manager.connectPromise;
}

async function refreshUniverse() {
  const runtimeConfig = getSignalRuntimeConfig();
  const budget = consumeRateLimitToken("massive_rest:universe", runtimeConfig.maxApiCallsPerMinute, 60_000);
  if (!budget.allowed) {
    manager.lastRateBudgetLimitedAt = Date.now();
    if (!manager.rateBudgetLimited) {
      manager.rateBudgetLimited = true;
      log("rate_budget_limited_entered", { source: "universe_refresh" });
    }
    log("universe_refresh_skipped_rate_budget", {
      retryAfterMs: budget.retryAfterMs,
      maxApiCallsPerMinute: runtimeConfig.maxApiCallsPerMinute,
    });
    return;
  }
  if (manager.rateBudgetLimited) {
    manager.rateBudgetLimited = false;
    log("rate_budget_limited_exited", { source: "universe_refresh" });
  }

  manager.lastDiscoveryAt = Date.now();
  manager.startupDiscoveryAttempted = true;
  const discovered = await getDynamicMarketUniverse({
    cap: runtimeConfig.maxSymbolsPerScan,
  });
  const useEmptyFallback = discovered.candidates.length === 0;
  const candidates = useEmptyFallback ? [] : discovered.candidates;
  const source = useEmptyFallback ? "fallback_empty" : discovered.source;
  const reasonsBySymbol = useEmptyFallback
    ? { __universe__: "No low-price bullish momentum symbols matched current scanner filters." }
    : discovered.reasonsBySymbol;
  const topSymbols = useEmptyFallback ? [] : discovered.topSymbols;

  manager.dynamicUniverse = {
    symbols: candidates,
    lastRefreshedAt: Date.now(),
    source,
    reasonsBySymbol,
    topSymbols,
    discoveredCount: discovered.discoveredCount,
    selectedCount: candidates.length,
    discoveredBeforeFilters: discovered.discoveredBeforeFilters,
    scannerThresholds: discovered.scannerThresholds,
    rejectionReasonCounts: discovered.rejectionReasonCounts,
    topCandidates: discovered.topCandidates,
  };
  manager.lastUniverseCount = candidates.length;
  manager.lastDiscoveryStatus = `ok:${discovered.discoveredCount}/${candidates.length}`;

  manager.subscribedSymbols.clear();
  for (const symbol of candidates) {
    manager.subscribedSymbols.add(symbol.ticker);
  }

  log("universe_refreshed", {
    discoveredCount: discovered.discoveredCount,
    selectedCount: candidates.length,
    source,
  });
  if (manager.streamSocket?.readyState === WebSocket.OPEN) {
    if (manager.isAuthenticated) {
      sendSubscribe();
    } else {
      sendAuth();
    }
  }
}

async function bootstrapQuotes() {
  if (manager.inBootstrap) return;
  if (manager.subscribedSymbols.size === 0) return;
  const runtimeConfig = getSignalRuntimeConfig();
  const budget = consumeRateLimitToken("massive_rest:bootstrap", runtimeConfig.maxApiCallsPerMinute, 60_000);
  if (!budget.allowed) {
    manager.lastRateBudgetLimitedAt = Date.now();
    if (!manager.rateBudgetLimited) {
      manager.rateBudgetLimited = true;
      log("rate_budget_limited_entered", { source: "bootstrap" });
    }
    log("bootstrap_skipped_rate_budget", {
      retryAfterMs: budget.retryAfterMs,
      maxApiCallsPerMinute: runtimeConfig.maxApiCallsPerMinute,
    });
    return;
  }
  if (manager.rateBudgetLimited) {
    manager.rateBudgetLimited = false;
    log("rate_budget_limited_exited", { source: "bootstrap" });
  }
  manager.inBootstrap = true;
  log("bootstrap_start", { symbolCount: manager.subscribedSymbols.size });

  try {
    const response = await fetchMassiveStockSnapshots([...manager.subscribedSymbols]);
    log("massive_snapshot_request", {
      endpoint: "snapshot_tickers",
      symbolCount: manager.subscribedSymbols.size,
    });
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
      const dayHigh = parseNumber(row.day && (row.day as Record<string, unknown>).h);
      const dayLow = parseNumber(row.day && (row.day as Record<string, unknown>).l);
      const prevVolume = parseNumber(row.prevDay && (row.prevDay as Record<string, unknown>).v);
      const averageVolume = prevVolume !== null && prevVolume > 0 ? prevVolume : null;
      updateSymbolState({
        ticker,
        price,
        changePercent,
        currentVolume: dayVolume,
        averageVolume,
        dayHigh,
        dayLow,
        timestamp: nowIso(),
        source: "snapshot",
      });
    }
    const intradayMetrics = await fetchMassiveRecentIntradayForSymbols([...manager.subscribedSymbols], {
      lookbackMinutes: 120,
      limit: 240,
    });
    for (const metrics of intradayMetrics) {
      updateSymbolState({
        ticker: metrics.ticker,
        oneMinuteChangePercent: metrics.oneMinuteChangePercent,
        fiveMinuteChangePercent: metrics.fiveMinuteChangePercent,
        greenCandleCount: metrics.greenCandleCount,
        breakoutAboveRecentHigh: metrics.breakoutAboveRecentHigh,
        sma5: metrics.sma5,
        sma10: metrics.sma10,
        smaMomentumConfirmed: metrics.smaMomentumConfirmed,
        source: "snapshot",
      });
    }
    manager.degradedReason = null;

    manager.lastBootstrapAt = Date.now();
  } catch (error) {
    manager.streamState = manager.streamState === "connected" ? "connected" : "degraded";
    log("bootstrap_failed", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    manager.inBootstrap = false;
    log("bootstrap_end", {
      symbolCount: manager.subscribedSymbols.size,
      lastBootstrapAt: manager.lastBootstrapAt ? new Date(manager.lastBootstrapAt).toISOString() : null,
    });
  }
}

function monitorStreamHealth() {
  const runtimeConfig = getSignalRuntimeConfig();
  const staleAfterMs = runtimeConfig.staleTickThresholdMs;
  const now = Date.now();
  cleanupOldMessageTimestamps(now);
  if (manager.streamState === "connected" && manager.lastMessageAt > 0 && now - manager.lastMessageAt > staleAfterMs) {
    manager.streamState = "degraded";
    log("stream_stale", { staleForMs: now - manager.lastMessageAt });
    closeSocketInternal("stream_stale");
    scheduleReconnect("stream_stale");
  }
  const statusOnlyStream = manager.wsMessagesReceived > 0 && manager.wsUpdatesApplied === 0;
  if (
    manager.streamState === "connected" &&
    statusOnlyStream &&
    now - manager.lastBootstrapAt > Math.max(4_000, runtimeConfig.scanIntervalMs * 2)
  ) {
    if (now - manager.lastStatusOnlyFallbackAt > 60_000) {
      manager.lastStatusOnlyFallbackAt = now;
      log("status_only_stream_refresh_fallback");
      console.warn("[massive-ws] status-only stream detected");
      manager.degradedReason = "WebSocket connected but no trade ticks received.";
    }
    void bootstrapQuotes().catch((error) => {
      log("status_only_stream_refresh_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

function ensureIntervals() {
  const runtimeConfig = getSignalRuntimeConfig();
  if (!manager.universeInterval) {
    manager.universeInterval = setInterval(() => {
      void refreshUniverse().catch((error) => {
        log("universe_refresh_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, runtimeConfig.universeRefreshMs);
  }

  if (!manager.bootstrapInterval) {
    const bootstrapRefreshMs = Math.max(5_000, Math.min(DEFAULT_BOOTSTRAP_REFRESH_MS, runtimeConfig.scanIntervalMs * 6));
    manager.bootstrapInterval = setInterval(() => {
      void bootstrapQuotes().catch((error) => {
        log("bootstrap_refresh_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, bootstrapRefreshMs);
  }

  if (!manager.healthInterval) {
    manager.healthInterval = setInterval(() => {
      monitorStreamHealth();
    }, STREAM_HEALTH_INTERVAL_MS);
  }
}

export async function startMarketStream() {
  registerShutdownHandlers();

  if (manager.started) {
    manager.startupWebsocketAttempted = true;
    await connectSocket("start_reuse");
    return;
  }

  manager.started = true;
  manager.streamStartedAt = Date.now();
  manager.appStartedAt = manager.streamStartedAt;
  manager.startupMassiveKeyConfigured = Boolean(getMassiveApiKey());
  const easternNow = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
  console.log("[startup] scanner session status", { easternTime: easternNow });
  console.log("[startup] massive key configured", manager.startupMassiveKeyConfigured);
  log("stream_start");

  try {
    console.log("[startup] discovery attempted");
    await refreshUniverse();
    await bootstrapQuotes();
  } catch (error) {
    manager.lastDiscoveryStatus = `error:${error instanceof Error ? error.message : String(error)}`;
    log("stream_bootstrap_phase_failed", { error: error instanceof Error ? error.message : String(error) });
  }

  ensureIntervals();
  manager.startupWebsocketAttempted = true;
  console.log("[startup] websocket attempted");
  await connectSocket("initial_start");
}

function freshnessFromTimestamp(timestamp: string): QuoteFreshness {
  const runtimeConfig = getSignalRuntimeConfig();
  const staleAfterMs = runtimeConfig.staleTickThresholdMs;
  const freshAfterMs = Math.max(5_000, Math.round(staleAfterMs / 3));
  const ageMs = Math.max(0, Date.now() - new Date(timestamp).getTime());
  if (ageMs <= freshAfterMs) return "fresh";
  if (ageMs <= staleAfterMs) return "cached";
  return "stale";
}

export function getSymbolSnapshot(symbol: string): QuoteSnapshot | null {
  const entry = manager.symbolState.get(symbol.trim().toUpperCase());
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

export function getSymbolIntradayState(symbol: string): SymbolIntradayState | null {
  const entry = manager.symbolState.get(symbol.trim().toUpperCase());
  if (!entry) return null;
  return {
    ticker: entry.ticker,
    dayHigh: entry.dayHigh,
    dayLow: entry.dayLow,
    lastPrice: entry.price,
    lastUpdated: entry.lastUpdated,
    previousMinuteHigh: entry.previousMinuteHigh,
    previousMinuteLow: entry.previousMinuteLow,
    currentMinuteHigh: entry.minuteHigh,
    currentMinuteLow: entry.minuteLow,
    currentMinuteVolume: entry.minuteVolume,
    previousMinuteVolume: entry.previousMinuteVolume,
    oneMinuteChangePercent: entry.oneMinuteChangePercent,
    fiveMinuteChangePercent: entry.fiveMinuteChangePercent,
    greenCandleCount: entry.greenCandleCount,
    breakoutAboveRecentHigh: entry.breakoutAboveRecentHigh,
    sma5: entry.sma5,
    sma10: entry.sma10,
    smaMomentumConfirmed: entry.smaMomentumConfirmed,
  };
}

export function getMarketSnapshot(tickers?: string[]) {
  const runtimeConfig = getSignalRuntimeConfig();
  const staleAfterMs = runtimeConfig.staleTickThresholdMs;
  const cacheTtlMs = Math.max(5_000, Math.round(staleAfterMs / 3));
  const selected = tickers && tickers.length > 0 ? tickers : [...manager.subscribedSymbols];
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
    cacheTtlMs,
    staleAfterMs,
    refreshBatchSize: Math.min(10, Math.max(1, selected.length)),
    degraded: manager.streamState !== "connected" && manager.streamState !== "connecting",
  };
}

export function getDynamicUniverse() {
  return {
    symbols: manager.dynamicUniverse.symbols,
    source: manager.dynamicUniverse.source,
    reasonsBySymbol: manager.dynamicUniverse.reasonsBySymbol,
    topSymbols: manager.dynamicUniverse.topSymbols,
    discoveredCount: manager.dynamicUniverse.discoveredCount,
    selectedCount: manager.dynamicUniverse.selectedCount,
    discoveredBeforeFilters: manager.dynamicUniverse.discoveredBeforeFilters,
    scannerThresholds: manager.dynamicUniverse.scannerThresholds,
    rejectionReasonCounts: manager.dynamicUniverse.rejectionReasonCounts,
    topCandidates: manager.dynamicUniverse.topCandidates,
  };
}

export function getVolumeSnapshotsForSymbols(tickers: string[]): VolumeSnapshot[] {
  const snapshots: VolumeSnapshot[] = [];
  for (const ticker of tickers) {
    const entry = manager.symbolState.get(ticker.trim().toUpperCase());
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
  const runtimeConfig = getSignalRuntimeConfig();
  const staleAfterMs = runtimeConfig.staleTickThresholdMs;
  const now = Date.now();
  cleanupOldMessageTimestamps(now);
  const stale =
    manager.lastMessageAt > 0
      ? now - manager.lastMessageAt > staleAfterMs
      : manager.started && manager.streamState !== "connecting";
  const degraded =
    manager.streamState === "degraded" ||
    manager.streamState === "disconnected" ||
    (manager.streamState === "connected" && stale);
  const mode: MarketStreamHealth["mode"] =
    manager.streamState === "connected" && !stale
      ? "realtime"
      : manager.streamState !== "idle" && manager.symbolState.size > 0
        ? "delayed"
        : "unknown";
  const rateBudgetLimited =
    manager.rateBudgetLimited ||
    (manager.lastRateBudgetLimitedAt > 0 && now - manager.lastRateBudgetLimitedAt <= 60_000);
  const reconnecting =
    manager.streamState === "connecting" ||
    manager.streamState === "disconnected" ||
    manager.reconnectTimer !== null;

  return {
    status: manager.streamState,
    connected: manager.streamState === "connected",
    authenticated: manager.isAuthenticated,
    subscribed: manager.hasSubscribed,
    realtime: manager.streamState === "connected" && !stale,
    mode,
    lastMessageAt: manager.lastMessageAt ? new Date(manager.lastMessageAt).toISOString() : null,
    lastWebSocketConnectAt: manager.lastWebSocketConnectAt ? new Date(manager.lastWebSocketConnectAt).toISOString() : null,
    lastBootstrapAt: manager.lastBootstrapAt ? new Date(manager.lastBootstrapAt).toISOString() : null,
    lastForcedDisconnectAt: manager.lastForcedDisconnectAt ? new Date(manager.lastForcedDisconnectAt).toISOString() : null,
    subscribedSymbolCount: manager.subscribedSymbols.size,
    subscribedTradeCount: manager.subscribedTradeSymbols.size,
    subscribedAggregateCount: manager.subscribedAggregateSymbols.size,
    activeUniverseSize: manager.dynamicUniverse.symbols.length,
    snapshotSymbolCount: manager.symbolState.size,
    messagesPerMinute: manager.messageTimestamps.length,
    reconnectCount: manager.reconnectCount,
    streamStarted: manager.started,
    uptimeMs: manager.streamStartedAt ? Math.max(0, now - manager.streamStartedAt) : 0,
    reconnectScheduled: manager.reconnectTimer !== null,
    reconnecting,
    inBootstrap: manager.inBootstrap,
    rateBudgetLimited,
    lastRateBudgetLimitedAt: manager.lastRateBudgetLimitedAt ? new Date(manager.lastRateBudgetLimitedAt).toISOString() : null,
    stale,
    degraded,
    wsMessagesReceived: manager.wsMessagesReceived,
    wsUpdatesApplied: manager.wsUpdatesApplied,
    snapshotUpdatesApplied: manager.snapshotUpdatesApplied,
    lastWsUpdateAt: manager.lastWsUpdateAt ? new Date(manager.lastWsUpdateAt).toISOString() : null,
    lastTradeAt: manager.lastTradeAt ? new Date(manager.lastTradeAt).toISOString() : null,
    lastAggregateAt: manager.lastAggregateAt ? new Date(manager.lastAggregateAt).toISOString() : null,
    lastSnapshotUpdateAt: manager.lastSnapshotUpdateAt ? new Date(manager.lastSnapshotUpdateAt).toISOString() : null,
    wsMessageSamples: [...manager.wsMessageSamples],
    statusOnlyStream: manager.wsMessagesReceived > 0 && manager.wsUpdatesApplied === 0,
    aggregateUnauthorized: manager.aggregateUnauthorized,
    appStartedAt: manager.appStartedAt ? new Date(manager.appStartedAt).toISOString() : null,
    lastDiscoveryAt: manager.lastDiscoveryAt ? new Date(manager.lastDiscoveryAt).toISOString() : null,
    lastDiscoveryStatus: manager.lastDiscoveryStatus,
    lastUniverseCount: manager.lastUniverseCount,
    startup: {
      massiveKeyConfigured: manager.startupMassiveKeyConfigured,
      discoveryAttempted: manager.startupDiscoveryAttempted,
      websocketAttempted: manager.startupWebsocketAttempted,
    },
    degradedReason: manager.degradedReason,
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

  if (!manager.started) {
    return {
      ok: false,
      reason: "stream_not_started",
      health: getMarketStreamHealth(),
    } as const;
  }

  manager.lastForcedDisconnectAt = Date.now();
  manager.streamState = "disconnected";
  closeSocketInternal("debug_reconnect");
  scheduleReconnect("debug_reconnect");

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
