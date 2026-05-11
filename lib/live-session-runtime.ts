import { buildLiveAlertsNow } from "./active-now";
import { buildBotFeed } from "./bot-feed/normalize";
import {
  createLiveSignalEngineState,
  evaluateLiveSignals,
  getLiveSignalEngineCycleDiagnostics,
  type Signal,
} from "./live-signal-engine";
import { type LiveSessionSnapshot, type QuoteSnapshot, type QuoteState } from "./market-data";
import { getMarketClock } from "./market-session";
import { computeVolumeMovers, type VolumeMover } from "./volume-movers";
import type { VolumeSnapshot } from "./volume-data";
import { fetchStructuredNewsSnapshots, type StructuredNewsSnapshot } from "./news-data";
import { buildLiveEvents, type LiveEvent } from "./live-events";
import { loadPersistedSessionState, savePersistedSessionState, type PersistedSessionState, type PersistenceStatus, type PersistedSymbolHealth, type SymbolHealthOutcome } from "./session-state-store";
import { getSignalRuntimeConfig } from "./signal-runtime-config";
import {
  getDynamicUniverse as getDynamicUniverseFromStream,
  getMarketSnapshot,
  getMarketStreamHealth,
  getVolumeSnapshotsForSymbols,
  startMarketStream,
} from "./market-stream";
import type { WatchlistTicker } from "./watchlist";

const LIVE_SESSION_FAST_LANE_VOLUME_COUNT = 4;
const SYMBOL_HEALTH_WINDOW = 6;
const SYMBOL_COLD_DURATION_MS = 12 * 60_000;
const SYMBOL_SELECTION_STICKINESS_MS = 8 * 60_000;

type SnapshotListener = (snapshot: LiveSessionSnapshot) => void;

type SharedLiveStateStore = {
  version: number;
  snapshot: LiveSessionSnapshot | null;
  latestQuotes: QuoteSnapshot[];
  quoteStates: Record<string, QuoteState>;
  observedHighs: Record<string, number | null>;
  activeSignals: Signal[];
  events: LiveEvent[];
  volumeMoverCandidates: VolumeSnapshot[];
  volumeMovers: VolumeMover[];
  persistence: PersistenceStatus | null;
  sessionDate: string | null;
  sessionStatus: LiveSessionSnapshot["sessionStatus"] | null;
  sessionLabel: string | null;
  lastCompletedAt: string | null;
  lastCycleLatencyMs: number | null;
  lastEngineDiagnostics: {
    evaluatedSymbols: number;
    candidateSignals: number;
    emittedSignals: number;
    topRejected: Array<{
      ticker: string;
      reason: string;
      changePercent: number | null;
      freshness: string;
    }>;
    sampleSnapshots: Array<{
      ticker: string;
      lastPrice: number | null;
      windowStartPrice: number | null;
      currentVolume: number | null;
      averageVolume: number | null;
      lastTradeTimestamp: string | null;
      sessionStatus: "premarket" | "regular" | "after-hours" | "closed";
    }>;
  } | null;
};

const listeners = new Set<SnapshotListener>();

const liveStateStore: SharedLiveStateStore = {
  version: 0,
  snapshot: null,
  latestQuotes: [],
  quoteStates: {},
  observedHighs: {},
  activeSignals: [],
  events: [],
  volumeMoverCandidates: [],
  volumeMovers: [],
  persistence: null,
  sessionDate: null,
  sessionStatus: null,
  sessionLabel: null,
  lastCompletedAt: null,
  lastCycleLatencyMs: null,
  lastEngineDiagnostics: null,
};

let persistedState: PersistedSessionState | null = null;
let latestPersistenceStatus: PersistenceStatus | null = null;
let cyclePromise: Promise<LiveSessionSnapshot> | null = null;
let nextCycleTimer: ReturnType<typeof setTimeout> | null = null;
let lastDemandAt = 0;
let cachedUniverseCandidates: WatchlistTicker[] = [];
let cachedUniverseDiscovery: {
  source: "live" | "cache" | "fallback_empty" | "fallback_default";
  discoveredCount: number;
  selectedCount: number;
  topSymbols: string[];
  reasonsBySymbol: Record<string, string>;
} = {
  source: "fallback_empty",
  discoveredCount: 0,
  selectedCount: 0,
  topSymbols: [],
  reasonsBySymbol: {},
};
let nextUniverseRefreshAt = 0;
let cachedNewsByTicker = new Map<string, StructuredNewsSnapshot>();
let nextNewsRefreshAt = 0;
const SIGNAL_COOLDOWN_MS = 15 * 60 * 1000;
const SCORE_REENTRY_DELTA = 10;
const CHANGE_REENTRY_DELTA = 1.25;
const MIN_ACTIONABLE_SCORE = 70;
const STRONG_BREAKOUT_SCORE = 85;
const MIN_ACTIONABLE_CHANGE = 1;
const STRONG_BREAKOUT_CHANGE = 2;
const NORMAL_SIGNAL_TTL_MS = 10 * 60 * 1000;
const STRONG_SIGNAL_TTL_MS = 20 * 60 * 1000;
const SIGNAL_MEMORY_RETENTION_MS = 6 * 60 * 60 * 1000;

type SignalMemory = {
  symbol: string;
  lastSignalType: string;
  lastScore: number;
  lastChangePercent: number;
  lastAlertAt: number;
  lastSeenAt: number;
  lastBreakoutKey: string;
  lastEmittedSignal: Signal;
};

const signalMemoryBySymbol = new Map<string, SignalMemory>();

function buildBreakoutKey(signal: Signal) {
  return [
    signal.ticker,
    signal.signalType,
    Math.round(signal.finalScore),
    Math.round(signal.changePercent * 10),
  ].join("|");
}

function getSignalReason(signal: Signal) {
  if (signal.reason && signal.reason.trim().length > 0) return signal.reason;

  const score = Number(signal.finalScore ?? signal.score ?? 0);
  const change = Number(signal.changePercent ?? 0);

  if (score >= STRONG_BREAKOUT_SCORE && Math.abs(change) >= STRONG_BREAKOUT_CHANGE) {
    return "Strong momentum breakout with high signal score.";
  }

  if (score >= MIN_ACTIONABLE_SCORE && Math.abs(change) >= MIN_ACTIONABLE_CHANGE) {
    return "Fresh momentum detected with confirmed price movement.";
  }

  return "Selected from current live signal ranking.";
}

function isActionableMomentum(candidate: Signal) {
  const score = Number(candidate.finalScore ?? candidate.score ?? 0);
  const change = Number(candidate.changePercent ?? 0);
  const freshness = candidate.quoteFreshness === "fresh" || candidate.quoteFreshness === "cached";
  const hasSource = candidate.quoteProvider === "finnhub" || candidate.quoteProvider === "massive" || candidate.quoteProvider === "twelve_data";

  if (!freshness || !hasSource) {
    return false;
  }

  if (score >= STRONG_BREAKOUT_SCORE && Math.abs(change) >= STRONG_BREAKOUT_CHANGE) {
    if (typeof candidate.relativeVolume === "number") {
      return candidate.relativeVolume >= 1.5;
    }
    return true;
  }

  return score >= MIN_ACTIONABLE_SCORE && Math.abs(change) >= MIN_ACTIONABLE_CHANGE;
}

function shouldEmitSignal(candidate: Signal, memory: SignalMemory | undefined, nowMs: number) {
  const score = Number(candidate.finalScore ?? candidate.score ?? 0);
  const signalType = String(candidate.signalType ?? "UNKNOWN");
  const change = Number(candidate.changePercent ?? 0);

  if (!memory) return true;

  const elapsed = nowMs - memory.lastAlertAt;
  const sameSignalType = memory.lastSignalType === signalType;
  const scoreImproved = score >= Number(memory.lastScore ?? 0) + SCORE_REENTRY_DELTA;
  const changeExpanded = Math.abs(change) >= Math.abs(Number(memory.lastChangePercent ?? 0)) + CHANGE_REENTRY_DELTA;
  const cooldownExpired = elapsed >= SIGNAL_COOLDOWN_MS;

  if (!sameSignalType) return true;
  if (scoreImproved) return true;
  if (changeExpanded) return true;
  if (cooldownExpired && score >= MIN_ACTIONABLE_SCORE) return true;

  return false;
}

function getSignalTtlMs(signal: Signal) {
  const score = Number(signal.finalScore ?? signal.score ?? 0);
  return score >= STRONG_BREAKOUT_SCORE ? STRONG_SIGNAL_TTL_MS : NORMAL_SIGNAL_TTL_MS;
}

function rememberEmittedSignal(signal: Signal, nowMs: number) {
  const symbol = signal.ticker;
  const nextSignal: Signal = {
    ...signal,
    reason: getSignalReason(signal),
    explanationLine: signal.explanationLine || getSignalReason(signal),
  };

  signalMemoryBySymbol.set(symbol, {
    symbol,
    lastSignalType: String(signal.signalType ?? "UNKNOWN"),
    lastScore: Number(signal.finalScore ?? signal.score ?? 0),
    lastChangePercent: Number(signal.changePercent ?? 0),
    lastAlertAt: nowMs,
    lastSeenAt: nowMs,
    lastBreakoutKey: buildBreakoutKey(signal),
    lastEmittedSignal: nextSignal,
  });
}

function updateSeenSignal(symbol: string, nowMs: number) {
  const memory = signalMemoryBySymbol.get(symbol);
  if (!memory) return;
  signalMemoryBySymbol.set(symbol, {
    ...memory,
    lastSeenAt: nowMs,
  });
}

function collectActiveSignalsFromMemory(nowMs: number) {
  const activeSignals: Signal[] = [];

  for (const [symbol, memory] of signalMemoryBySymbol.entries()) {
    if (nowMs - memory.lastSeenAt > SIGNAL_MEMORY_RETENTION_MS) {
      signalMemoryBySymbol.delete(symbol);
      continue;
    }

    if (nowMs - memory.lastAlertAt <= getSignalTtlMs(memory.lastEmittedSignal)) {
      activeSignals.push(memory.lastEmittedSignal);
    }
  }

  activeSignals.sort((left, right) => {
    if (right.finalScore !== left.finalScore) {
      return right.finalScore - left.finalScore;
    }

    return right.confidenceScore - left.confidenceScore;
  });

  return activeSignals;
}

function createEmptySymbolHealth(): PersistedSymbolHealth {
  return {
    recentOutcomes: [],
    lastHealthyAt: null,
    lastActiveAt: null,
    lastIncludedAt: null,
    coldUntil: null,
  };
}

function isSevereOutcome(outcome: SymbolHealthOutcome) {
  return outcome === "missing_quote" || outcome === "stale_quote" || outcome === "missing_volume" || outcome === "thin_liquidity";
}

function isHealthyOutcome(outcome: SymbolHealthOutcome) {
  return outcome === "healthy" || outcome === "cached";
}

function getOutcomeWeight(outcome: SymbolHealthOutcome) {
  switch (outcome) {
    case "healthy":
      return 11;
    case "cached":
      return 6;
    case "low_score":
      return 1;
    case "failed_confluence":
      return 0;
    case "thin_liquidity":
      return -7;
    case "missing_volume":
      return -9;
    case "stale_quote":
      return -10;
    case "missing_quote":
      return -12;
  }
}

function getAgeBoost(timestamp: string | null, nowMs: number, windows: Array<{ maxAgeMs: number; score: number }>) {
  if (!timestamp) {
    return 0;
  }

  const ageMs = nowMs - new Date(timestamp).getTime();
  if (ageMs < 0) {
    return 0;
  }

  const match = windows.find((window) => ageMs <= window.maxAgeMs);
  return match?.score ?? 0;
}

function scoreTickerHealth(ticker: WatchlistTicker, health: PersistedSymbolHealth | undefined, nowMs: number) {
  const symbolHealth = health ?? createEmptySymbolHealth();
  const coldUntilMs = symbolHealth.coldUntil ? new Date(symbolHealth.coldUntil).getTime() : 0;
  const isCold = coldUntilMs > nowMs;
  const recentScore = symbolHealth.recentOutcomes.reduce((score, item) => score + getOutcomeWeight(item.outcome), 0);
  const recentSevereFailures = symbolHealth.recentOutcomes.slice(0, 4).filter((item) => isSevereOutcome(item.outcome)).length;
  const recentHealthyCycles = symbolHealth.recentOutcomes.slice(0, 4).filter((item) => isHealthyOutcome(item.outcome)).length;

  let score = 20;
  score += recentScore;
  score += getAgeBoost(symbolHealth.lastHealthyAt, nowMs, [
    { maxAgeMs: 10 * 60_000, score: 12 },
    { maxAgeMs: 30 * 60_000, score: 6 },
  ]);
  score += getAgeBoost(symbolHealth.lastActiveAt, nowMs, [{ maxAgeMs: SYMBOL_SELECTION_STICKINESS_MS, score: 7 }]);
  score += getAgeBoost(symbolHealth.lastIncludedAt, nowMs, [{ maxAgeMs: 20 * 60_000, score: 5 }]);
  score -= recentSevereFailures * 4;
  score += recentHealthyCycles * 2;

  if (isCold) {
    score -= 60;
  }

  return score;
}

function selectActiveUniverse(
  state: PersistedSessionState,
  observedAt: string,
  candidates: WatchlistTicker[],
  targetSize: number,
) {
  const nowMs = new Date(observedAt).getTime();
  const rankedCandidates = [...candidates].sort((left, right) => {
    const leftScore = scoreTickerHealth(left, state.symbolHealth[left.ticker], nowMs);
    const rightScore = scoreTickerHealth(right, state.symbolHealth[right.ticker], nowMs);

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    return left.ticker.localeCompare(right.ticker);
  });

  const cappedTarget = Math.max(0, targetSize);
  const activeUniverse = rankedCandidates.slice(0, cappedTarget);
  const universeAdjusted = rankedCandidates.length > activeUniverse.length;
  const universeMessage = universeAdjusted
    ? `Dynamic universe capped to ${activeUniverse.length} symbols from ${rankedCandidates.length} discovered names.`
    : null;

  return {
    activeUniverse,
    universeAdjusted,
    universeMessage,
  };
}

function getHealthOutcome(item: { freshness: "fresh" | "cached" | "stale" | "missing"; exclusionReason?: string | null; hasActiveSignal: boolean }): SymbolHealthOutcome {
  if (item.freshness === "missing" || item.exclusionReason === "missing_quote") {
    return "missing_quote";
  }

  if (item.freshness === "stale" || item.exclusionReason === "stale_quote") {
    return "stale_quote";
  }

  if (item.exclusionReason === "missing_volume") {
    return "missing_volume";
  }

  if (item.exclusionReason === "thin_liquidity") {
    return "thin_liquidity";
  }

  if (item.freshness === "cached") {
    return "cached";
  }

  if (item.hasActiveSignal) {
    return "healthy";
  }

  if (item.exclusionReason === "failed_confluence") {
    return "failed_confluence";
  }

  if (item.exclusionReason === "low_score") {
    return "low_score";
  }

  return "healthy";
}

function countLeadingSevereFailures(outcomes: PersistedSymbolHealth["recentOutcomes"]) {
  let count = 0;

  for (const outcome of outcomes) {
    if (!isSevereOutcome(outcome.outcome)) {
      break;
    }

    count += 1;
  }

  return count;
}

function updateSymbolHealthState(
  previous: PersistedSymbolHealth | undefined,
  outcome: SymbolHealthOutcome,
  observedAt: string,
  included: boolean,
) {
  const prior = previous ?? createEmptySymbolHealth();
  const recentOutcomes = [{ outcome, observedAt }, ...prior.recentOutcomes].slice(0, SYMBOL_HEALTH_WINDOW);
  const recentSevereFailures = recentOutcomes.slice(0, 4).filter((item) => isSevereOutcome(item.outcome)).length;
  const leadingSevereFailures = countLeadingSevereFailures(recentOutcomes);
  const shouldGoCold = isSevereOutcome(outcome) && (recentSevereFailures >= 3 || leadingSevereFailures >= 2);

  return {
    recentOutcomes,
    lastHealthyAt: isHealthyOutcome(outcome) ? observedAt : prior.lastHealthyAt,
    lastActiveAt: observedAt,
    lastIncludedAt: included ? observedAt : prior.lastIncludedAt,
    coldUntil: isHealthyOutcome(outcome)
      ? null
      : shouldGoCold
        ? new Date(new Date(observedAt).getTime() + SYMBOL_COLD_DURATION_MS).toISOString()
        : prior.coldUntil && new Date(prior.coldUntil).getTime() > new Date(observedAt).getTime()
          ? prior.coldUntil
          : null,
  } satisfies PersistedSymbolHealth;
}

function appendRecentEvaluations(state: PersistedSessionState, signals: Signal[]) {
  for (const [index, signal] of signals.entries()) {
    const existing = state.recentEvaluations[signal.ticker] ?? [];
    const next = [
      {
        signalType: signal.signalType,
        timestamp: signal.timestamp,
        reason: signal.reason,
        confidence: signal.confidenceScore,
        finalScore: signal.finalScore,
        rank: index + 1,
      },
      ...existing,
    ].slice(0, 20);

    state.recentEvaluations[signal.ticker] = next;
  }
}

function createFallbackWatchlist(universe: WatchlistTicker[]) {
  return universe.map((ticker) => ({
    ...ticker,
    price: null,
    changePercent: null,
    timestamp: null,
    freshness: "missing" as const,
    quoteProvider: null,
    hasActiveSignal: false,
  }));
}

function createFallbackUniverseFromPersistedState(state: PersistedSessionState) {
  const fallback: WatchlistTicker[] = [];

  for (const item of state.lastWatchlist) {
    if (!item.ticker) continue;
    fallback.push({
      ticker: item.ticker,
      company: item.company,
      sector: item.sector,
      exchange: item.exchange,
      instrumentType: item.instrumentType,
      country: item.country,
      floatShares: item.floatShares ?? null,
      riskFlags: item.riskFlags ?? [],
    });
  }

  return fallback;
}

function buildDegradedSessionMessage(quotesResult: {
  ok: boolean;
  reason?: string;
  summary: {
    cached: number;
    fresh: number;
  };
}) {
  const cachedQuotes = quotesResult.summary.cached;
  const freshQuotes = quotesResult.summary.fresh;

  if (quotesResult.ok) {
    return "";
  }

  if (quotesResult.reason === "rate_limited") {
    if (cachedQuotes > 0) {
      return `Scanner is leaning on cached names while providers cool down. ${cachedQuotes} names are still usable this cycle.`;
    }

    return "Scanner is paused briefly while providers cool down.";
  }

  if (cachedQuotes > 0 && freshQuotes === 0) {
    return `Scanner is limited this cycle by upstream coverage. Showing cached names that still pass safety checks.`;
  }

  return "Scanner is limited this cycle by upstream coverage. Showing the healthiest names available.";
}

function getActiveDemandIntervalMs() {
  const runtimeConfig = getSignalRuntimeConfig();
  const hasRecentDemand = listeners.size > 0 || Date.now() - lastDemandAt < runtimeConfig.activeDemandWindowMs;
  return hasRecentDemand ? runtimeConfig.scanIntervalMs : runtimeConfig.idleScanIntervalMs;
}

function getLastQuoteUpdate(quotes: QuoteSnapshot[]) {
  return quotes.length > 0
    ? quotes.reduce((latest, quote) => {
        return !latest || new Date(quote.lastUpdated).getTime() > new Date(latest).getTime() ? quote.lastUpdated : latest;
      }, null as string | null)
    : null;
}

function deriveFastLaneTickers() {
  return Array.from(
    new Set([
      ...liveStateStore.activeSignals.map((signal) => signal.ticker),
      ...liveStateStore.volumeMovers.slice(0, LIVE_SESSION_FAST_LANE_VOLUME_COUNT).map((mover) => mover.ticker),
    ]),
  );
}

function deriveFastLaneTickersForCycle(activeTickers: string[]) {
  const derived = deriveFastLaneTickers();
  if (derived.length > 0) {
    return derived;
  }
  return activeTickers.slice(0, Math.min(activeTickers.length, LIVE_SESSION_FAST_LANE_VOLUME_COUNT));
}

async function ensurePersistedState(sessionDate: string) {
  if (persistedState?.sessionDate === sessionDate && latestPersistenceStatus) {
    return {
      state: persistedState,
      status: latestPersistenceStatus,
    };
  }

  const loaded = await loadPersistedSessionState(sessionDate);
  persistedState = loaded.state;
  latestPersistenceStatus = loaded.status;
  return loaded;
}

function updateSharedStore(snapshot: LiveSessionSnapshot, params: {
  quotes: QuoteSnapshot[];
  quoteStates: Record<string, QuoteState>;
  observedHighs: Record<string, number | null>;
  signals: Signal[];
  events: LiveEvent[];
  volumeSnapshots: VolumeSnapshot[];
  volumeMovers: VolumeMover[];
  persistence: PersistenceStatus;
  latencyMs: number;
  engineDiagnostics: SharedLiveStateStore["lastEngineDiagnostics"];
}) {
  liveStateStore.version += 1;
  liveStateStore.snapshot = snapshot;
  liveStateStore.latestQuotes = params.quotes;
  liveStateStore.quoteStates = params.quoteStates;
  liveStateStore.observedHighs = params.observedHighs;
  liveStateStore.activeSignals = params.signals;
  liveStateStore.events = params.events;
  liveStateStore.volumeMoverCandidates = params.volumeSnapshots;
  liveStateStore.volumeMovers = params.volumeMovers;
  liveStateStore.persistence = params.persistence;
  liveStateStore.sessionDate = snapshot.sessionDate;
  liveStateStore.sessionStatus = snapshot.sessionStatus;
  liveStateStore.sessionLabel = snapshot.sessionLabel;
  liveStateStore.lastCompletedAt = "generatedAt" in snapshot ? snapshot.generatedAt : snapshot.lastUpdated;
  liveStateStore.lastCycleLatencyMs = params.latencyMs;
  liveStateStore.lastEngineDiagnostics = params.engineDiagnostics;
}

function notifyListeners(snapshot: LiveSessionSnapshot) {
  for (const listener of listeners) {
    listener(snapshot);
  }
}

function scheduleNextCycle() {
  if (nextCycleTimer) {
    clearTimeout(nextCycleTimer);
  }

  nextCycleTimer = setTimeout(() => {
    void getLiveSessionSnapshot({ forceRefresh: true });
  }, getActiveDemandIntervalMs());
}

async function runLiveSessionCycle(): Promise<LiveSessionSnapshot> {
  const startedAt = Date.now();
  const runtimeConfig = getSignalRuntimeConfig();
  const marketClock = getMarketClock();
  console.log("[live-session-runtime] heartbeat ok", {
    sessionStatus: marketClock.sessionStatus,
    sessionLabel: marketClock.label,
  });
  const loaded = await ensurePersistedState(marketClock.sessionDate);
  await startMarketStream();

  if (Date.now() >= nextUniverseRefreshAt || cachedUniverseCandidates.length === 0) {
    const dynamicUniverse = getDynamicUniverseFromStream();
    cachedUniverseCandidates = dynamicUniverse.symbols;
    cachedUniverseDiscovery = {
      source: dynamicUniverse.source,
      discoveredCount: dynamicUniverse.discoveredCount,
      selectedCount: dynamicUniverse.selectedCount,
      topSymbols: dynamicUniverse.topSymbols,
      reasonsBySymbol: dynamicUniverse.reasonsBySymbol,
    };
    nextUniverseRefreshAt = Date.now() + runtimeConfig.universeRefreshMs;
  }

  const discoveredCandidates =
    cachedUniverseCandidates.length > 0
      ? cachedUniverseCandidates
      : createFallbackUniverseFromPersistedState(loaded.state);
  const universeSelection = selectActiveUniverse(
    loaded.state,
    new Date(startedAt).toISOString(),
    discoveredCandidates,
    runtimeConfig.maxSymbolsPerScan,
  );
  const activeUniverse = universeSelection.activeUniverse;
  const activeTickers = activeUniverse.map((ticker) => ticker.ticker);
  console.log("[live-session-runtime] scanning universe", {
    activeSymbols: activeTickers.length,
    discoveredCandidates: discoveredCandidates.length,
  });
  const fastLaneTickers = deriveFastLaneTickersForCycle(activeTickers);

  const quoteSnapshot = getMarketSnapshot(activeTickers);
  const streamHealth = getMarketStreamHealth();
  console.log("[live-session-runtime] activeUniverse count:", activeTickers.length);
  console.log("[live-session-runtime] fastLaneTickers count:", fastLaneTickers.length);
  console.log("[live-session-runtime] massive websocket connected:", streamHealth.connected);
  const quotesResult = {
    ok: quoteSnapshot.quotes.length > 0,
    degraded: quoteSnapshot.degraded || streamHealth.degraded,
    reason: quoteSnapshot.quotes.length > 0 ? undefined : "stream_unavailable",
    message:
      quoteSnapshot.quotes.length > 0
        ? "Live data served from shared market stream."
        : "Shared market stream has no quote data yet.",
    retryAfterMs: getActiveDemandIntervalMs(),
    quotes: quoteSnapshot.quotes,
    summary: quoteSnapshot.summary,
    quoteStates: quoteSnapshot.quoteStates,
    cacheTtlMs: quoteSnapshot.cacheTtlMs,
    staleAfterMs: quoteSnapshot.staleAfterMs,
    refreshBatchSize: quoteSnapshot.refreshBatchSize,
  };
  console.log("[live-session-runtime] quotesFresh:", quoteSnapshot.summary.fresh);
  console.log("[live-session-runtime] quotesFailed:", quoteSnapshot.summary.failed);

  const volumeSnapshots = getVolumeSnapshotsForSymbols(activeTickers);
  const volumeResult = {
    ok: true,
    snapshots: volumeSnapshots,
    message: null as string | null,
  };

  if (Date.now() >= nextNewsRefreshAt) {
    try {
      const newsResult = await fetchStructuredNewsSnapshots(activeTickers, {
        prioritizedTickers: fastLaneTickers,
      });
      cachedNewsByTicker = new Map(newsResult.snapshots.map((item) => [item.ticker, item]));
    } catch (error) {
      console.warn("[live-session-runtime]", "news_refresh_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    nextNewsRefreshAt = Date.now() + runtimeConfig.newsRefreshMs;
  }

  const newsSnapshots = activeTickers
    .map((ticker) => cachedNewsByTicker.get(ticker))
    .filter((item): item is StructuredNewsSnapshot => Boolean(item));

  const volumeMovers = volumeResult.ok ? computeVolumeMovers(volumeResult.snapshots) : [];
  const volumeMoversMessage =
    volumeResult.ok
      ? volumeMovers.length
        ? null
        : "No watchlist names currently meet the live price-plus-volume thresholds."
      : volumeResult.message;

  const marketData = {
    summary: quotesResult.summary,
    quoteStates: quotesResult.quoteStates,
    cacheTtlMs: quotesResult.cacheTtlMs,
    staleAfterMs: quotesResult.staleAfterMs,
    refreshBatchSize: quotesResult.refreshBatchSize,
  };

  const generatedAt = new Date().toISOString();
  const generatedAtMs = new Date(generatedAt).getTime();
  const engineState = createLiveSignalEngineState();
  engineState.tickers = { ...loaded.state.tickerState };
  const evaluation = evaluateLiveSignals({
    state: engineState,
    watchlist: activeUniverse,
    quotes: quotesResult.quotes,
    volumeSnapshots: volumeResult.snapshots,
    newsSnapshots,
    recentEvaluations: loaded.state.recentEvaluations,
    observedAt: generatedAt,
    sessionStatus: marketClock.sessionStatus,
    haltGuards: {
      isStreamReconnecting: streamHealth.reconnecting || streamHealth.inBootstrap || streamHealth.degraded,
      isRateLimited: streamHealth.rateBudgetLimited,
    },
  });
  const cycleEmittedSignals: Signal[] = [];
  for (const candidate of evaluation.signals) {
    const symbol = candidate.ticker;
    const memory = signalMemoryBySymbol.get(symbol);

    if (!isActionableMomentum(candidate)) {
      updateSeenSignal(symbol, generatedAtMs);
      continue;
    }

    if (!shouldEmitSignal(candidate, memory, generatedAtMs)) {
      updateSeenSignal(symbol, generatedAtMs);
      console.log("[live-session-runtime] signal suppressed by cooldown", {
        symbol,
        signalType: candidate.signalType,
        score: candidate.finalScore,
        changePercent: candidate.changePercent,
      });
      continue;
    }

    rememberEmittedSignal(candidate, generatedAtMs);
    cycleEmittedSignals.push({
      ...candidate,
      reason: getSignalReason(candidate),
      explanationLine: candidate.explanationLine || getSignalReason(candidate),
    });
    console.log("[live-session-runtime] signal emitted", {
      symbol,
      signalType: candidate.signalType,
      score: candidate.finalScore,
      changePercent: candidate.changePercent,
    });
  }
  const activeSignals = collectActiveSignalsFromMemory(generatedAtMs);
  if (cycleEmittedSignals.length === 0) {
    console.log("[live-session-runtime] no actionable momentum this cycle");
  }

  const volumeByTicker = new Map(volumeResult.snapshots.map((snapshot) => [snapshot.ticker, snapshot]));
  const topRejected = evaluation.watchlist
    .filter((item) => !item.hasActiveSignal)
    .map((item) => ({
      ticker: item.ticker,
      reason: item.exclusionReason ?? "none",
      changePercent: item.changePercent,
      freshness: item.freshness,
    }))
    .sort((left, right) => Math.abs(right.changePercent ?? 0) - Math.abs(left.changePercent ?? 0))
    .slice(0, 5);
  const sampleSnapshots = activeUniverse.slice(0, 3).map((ticker) => {
    const watchlistItem = evaluation.watchlist.find((item) => item.ticker === ticker.ticker);
    const volumeSnapshot = volumeByTicker.get(ticker.ticker);
    const history = engineState.tickers[ticker.ticker]?.history ?? [];
    const generatedAtMs = new Date(evaluation.generatedAt).getTime();
    const windowHistory = history
      .filter((point) => generatedAtMs - new Date(point.timestamp).getTime() <= runtimeConfig.momentumWindowMs)
      .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
    return {
      ticker: ticker.ticker,
      lastPrice: watchlistItem?.price ?? null,
      windowStartPrice: windowHistory[0]?.price ?? null,
      currentVolume: volumeSnapshot?.currentVolume ?? null,
      averageVolume: volumeSnapshot?.averageVolume ?? null,
      lastTradeTimestamp: watchlistItem?.timestamp ?? null,
      sessionStatus: marketClock.sessionStatus,
    };
  });
  const engineDiagnostics = {
    evaluatedSymbols: evaluation.watchlist.length,
    candidateSignals: evaluation.watchlist.filter((item) => Boolean(item.activeSignalType)).length,
    emittedSignals: cycleEmittedSignals.length,
    topRejected,
    sampleSnapshots,
  };
  const activeNowLayer = buildLiveAlertsNow({
    signals: activeSignals,
    previousState: loaded.state.activeNowState,
    observedAt: generatedAt,
    sessionStatus: marketClock.sessionStatus,
    sensitivityMode: runtimeConfig.sensitivityMode,
  });
  const eventLayer = buildLiveEvents({
    signals: cycleEmittedSignals,
    liveAlertsNow: activeNowLayer.alerts,
    previousState: loaded.state.eventState,
    observedAt: generatedAt,
    degraded: !quotesResult.ok,
  });
  const botFeedLayer = buildBotFeed({
    previousState: loaded.state.botFeedState,
    observedAt: generatedAt,
    sessionStatus: marketClock.sessionStatus,
    sessionLabel: marketClock.label,
    signals: activeSignals,
    liveAlertsNow: activeNowLayer.alerts,
    events: eventLayer.events,
  });
  const lastQuoteUpdate = getLastQuoteUpdate(quotesResult.quotes);
  const observedHighs = Object.fromEntries(
    activeUniverse.map((ticker) => [ticker.ticker, engineState.tickers[ticker.ticker]?.observedHigh ?? null]),
  );
  const symbolHealth = { ...loaded.state.symbolHealth };

  for (const item of evaluation.watchlist) {
    symbolHealth[item.ticker] = updateSymbolHealthState(
      symbolHealth[item.ticker],
      getHealthOutcome({
        freshness: item.freshness,
        exclusionReason: item.exclusionReason,
        hasActiveSignal: item.hasActiveSignal,
      }),
      generatedAt,
      item.hasActiveSignal,
    );
  }

  let snapshot: LiveSessionSnapshot;
  let nextPersistenceStatus = loaded.status;

  if (!quotesResult.ok) {
    const degradedState: PersistedSessionState = {
      sessionDate: marketClock.sessionDate,
      history: loaded.state.history,
      tickerState: engineState.tickers,
      recentEvaluations: { ...loaded.state.recentEvaluations },
      symbolHealth,
      eventState: eventLayer.nextState,
      botFeedState: botFeedLayer.nextState,
      activeNowState: activeNowLayer.nextState,
      lastUpdated: lastQuoteUpdate ?? loaded.state.lastUpdated,
      lastWatchlist: evaluation.watchlist.length > 0 ? evaluation.watchlist : loaded.state.lastWatchlist,
      lastSignals: activeSignals,
      persistedAt: loaded.state.persistedAt,
    };
    nextPersistenceStatus = await savePersistedSessionState(loaded.state, degradedState);
    persistedState = {
      ...degradedState,
      persistedAt: nextPersistenceStatus.lastPersistedAt,
    };
    latestPersistenceStatus = nextPersistenceStatus;

    snapshot = {
      ok: false,
      degraded: true,
      message: buildDegradedSessionMessage(quotesResult),
      retryAfterMs: getActiveDemandIntervalMs(),
      sessionDate: marketClock.sessionDate,
      sessionStatus: marketClock.sessionStatus,
      sessionLabel: marketClock.label,
      signals: activeSignals,
      watchlist:
        evaluation.watchlist.length > 0
          ? evaluation.watchlist
          : loaded.state.lastWatchlist.length > 0
            ? loaded.state.lastWatchlist
            : createFallbackWatchlist(activeUniverse),
      lastUpdated: lastQuoteUpdate ?? loaded.state.lastUpdated,
      persistence: nextPersistenceStatus,
      events: eventLayer.events,
      liveAlertsNow: activeNowLayer.alerts,
      botFeed: botFeedLayer.items,
      notifications: eventLayer.notifications,
      volumeMovers,
      volumeMoversMessage,
      activeUniverseTickers: activeTickers,
      universeAdjusted: universeSelection.universeAdjusted,
      universeMessage: universeSelection.universeMessage,
      marketData,
      diagnostics: engineDiagnostics,
    };
  } else {
    const nextState: PersistedSessionState = {
      sessionDate: marketClock.sessionDate,
      history: loaded.state.history,
      tickerState: engineState.tickers,
      recentEvaluations: { ...loaded.state.recentEvaluations },
      symbolHealth,
      eventState: eventLayer.nextState,
      botFeedState: botFeedLayer.nextState,
      activeNowState: activeNowLayer.nextState,
      lastUpdated: evaluation.generatedAt,
      lastWatchlist: evaluation.watchlist,
      lastSignals: activeSignals,
      persistedAt: loaded.state.persistedAt,
    };
    appendRecentEvaluations(nextState, activeSignals);
    nextPersistenceStatus = await savePersistedSessionState(loaded.state, nextState);
    persistedState = {
      ...nextState,
      persistedAt: nextPersistenceStatus.lastPersistedAt,
    };
    latestPersistenceStatus = nextPersistenceStatus;

    const healthyQuotes = quotesResult.summary.fresh + quotesResult.summary.cached;
    const freshnessSummary = `${healthyQuotes}/${quotesResult.summary.requested} quotes healthy, ${quotesResult.summary.stale} stale, ${quotesResult.summary.failed} unavailable.`;

    snapshot = {
      ok: true,
      degraded: false,
      message: nextPersistenceStatus.healthy
        ? quotesResult.summary.cached > 0 && quotesResult.summary.fresh === 0
          ? `Live rules are using cached watchlist quotes during ${marketClock.label.toLowerCase()} while providers recover. ${freshnessSummary}`
          : `Live rules are evaluating ${healthyQuotes} healthy watchlist quotes during ${marketClock.label.toLowerCase()}. ${freshnessSummary}`
        : quotesResult.summary.cached > 0 && quotesResult.summary.fresh === 0
          ? `Live rules are using cached watchlist quotes during ${marketClock.label.toLowerCase()} while providers recover. ${freshnessSummary} ${nextPersistenceStatus.message}`
          : `Live rules are evaluating ${healthyQuotes} healthy watchlist quotes during ${marketClock.label.toLowerCase()}. ${freshnessSummary} ${nextPersistenceStatus.message}`,
      retryAfterMs: getActiveDemandIntervalMs(),
      generatedAt: evaluation.generatedAt,
      sessionDate: marketClock.sessionDate,
      sessionStatus: marketClock.sessionStatus,
      sessionLabel: marketClock.label,
      signals: activeSignals,
      watchlist: evaluation.watchlist,
      lastUpdated: lastQuoteUpdate ?? evaluation.generatedAt,
      persistence: nextPersistenceStatus,
      events: eventLayer.events,
      liveAlertsNow: activeNowLayer.alerts,
      botFeed: botFeedLayer.items,
      notifications: eventLayer.notifications,
      volumeMovers,
      volumeMoversMessage,
      activeUniverseTickers: activeTickers,
      universeAdjusted: universeSelection.universeAdjusted,
      universeMessage: universeSelection.universeMessage,
      marketData,
      diagnostics: engineDiagnostics,
    };
  }

  updateSharedStore(snapshot, {
    quotes: quotesResult.quotes,
    quoteStates: quotesResult.quoteStates,
    observedHighs,
    signals: activeSignals,
    events: eventLayer.events,
    volumeSnapshots: volumeResult.snapshots,
    volumeMovers,
    persistence: nextPersistenceStatus,
    latencyMs: Date.now() - startedAt,
    engineDiagnostics,
  });

  console.log("[live-session-runtime]", "cycle", {
    universeDiscovery: {
      source: cachedUniverseDiscovery.source,
      discoveredCount: cachedUniverseDiscovery.discoveredCount,
      selectedCount: cachedUniverseDiscovery.selectedCount,
      topSymbols: cachedUniverseDiscovery.topSymbols.slice(0, 8),
      topReasons: Object.fromEntries(
        cachedUniverseDiscovery.topSymbols.slice(0, 5).map((symbol) => [
          symbol,
          cachedUniverseDiscovery.reasonsBySymbol[symbol] ?? "reason_unavailable",
        ]),
      ),
    },
    exclusionCounts: evaluation.watchlist.reduce(
      (acc, item) => {
        const key = item.exclusionReason ?? "none";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
    latencyMs: Date.now() - startedAt,
    degraded: snapshot.degraded,
    version: liveStateStore.version,
    activeUniverse: activeTickers,
    universeAdjusted: universeSelection.universeAdjusted,
    fastLaneTickers: fastLaneTickers.length,
    listeners: listeners.size,
    quotesFresh: quotesResult.summary.fresh,
    quotesCached: quotesResult.summary.cached,
    quotesFailed: quotesResult.summary.failed,
    volumeCandidates: volumeResult.snapshots.length,
    evaluatedSymbols: engineDiagnostics.evaluatedSymbols,
    candidateSignals: engineDiagnostics.candidateSignals,
    emittedSignals: engineDiagnostics.emittedSignals,
    topRejected: engineDiagnostics.topRejected,
    sampleSnapshots: engineDiagnostics.sampleSnapshots,
    volumeMovers: volumeMovers.length,
    events: eventLayer.events.length,
    notifications: eventLayer.notifications.length,
  });

  notifyListeners(snapshot);
  scheduleNextCycle();
  return snapshot;
}

export function subscribeToLiveSessionSnapshots(listener: SnapshotListener) {
  listeners.add(listener);
  lastDemandAt = Date.now();
  scheduleNextCycle();

  return () => {
    listeners.delete(listener);
    scheduleNextCycle();
  };
}

export async function getLiveSessionSnapshot(options?: { forceRefresh?: boolean }) {
  lastDemandAt = Date.now();

  if (!options?.forceRefresh && liveStateStore.snapshot) {
    scheduleNextCycle();
    return liveStateStore.snapshot;
  }

  if (!cyclePromise) {
    cyclePromise = runLiveSessionCycle().finally(() => {
      cyclePromise = null;
    });
  }

  return cyclePromise;
}

export function getSharedLiveStateStore() {
  return {
    ...liveStateStore,
    activeSignals: [...liveStateStore.activeSignals],
    events: [...liveStateStore.events],
    volumeMovers: [...liveStateStore.volumeMovers],
    volumeMoverCandidates: [...liveStateStore.volumeMoverCandidates],
    latestQuotes: [...liveStateStore.latestQuotes],
    quoteStates: { ...liveStateStore.quoteStates },
    observedHighs: { ...liveStateStore.observedHighs },
  };
}

export function getLiveSessionRuntimeStatus() {
  const snapshot = liveStateStore.snapshot;
  const runtimeConfig = getSignalRuntimeConfig();
  const signalDiagnostics = getLiveSignalEngineCycleDiagnostics();
  const lastSignalTime =
    liveStateStore.activeSignals.length > 0
      ? liveStateStore.activeSignals.reduce((latest, signal) => {
          return !latest || new Date(signal.timestamp).getTime() > new Date(latest).getTime() ? signal.timestamp : latest;
        }, null as string | null)
      : null;

  return {
    streamConnected: snapshot ? !snapshot.degraded : false,
    sessionStatus: liveStateStore.sessionStatus ?? "closed",
    lastScanAt: liveStateStore.lastCompletedAt,
    lastSignalAt: lastSignalTime,
    activeUniverseSize: snapshot?.activeUniverseTickers?.length ?? 0,
    activeSignalCount: liveStateStore.activeSignals.length,
    scanIntervalMs: runtimeConfig.scanIntervalMs,
    maxApiCallsPerMinute: runtimeConfig.maxApiCallsPerMinute,
    maxSymbolsPerScan: runtimeConfig.maxSymbolsPerScan,
    maxSignalsPerCycle: runtimeConfig.maxSignalsPerCycle,
    allowExtendedHoursHalt: runtimeConfig.allowExtendedHoursHalt,
    signalDiagnostics,
    engineDiagnostics: liveStateStore.lastEngineDiagnostics,
  };
}

export function __resetLiveSessionRuntimeForTests() {
  listeners.clear();

  if (nextCycleTimer) {
    clearTimeout(nextCycleTimer);
    nextCycleTimer = null;
  }

  cyclePromise = null;
  lastDemandAt = 0;
  persistedState = null;
  latestPersistenceStatus = null;
  cachedUniverseCandidates = [];
  cachedUniverseDiscovery = {
    source: "fallback_empty",
    discoveredCount: 0,
    selectedCount: 0,
    topSymbols: [],
    reasonsBySymbol: {},
  };
  nextUniverseRefreshAt = 0;
  cachedNewsByTicker = new Map();
  nextNewsRefreshAt = 0;
  signalMemoryBySymbol.clear();
  liveStateStore.version = 0;
  liveStateStore.snapshot = null;
  liveStateStore.latestQuotes = [];
  liveStateStore.quoteStates = {};
  liveStateStore.observedHighs = {};
  liveStateStore.activeSignals = [];
  liveStateStore.events = [];
  liveStateStore.volumeMoverCandidates = [];
  liveStateStore.volumeMovers = [];
  liveStateStore.persistence = null;
  liveStateStore.sessionDate = null;
  liveStateStore.sessionStatus = null;
  liveStateStore.sessionLabel = null;
  liveStateStore.lastCompletedAt = null;
  liveStateStore.lastCycleLatencyMs = null;
  liveStateStore.lastEngineDiagnostics = null;
}
