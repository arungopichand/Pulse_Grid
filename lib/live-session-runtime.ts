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
  getSymbolIntradayState,
  getVolumeSnapshotsForSymbols,
  startMarketStream,
} from "./market-stream";
import { getMassiveApiKey } from "./providers/massive";
import type { RunnerAlert } from "./runner-alerts";
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
let alertMemorySessionDate: string | null = null;
let cyclePromise: Promise<LiveSessionSnapshot> | null = null;
let nextCycleTimer: ReturnType<typeof setTimeout> | null = null;
let lastDemandAt = 0;
let cachedUniverseCandidates: WatchlistTicker[] = [];
let cachedUniverseDiscovery: {
  source: "live" | "cache" | "fallback_empty" | "retained_previous";
  discoveredCount: number;
  discoveredBeforeFilters: number;
  selectedCount: number;
  topSymbols: string[];
  reasonsBySymbol: Record<string, string>;
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
} = {
  source: "fallback_empty",
  discoveredCount: 0,
  discoveredBeforeFilters: 0,
  selectedCount: 0,
  topSymbols: [],
  reasonsBySymbol: {},
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
};
let nextUniverseRefreshAt = 0;
let lastNonEmptyUniverseCandidates: WatchlistTicker[] = [];
let lastNonEmptyUniverseAt = 0;
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
const STALE_QUOTE_EVICT_MS = 2 * 60 * 1000;
const UNIVERSE_STICKINESS_MS = 3 * 60 * 1000;
const SIGNAL_MEMORY_RETENTION_MS = 6 * 60 * 60 * 1000;
const RUNNER_ALERT_MIN_REPEAT_MS = 3 * 60_000;

type RunnerAlertState = {
  ticker: string;
  sessionDate: string;
  alertCountToday: number;
  dayHigh: number | null;
  sessionHigh: number | null;
  previousDayHigh: number | null;
  previousSessionHigh: number | null;
  lastAlertPrice: number | null;
  lastAlertHigh: number | null;
  lastAlertType: RunnerAlert["alertType"] | null;
  lastAlertAt: number | null;
  lastAlertScore: number | null;
  lastVolume: number | null;
  lastRelativeVolume: number | null;
  lastFormattedLine: string | null;
};

const runnerAlertStateByTicker = new Map<string, RunnerAlertState>();
const suppressedDuplicateAlerts: Array<{ time: string; ticker: string; alertType: RunnerAlert["alertType"]; reason: string }> = [];
const transitionLog: Array<{
  time: string;
  ticker: string;
  previousDayHigh: number | null;
  newDayHigh: number | null;
  previousSessionHigh: number | null;
  newSessionHigh: number | null;
  alertType: RunnerAlert["alertType"];
  emitted: boolean;
  suppressedReason: string | null;
}> = [];

function getPriceBucket(price: number) {
  if (price < 0.15) return "< $.15c";
  if (price < 0.5) return "< $.50c";
  if (price < 1) return "< $1";
  if (price < 2) return "< $2";
  if (price < 3) return "< $3";
  if (price < 5) return "< $5";
  if (price < 8) return "< $8";
  if (price < 10) return "< $10";
  return `< $${Math.ceil(price)}`;
}

function compactVolume(value: number | null) {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return m >= 100 ? `${Math.round(m)}M` : `${Math.round(m * 10) / 10}M`;
  }
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
  return `${Math.round(value)}`;
}

function compactRvol(value: number | null) {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  if (value >= 1000) return `${Math.round(value).toLocaleString("en-US")}x`;
  if (value >= 10) return `${Math.round(value)}x`;
  return `${Math.round(value * 10) / 10}x`;
}

function compactMoney(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value >= 1_000_000_000) return `${Math.round((value / 1_000_000_000) * 10) / 10}B`;
  if (value >= 1_000_000) return `${Math.round((value / 1_000_000) * 10) / 10}M`;
  if (value >= 1_000) return `${Math.round((value / 1_000) * 10) / 10}k`;
  return `${Math.round(value)}`;
}

type SignalEventType =
  | "MOMENTUM_BREAKOUT"
  | "NEW_HOD"
  | "SHARP_FALL"
  | "NEW_LOD"
  | "VOLUME_SPIKE"
  | "CONTINUATION";

type AlertMemory = {
  ticker: string;
  sequence: number;
  lastAlertAt: number;
  lastAlertType: SignalEventType;
  lastScore: number;
  lastPrice: number;
  lastDayHigh: number | null;
  lastDayLow: number | null;
  lastDirection: "UP" | "DOWN";
  lastSeenAt: number;
  lastEmittedSignal: Signal;
};

const signalMemoryBySymbol = new Map<string, AlertMemory>();

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

function getEventLabel(eventType: SignalEventType) {
  switch (eventType) {
    case "MOMENTUM_BREAKOUT":
      return "Momentum Breakout";
    case "NEW_HOD":
      return "New High Of Day";
    case "SHARP_FALL":
      return "Sharp Fall";
    case "NEW_LOD":
      return "New Low Of Day";
    case "VOLUME_SPIKE":
      return "Volume Spike";
    case "CONTINUATION":
      return "Continuation";
  }
}

function detectSignalEventType(candidate: Signal): SignalEventType | null {
  const intraday = getSymbolIntradayState(candidate.ticker);
  if (!intraday) {
    return null;
  }

  const price = Number(candidate.price ?? intraday.lastPrice ?? 0);
  const change = Number(candidate.changePercent ?? 0);
  const score = Number(candidate.finalScore ?? candidate.score ?? 0);
  const prevHigh = intraday.previousMinuteHigh;
  const prevLow = intraday.previousMinuteLow;

  const brokePrevHigh = typeof prevHigh === "number" && prevHigh > 0 && price > prevHigh;
  const brokePrevLow = typeof prevLow === "number" && prevLow > 0 && price < prevLow;
  const brokeDayHigh = typeof intraday.dayHigh === "number" && intraday.dayHigh > 0 && price > intraday.dayHigh;
  const brokeDayLow = typeof intraday.dayLow === "number" && intraday.dayLow > 0 && price < intraday.dayLow;
  const volumeSpike =
    typeof intraday.currentMinuteVolume === "number" &&
    typeof intraday.previousMinuteVolume === "number" &&
    intraday.previousMinuteVolume > 0 &&
    intraday.currentMinuteVolume >= intraday.previousMinuteVolume * 1.5;

  if (brokeDayHigh && change >= 1) return "NEW_HOD";
  if (brokeDayLow && change <= -1) return "NEW_LOD";
  if (brokePrevHigh && change >= 1 && score >= 70) return "MOMENTUM_BREAKOUT";
  if (brokePrevLow && change <= -1) return "SHARP_FALL";
  if (volumeSpike && Math.abs(change) >= 1) return "VOLUME_SPIKE";
  if (Math.abs(change) >= 1 && score >= 70) return "CONTINUATION";

  return null;
}

function shouldEmitSignal(candidate: Signal, memory: AlertMemory | undefined, nowMs: number, eventType: SignalEventType) {
  if (!memory) return true;

  const score = Number(candidate.finalScore ?? candidate.score ?? 0);
  const change = Number(candidate.changePercent ?? 0);
  const direction: "UP" | "DOWN" = change >= 0 ? "UP" : "DOWN";
  const priceBreak = memory.lastPrice > 0 ? Math.abs((candidate.price - memory.lastPrice) / memory.lastPrice) * 100 : 0;
  const scoreImproved = score >= memory.lastScore + SCORE_REENTRY_DELTA;
  const changeExpanded = Math.abs(change) >= Math.abs(memory.lastEmittedSignal.changePercent ?? 0) + CHANGE_REENTRY_DELTA;
  const directionChanged = direction !== memory.lastDirection;
  const eventTypeChanged = eventType !== memory.lastAlertType;
  const cooldownExpired = nowMs - memory.lastAlertAt >= SIGNAL_COOLDOWN_MS;
  const strongPriceBreak = priceBreak >= 0.75;
  const intraday = getSymbolIntradayState(candidate.ticker);
  const strongVolumeExpansion =
    Boolean(
      intraday &&
      typeof intraday.currentMinuteVolume === "number" &&
      typeof intraday.previousMinuteVolume === "number" &&
      intraday.previousMinuteVolume > 0 &&
      intraday.currentMinuteVolume >= intraday.previousMinuteVolume * 1.5,
    );

  if (eventType === "NEW_HOD" || eventType === "NEW_LOD") return true;
  if (eventTypeChanged) return true;
  if (scoreImproved) return true;
  if (changeExpanded) return true;
  if (strongPriceBreak) return true;
  if (directionChanged) return true;
  if (strongVolumeExpansion) return true;
  if (cooldownExpired) return true;

  return false;
}

function getSignalTtlMs(signal: Signal) {
  const score = Number(signal.finalScore ?? signal.score ?? 0);
  return score >= STRONG_BREAKOUT_SCORE ? STRONG_SIGNAL_TTL_MS : NORMAL_SIGNAL_TTL_MS;
}

function buildEventExplanation(signal: Signal, eventType: SignalEventType, sequence: number, hasVolume: boolean) {
  const prefix = `${signal.ticker} #${sequence}:`;
  if (eventType === "NEW_HOD") return `${prefix} new high of day after earlier alert.`;
  if (eventType === "NEW_LOD") return `${prefix} new low of day with downside continuation.`;
  if (eventType === "SHARP_FALL") return `${prefix} sharp downside move below previous candle low.`;
  if (eventType === "VOLUME_SPIKE" && hasVolume) return `${prefix} volume spike with aligned price expansion.`;
  if (eventType === "CONTINUATION") return `${prefix} continuation with stronger move than prior alert.`;
  return `${prefix} first momentum breakout${hasVolume ? " with strong relative volume." : "."}`;
}

function rememberEmittedSignal(signal: Signal, nowMs: number, eventType: SignalEventType) {
  const memory = signalMemoryBySymbol.get(signal.ticker);
  const sequence = (memory?.sequence ?? 0) + 1;
  const intraday = getSymbolIntradayState(signal.ticker);
  const hasVolume = typeof signal.relativeVolume === "number" || (typeof signal.currentVolume === "number" && typeof signal.averageVolume === "number");
  const nextSignal: Signal = {
    ...signal,
    alertSequence: sequence,
    eventType,
    eventLabel: getEventLabel(eventType),
    emittedAt: new Date(nowMs).toISOString(),
    source: "Massive",
    reason: getSignalReason(signal),
    explanationLine: buildEventExplanation(signal, eventType, sequence, hasVolume),
  };

  signalMemoryBySymbol.set(signal.ticker, {
    ticker: signal.ticker,
    sequence,
    lastAlertAt: nowMs,
    lastAlertType: eventType,
    lastScore: Number(signal.finalScore ?? signal.score ?? 0),
    lastPrice: Number(signal.price ?? 0),
    lastDayHigh: intraday?.dayHigh ?? null,
    lastDayLow: intraday?.dayLow ?? null,
    lastDirection: (signal.changePercent ?? 0) >= 0 ? "UP" : "DOWN",
    lastSeenAt: nowMs,
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
  const maxPrice = cachedUniverseDiscovery.scannerThresholds.maxPrice;

  for (const [symbol, memory] of signalMemoryBySymbol.entries()) {
    if (nowMs - memory.lastSeenAt > SIGNAL_MEMORY_RETENTION_MS) {
      signalMemoryBySymbol.delete(symbol);
      continue;
    }

    const price = Number(memory.lastEmittedSignal.price ?? 0);
    const changePercent = Number(memory.lastEmittedSignal.changePercent ?? 0);
    if (price > maxPrice || changePercent <= -7) {
      signalMemoryBySymbol.delete(symbol);
      continue;
    }

    if (nowMs - memory.lastSeenAt > STALE_QUOTE_EVICT_MS) {
      signalMemoryBySymbol.delete(symbol);
      continue;
    }

    if (nowMs - memory.lastAlertAt <= getSignalTtlMs(memory.lastEmittedSignal)) {
      const retainedAgeMs = Math.max(0, nowMs - memory.lastAlertAt);
      const retained = retainedAgeMs > getActiveDemandIntervalMs();
      activeSignals.push({
        ...memory.lastEmittedSignal,
        retained,
        retainedReason: retained ? "Last valid live signal retained while waiting for next confirmation." : null,
        retainedAgeMs,
      });
    }
  }

  activeSignals.sort((left, right) => {
    const scoreDelta = (right.finalScore ?? right.score ?? 0) - (left.finalScore ?? left.score ?? 0);
    if (scoreDelta !== 0) return scoreDelta;
    const changeDelta = (right.changePercent ?? 0) - (left.changePercent ?? 0);
    if (changeDelta !== 0) return changeDelta;
    return left.ticker.localeCompare(right.ticker);
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
  if (alertMemorySessionDate !== marketClock.sessionDate) {
    signalMemoryBySymbol.clear();
    alertMemorySessionDate = marketClock.sessionDate;
  }
  console.log("[live-session-runtime] heartbeat ok", {
    sessionStatus: marketClock.sessionStatus,
    sessionLabel: marketClock.label,
  });
  const loaded = await ensurePersistedState(marketClock.sessionDate);
  await startMarketStream();

  if (Date.now() >= nextUniverseRefreshAt || cachedUniverseCandidates.length === 0) {
    const dynamicUniverse = getDynamicUniverseFromStream();
    const discoveryEmpty = dynamicUniverse.symbols.length === 0;
    const canRetainUniverse =
      discoveryEmpty &&
      lastNonEmptyUniverseCandidates.length > 0 &&
      Date.now() - lastNonEmptyUniverseAt <= UNIVERSE_STICKINESS_MS;
    cachedUniverseCandidates = canRetainUniverse ? lastNonEmptyUniverseCandidates : dynamicUniverse.symbols;
    if (dynamicUniverse.symbols.length > 0) {
      lastNonEmptyUniverseCandidates = dynamicUniverse.symbols;
      lastNonEmptyUniverseAt = Date.now();
    }
    cachedUniverseDiscovery = {
      source: canRetainUniverse ? "retained_previous" : dynamicUniverse.source,
      discoveredCount: dynamicUniverse.discoveredCount,
      discoveredBeforeFilters: dynamicUniverse.discoveredBeforeFilters,
      selectedCount: canRetainUniverse ? lastNonEmptyUniverseCandidates.length : dynamicUniverse.selectedCount,
      topSymbols: canRetainUniverse ? lastNonEmptyUniverseCandidates.slice(0, 20).map((ticker) => ticker.ticker) : dynamicUniverse.topSymbols,
      reasonsBySymbol: canRetainUniverse ? { __universe__: "Retained previous active universe while waiting for next discovery refresh." } : dynamicUniverse.reasonsBySymbol,
      scannerThresholds: dynamicUniverse.scannerThresholds,
      rejectionReasonCounts: dynamicUniverse.rejectionReasonCounts,
      topCandidates: dynamicUniverse.topCandidates,
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
  const massiveApiKeyConfigured = Boolean(getMassiveApiKey());
  const noQualifyingSymbols = activeTickers.length === 0;
  const hasAnyQuotes = quotesResult.summary.fresh + quotesResult.summary.cached + quotesResult.summary.stale > 0;
  const primaryMessages: string[] = [];
  if (!massiveApiKeyConfigured) {
    primaryMessages.push("Massive API key is missing.");
  }
  if (noQualifyingSymbols) {
    primaryMessages.push("No qualifying momentum symbols right now.");
    if (marketClock.sessionStatus === "premarket") {
      primaryMessages.push("Massive movers empty; premarket data may not have populated yet.");
    }
  }
  if (!streamHealth.connected) {
    primaryMessages.push("WebSocket disconnected.");
  }
  if (streamHealth.wsMessagesReceived > 0 && streamHealth.wsUpdatesApplied === 0) {
    primaryMessages.push("WebSocket connected but no trade ticks received.");
  }
  if (primaryMessages.length === 0) {
    primaryMessages.push("Scanner is live.");
  }
  const scannerDiagnostics = {
    massiveApiKeyConfigured,
    universeSource: cachedUniverseDiscovery.source,
    activeUniverseCount: activeTickers.length,
    discoveredCount: cachedUniverseDiscovery.discoveredCount,
    discoveredBeforeFilters: cachedUniverseDiscovery.discoveredBeforeFilters,
    selectedCount: cachedUniverseDiscovery.selectedCount,
    noQualifyingSymbols,
    websocketConnected: streamHealth.connected,
    websocketAuthenticated: streamHealth.authenticated ?? null,
    websocketSubscribedCount: streamHealth.subscribedSymbolCount,
    websocketMessagesReceived: streamHealth.wsMessagesReceived,
    websocketUpdatesApplied: streamHealth.wsUpdatesApplied,
    websocketDegradedReason: streamHealth.degradedReason ?? null,
    quoteFresh: quotesResult.summary.fresh,
    quoteCached: quotesResult.summary.cached,
    quoteStale: quotesResult.summary.stale,
    quoteFailed: quotesResult.summary.failed,
    primaryMessages,
    retainedUniverse: cachedUniverseDiscovery.source === "retained_previous",
    retainedUniverseCount: cachedUniverseDiscovery.source === "retained_previous" ? cachedUniverseCandidates.length : 0,
    retainedSignalCount: 0 as number,
    activeSignalMemoryCount: signalMemoryBySymbol.size,
    latestSnapshotSignalCount: 0 as number,
    uiRetentionTtlMs: NORMAL_SIGNAL_TTL_MS,
    lastSignalReceivedAt: null as string | null,
    lastNonEmptySignalTimestamp: null as string | null,
    flickerProtectionActive: false as boolean,
    scannerThresholds: cachedUniverseDiscovery.scannerThresholds,
    rejectionReasonCounts: { ...cachedUniverseDiscovery.rejectionReasonCounts },
    topCandidates: cachedUniverseDiscovery.topCandidates,
  } satisfies NonNullable<LiveSessionSnapshot["scannerDiagnostics"]>;

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
    const eventType = detectSignalEventType(candidate);

    if (!isActionableMomentum(candidate)) {
      updateSeenSignal(symbol, generatedAtMs);
      continue;
    }
    if (!eventType) {
      updateSeenSignal(symbol, generatedAtMs);
      continue;
    }

    if (!shouldEmitSignal(candidate, memory, generatedAtMs, eventType)) {
      updateSeenSignal(symbol, generatedAtMs);
      console.log("[live-session-runtime] signal suppressed by cooldown", {
        symbol,
        signalType: candidate.signalType,
        score: candidate.finalScore,
        changePercent: candidate.changePercent,
      });
      continue;
    }

    rememberEmittedSignal(candidate, generatedAtMs, eventType);
    const remembered = signalMemoryBySymbol.get(symbol);
    if (!remembered) {
      continue;
    }
    cycleEmittedSignals.push({
      ...remembered.lastEmittedSignal,
    });
    console.log("[live-session-runtime] signal emitted", {
      symbol,
      signalType: candidate.signalType,
      score: candidate.finalScore,
      changePercent: candidate.changePercent,
    });
  }
  const activeSignals = collectActiveSignalsFromMemory(generatedAtMs);
  const retainedSignalCount = activeSignals.filter((signal) => signal.retained).length;
  const memoryLastSignalAt =
    [...signalMemoryBySymbol.values()]
      .map((memory) => memory.lastSeenAt)
      .sort((a, b) => b - a)[0] ?? null;
  const lastNonEmptySignalTimestamp =
    activeSignals.length > 0
      ? [...activeSignals]
          .sort((a, b) => new Date(b.emittedAt ?? b.timestamp).getTime() - new Date(a.emittedAt ?? a.timestamp).getTime())[0]?.emittedAt ??
        [...activeSignals].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0]?.timestamp ??
        null
      : null;
  scannerDiagnostics.retainedSignalCount = retainedSignalCount;
  scannerDiagnostics.activeSignalMemoryCount = signalMemoryBySymbol.size;
  scannerDiagnostics.latestSnapshotSignalCount = cycleEmittedSignals.length;
  scannerDiagnostics.lastSignalReceivedAt = memoryLastSignalAt ? new Date(memoryLastSignalAt).toISOString() : null;
  scannerDiagnostics.lastNonEmptySignalTimestamp = lastNonEmptySignalTimestamp;
  scannerDiagnostics.flickerProtectionActive = retainedSignalCount > 0 || scannerDiagnostics.retainedUniverse === true;
  if (hasAnyQuotes && activeSignals.length === 0) {
    const liveQuotesNoSignalMessage = "Live quotes available but no signal passed momentum filters.";
    if (!scannerDiagnostics.primaryMessages.includes(liveQuotesNoSignalMessage)) {
      scannerDiagnostics.primaryMessages.push(liveQuotesNoSignalMessage);
    }
  }
  if (
    scannerDiagnostics.primaryMessages.length === 1 &&
    scannerDiagnostics.primaryMessages[0] === "Scanner is live." &&
    hasAnyQuotes &&
    activeSignals.length === 0
  ) {
    scannerDiagnostics.primaryMessages.shift();
  }
  if (cycleEmittedSignals.length === 0) {
    console.log("[live-session-runtime] no actionable momentum this cycle");
  }

  const volumeByTicker = new Map(volumeResult.snapshots.map((snapshot) => [snapshot.ticker, snapshot]));
  const activeSignalByTicker = new Map(activeSignals.map((signal) => [signal.ticker, signal]));
  const volumeSpikeOnlyCandidates = evaluation.watchlist
    .filter((item) => !activeSignalByTicker.has(item.ticker))
    .filter((item) => item.freshness === "fresh" || item.freshness === "cached")
    .map((item) => {
      const meta = activeUniverse.find((ticker) => ticker.ticker === item.ticker);
      const volume = volumeByTicker.get(item.ticker);
      const price = item.price;
      const changePercent = item.changePercent;
      if (!meta || price === null || changePercent === null) return null;
      return ({
        id: `volume-spike-only-${item.ticker}-${item.timestamp ?? generatedAt}`,
        ticker: item.ticker,
        company: meta.company,
        signalType: "VOLUME_BREAKOUT" as const,
        severityScore: 0,
        signalState: "active" as const,
        price,
        timestamp: item.timestamp ?? generatedAt,
        confidence: "MEDIUM" as const,
        confidenceScore: 0,
        reason: "Volume spike candidate from live watchlist.",
        reasons: ["volume_spike_candidate"],
        changePercent,
        quoteFreshness: item.freshness as "fresh" | "cached",
        quoteProvider: item.quoteProvider ?? "massive",
        degraded: false,
        sector: meta.sector,
        exchange: meta.exchange,
        countryCode: meta.country,
        instrumentType: meta.instrumentType,
        tags: [],
        score: 0,
        finalScore: 0,
        scoreBreakdown: { momentumScore: 0, volumeScore: 0, newsScore: 0, trendScore: 0, finalScore: 0 },
        factors: { strongMove: changePercent > 0, volumeSpike: true, news: false, trending: false },
        factorCount: 1,
        newsSentiment: "none" as const,
        news: {
          availability: "unavailable" as const,
          hasNews: false,
          bullishNews: false,
          bearishNews: false,
          sentimentScore: null,
          bullishPercent: null,
          bearishPercent: null,
          headline: null,
          source: null,
          publishedAt: null,
          provider: null,
        },
        topOpportunity: false,
        reasonBadges: [],
        relativeVolume:
          volume && volume.averageVolume > 0
            ? volume.currentVolume / volume.averageVolume
            : null,
        currentVolume: volume?.currentVolume ?? null,
        averageVolume: volume?.averageVolume ?? null,
        streakCount: 1,
        sourceData: ["massive"],
        volumeRatio:
          volume && volume.averageVolume > 0
            ? volume.currentVolume / volume.averageVolume
            : null,
        freezeSeconds: 0,
        reappearance: {
          isReappearing: false,
          strongerReappearance: false,
          label: null,
          scoreBoost: 0,
          lastSeenAt: null,
          lastScore: null,
          lastRank: null,
        },
        floatShares: meta.floatShares ?? null,
        alertSummary: "",
        explanationLine: "",
        primaryPatternLabel: "momentum-build" as const,
        secondaryReasonLabel: null,
        occurrenceCount: 1,
        sequenceLabel: null,
        priceBucketLabel: "",
        volume: volume?.currentVolume ?? null,
        themeTags: [],
        specialTags: [],
        haltStatus: "active" as const,
        riskFlags: [],
      } as unknown as Signal);
    })
    .filter(Boolean) as Signal[];

  const alerts: RunnerAlert[] = [];
  for (const signal of [...activeSignals, ...volumeSpikeOnlyCandidates]) {
    const prior = runnerAlertStateByTicker.get(signal.ticker) ?? {
      ticker: signal.ticker,
      sessionDate: marketClock.sessionDate,
      alertCountToday: 0,
      dayHigh: null,
      sessionHigh: null,
      previousDayHigh: null,
      previousSessionHigh: null,
      lastAlertPrice: null,
      lastAlertHigh: null,
      lastAlertType: null,
      lastAlertAt: null,
      lastAlertScore: null,
      lastVolume: null,
      lastRelativeVolume: null,
      lastFormattedLine: null,
    };
    if (prior.sessionDate !== marketClock.sessionDate) {
      prior.alertCountToday = 0;
      prior.dayHigh = null;
      prior.sessionHigh = null;
      prior.previousDayHigh = null;
      prior.previousSessionHigh = null;
      prior.lastAlertPrice = null;
      prior.lastAlertHigh = null;
      prior.lastAlertType = null;
      prior.lastAlertAt = null;
      prior.lastAlertScore = null;
      prior.lastVolume = null;
      prior.lastRelativeVolume = null;
      prior.lastFormattedLine = null;
      prior.sessionDate = marketClock.sessionDate;
    }
    const price = Number(signal.price ?? 0);
    const currentVolume = signal.currentVolume ?? null;
    const averageVolume = signal.averageVolume ?? null;
    const rvol = signal.relativeVolume ?? null;
    const previousDayHigh = prior.dayHigh;
    const previousSessionHigh = prior.sessionHigh;
    const nextDayHigh = prior.dayHigh === null ? price : Math.max(prior.dayHigh, price);
    const nextSessionHigh = prior.sessionHigh === null ? price : Math.max(prior.sessionHigh, price);
    const quoteFreshEnough = signal.quoteFreshness === "fresh" || signal.quoteFreshness === "cached";
    const scannerThresholds = cachedUniverseDiscovery.scannerThresholds;
    const withinScannerPriceBounds = price >= scannerThresholds.minPrice && price <= scannerThresholds.maxPrice;
    const volumePassesIfAvailable = currentVolume === null || currentVolume >= scannerThresholds.minVolume;
    const dayHighUpdated = nextDayHigh > (previousDayHigh ?? Number.NEGATIVE_INFINITY);
    const sessionHighUpdated = nextSessionHigh > (previousSessionHigh ?? Number.NEGATIVE_INFINITY);
    const isNhodTransition =
      quoteFreshEnough &&
      price > 0 &&
      withinScannerPriceBounds &&
      volumePassesIfAvailable &&
      (previousDayHigh === null || price > previousDayHigh) &&
      dayHighUpdated;
    const isNshTransition =
      quoteFreshEnough &&
      price > 0 &&
      (previousSessionHigh === null || price > previousSessionHigh) &&
      sessionHighUpdated &&
      (marketClock.sessionStatus === "premarket" || marketClock.sessionStatus === "regular" || marketClock.sessionStatus === "after-hours");
    const isGreenBars = signal.signalType === "GREEN_CANDLE_MOMENTUM";
    const isVolumeSpike =
      quoteFreshEnough &&
      withinScannerPriceBounds &&
      ((rvol !== null && rvol >= 3) || (currentVolume !== null && currentVolume >= 100_000));
    const hasNews = Boolean(signal.newsHeadline);
    const haltStatus: RunnerAlert["haltStatus"] = "none";
    const isNewsPendingHalt = false;
    const isHaltedUp = false;
    const isHaltedDown = false;
    const hasTheme = Boolean(signal.theme);
    const hasSqueezeData =
      (signal.costToBorrowPercent !== null && signal.costToBorrowPercent !== undefined && signal.costToBorrowPercent >= 20) ||
      (signal.shortInterestPercent !== null && signal.shortInterestPercent !== undefined && signal.shortInterestPercent >= 20);
    let alertType: RunnerAlert["alertType"] = "TEST";
    if (isNewsPendingHalt) alertType = "NEWS_PENDING_HALT";
    else if (isHaltedUp) alertType = "HALTED_UP";
    else if (isHaltedDown) alertType = "HALTED_DOWN";
    else if (hasNews) alertType = "PR_SPIKE";
    else if (isNhodTransition) alertType = "NHOD";
    else if (isNshTransition) alertType = "NSH";
    else if (isGreenBars) alertType = "GREEN_BARS";
    else if (isVolumeSpike) alertType = "VOLUME_SPIKE";
    else if (hasTheme) alertType = "THEME";
    else if (hasSqueezeData) alertType = "SQUEEZE_WATCH";
    const newHigh = prior.lastAlertHigh !== null ? price > prior.lastAlertHigh : true;
    const alertTypeChanged = prior.lastAlertType !== alertType;
    const rvolImproved = prior.lastRelativeVolume !== null && rvol !== null ? rvol >= prior.lastRelativeVolume * 1.2 : false;
    const volImproved = prior.lastVolume !== null && currentVolume !== null ? currentVolume >= prior.lastVolume * 1.1 : false;
    const priorChange = prior.lastAlertPrice !== null ? ((price - prior.lastAlertPrice) / Math.max(0.00001, prior.lastAlertPrice)) * 100 : null;
    const currentChange = signal.changePercent ?? 0;
    const changeImproved = priorChange !== null ? (currentChange - priorChange) >= 5 : false;
    const cooldownPassed = prior.lastAlertAt === null ? true : generatedAtMs - prior.lastAlertAt >= RUNNER_ALERT_MIN_REPEAT_MS;
    const haltOrNewsEvent = alertType === "PR_SPIKE" || alertType === "NEWS_PENDING_HALT" || alertType === "HALTED_UP" || alertType === "HALTED_DOWN";
    const shouldEmitBase = newHigh || alertTypeChanged || rvolImproved || volImproved || changeImproved || cooldownPassed || haltOrNewsEvent;
    const recentAlertSuppressed =
      prior.lastAlertAt !== null &&
      generatedAtMs - prior.lastAlertAt < RUNNER_ALERT_MIN_REPEAT_MS &&
      !volImproved &&
      !rvolImproved;
    const shouldEmit =
      alertType === "VOLUME_SPIKE"
        ? isVolumeSpike && quoteFreshEnough && withinScannerPriceBounds && !recentAlertSuppressed
        : alertType === "TEST"
          ? false
          : shouldEmitBase;
    const direction: "up" | "down" | "flat" = signal.changePercent > 0 ? "up" : signal.changePercent < 0 ? "down" : "flat";
    const alertCountToday = shouldEmit ? prior.alertCountToday + 1 : prior.alertCountToday;
    const timeLabel = new Date(signal.timestamp).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: alertType.includes("HALTED") ? "2-digit" : undefined,
      hour12: false,
      timeZone: "America/New_York",
    });
    const intradayState = getSymbolIntradayState(signal.ticker);
    const rvolLabel = compactRvol(rvol);
    const volLabel = compactVolume(currentVolume);
    const floatLabel = signal.floatShares !== null ? compactMoney(signal.floatShares) : null;
    const marketCapLabel = signal.marketCap !== null ? compactMoney(signal.marketCap) : null;
    const arrow = alertType === "GREEN_BARS" ? "↗" : direction === "up" ? "↑" : direction === "down" ? "↓" : "→";
    const baseLine = `${timeLabel} ${arrow} ${signal.ticker} ${getPriceBucket(price)} ${Math.round(currentChange)}% · ${alertCountToday} ${alertType}`;
    let formattedLine = baseLine;
    if (alertType === "GREEN_BARS") {
      const greenBarsCount = intradayState?.greenCandleCount ?? null;
      const barsText = greenBarsCount !== null ? `${Math.max(1, Math.min(greenBarsCount, 5))} green bars 3m` : "green bars";
      const segments = [
        signal.countryFlag ?? null,
        floatLabel ? `Float: ${floatLabel}` : null,
        rvolLabel ? `RVol: ${rvolLabel}` : null,
        volLabel ? `Vol: ${volLabel}` : null,
        signal.newsHeadline ? "PR⬏" : null,
      ].filter((value): value is string => Boolean(value));
      formattedLine = `${timeLabel} ${arrow} ${signal.ticker} ${getPriceBucket(price)} ${Math.round(currentChange)}% · ${alertCountToday} ${barsText}${segments.length ? ` ~ ${segments.join(" | ")}` : ""}`;
    } else if (alertType === "HALTED_UP" || alertType === "HALTED_DOWN" || alertType === "NEWS_PENDING_HALT") {
      const haltLabel =
        alertType === "HALTED_UP" ? "Halted UP" : alertType === "HALTED_DOWN" ? "Halted DOWN" : "Halted | News Pending";
      formattedLine = `${timeLabel} ${signal.ticker} ${haltLabel} | Volatility → $${price.toFixed(2)}${volLabel ? ` ~ ${volLabel} vol` : ""}`;
    } else if (alertType === "PR_SPIKE") {
      const segments = [
        signal.countryFlag ?? null,
        floatLabel ? `Float: ${floatLabel}` : null,
        signal.institutionalOwnershipPercent !== null && signal.institutionalOwnershipPercent !== undefined ? `IO: ${signal.institutionalOwnershipPercent.toFixed(2)}%` : null,
        marketCapLabel ? `MC: ${marketCapLabel}` : null,
        signal.theme ? `Theme: ${signal.theme}` : null,
      ].filter((value): value is string => Boolean(value));
      formattedLine = `${timeLabel} PR-SPIKE ${signal.ticker} ${getPriceBucket(price)} - ${signal.newsHeadline ?? "news"}${signal.newsUrl ? " - Link" : ""}${segments.length ? ` ~ ${segments.join(" | ")}` : ""}`;
    } else {
      const segments = [
        signal.countryFlag ?? null,
        floatLabel ? `Float: ${floatLabel}` : null,
        rvolLabel ? `RVol: ${rvolLabel}` : null,
        volLabel ? `Vol: ${volLabel}` : null,
        signal.shortInterestPercent !== null && signal.shortInterestPercent !== undefined ? `SI: ${signal.shortInterestPercent.toFixed(1)}%` : null,
        signal.costToBorrowPercent !== null && signal.costToBorrowPercent !== undefined && signal.costToBorrowPercent >= 20 ? "High CTB" : null,
        signal.theme ? `Theme: ${signal.theme}` : null,
      ].filter((value): value is string => Boolean(value));
      formattedLine = segments.length ? `${baseLine} ~ ${segments.join(" | ")}` : baseLine;
    }
    const enrichedAlert: RunnerAlert = {
      id: `${signal.ticker}-${generatedAtMs}-${alertType}-${alertCountToday}`,
      ticker: signal.ticker,
      timestamp: signal.timestamp,
      alertTime: timeLabel,
      source: hasNews ? "news" : "massive",
      direction,
      alertType,
      tickerPrice: signal.price ?? null,
      priceBucket: getPriceBucket(price),
      changePercent: signal.changePercent ?? null,
      alertCountToday,
      countryCode: signal.countryCode ?? null,
      countryFlag: signal.countryFlag ?? null,
      currentVolume,
      averageVolume,
      relativeVolume: rvol,
      floatShares: signal.floatShares ?? null,
      marketCap: signal.marketCap ?? null,
      institutionalOwnershipPercent: signal.institutionalOwnershipPercent ?? null,
      shortInterestPercent: signal.shortInterestPercent ?? null,
      costToBorrowPercent: signal.costToBorrowPercent ?? null,
      highCostToBorrow: Boolean(signal.costToBorrowPercent !== null && signal.costToBorrowPercent !== undefined && signal.costToBorrowPercent >= 20),
      theme: signal.theme ?? null,
      newsHeadline: signal.newsHeadline ?? null,
      newsUrl: signal.newsUrl ?? null,
      haltStatus: haltStatus ?? "none",
      haltReason: null,
      sessionHigh: nextSessionHigh,
      dayHigh: nextDayHigh,
      previousSessionHigh,
      previousDayHigh,
      score: signal.finalScore,
      reason: signal.reason,
      formattedLine,
      retained: signal.retained ?? false,
      retainedReason: signal.retainedReason ?? null,
      retainedAgeMs: signal.retainedAgeMs ?? null,
    };

    runnerAlertStateByTicker.set(signal.ticker, {
      ticker: signal.ticker,
      sessionDate: marketClock.sessionDate,
      alertCountToday,
      dayHigh: nextDayHigh,
      sessionHigh: nextSessionHigh,
      previousDayHigh,
      previousSessionHigh,
      lastAlertPrice: shouldEmit ? price : prior.lastAlertPrice,
      lastAlertHigh: shouldEmit ? Math.max(prior.lastAlertHigh ?? price, price) : prior.lastAlertHigh,
      lastAlertType: shouldEmit ? alertType : prior.lastAlertType,
      lastAlertAt: shouldEmit ? generatedAtMs : prior.lastAlertAt,
      lastAlertScore: shouldEmit ? signal.finalScore : prior.lastAlertScore,
      lastVolume: shouldEmit ? currentVolume : prior.lastVolume,
      lastRelativeVolume: shouldEmit ? rvol : prior.lastRelativeVolume,
      lastFormattedLine: shouldEmit ? formattedLine : prior.lastFormattedLine,
    });
    const suppressedReason =
      shouldEmit
        ? null
        : alertType === "TEST"
          ? "unclassified_event_skipped"
        : alertType === "VOLUME_SPIKE" && recentAlertSuppressed
          ? "volume_spike_cooldown_no_strength_increase"
          : "duplicate_not_stronger";
    transitionLog.push({
      time: signal.timestamp,
      ticker: signal.ticker,
      previousDayHigh,
      newDayHigh: nextDayHigh,
      previousSessionHigh,
      newSessionHigh: nextSessionHigh,
      alertType,
      emitted: shouldEmit,
      suppressedReason,
    });
    if (shouldEmit) {
      alerts.push(enrichedAlert);
    } else {
      suppressedDuplicateAlerts.push({
        time: signal.timestamp,
        ticker: signal.ticker,
        alertType,
        reason: suppressedReason ?? "duplicate_not_stronger",
      });
    }
  }

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
  const runtimeRejectionCounts: Record<string, number> = {
    missing_quote: 0,
    no_signal_yet: 0,
  };
  for (const item of evaluation.watchlist) {
    if (!item.hasActiveSignal) {
      runtimeRejectionCounts.no_signal_yet += 1;
    }
    if (item.exclusionReason) {
      runtimeRejectionCounts[item.exclusionReason] = (runtimeRejectionCounts[item.exclusionReason] ?? 0) + 1;
      if (item.exclusionReason === "missing_quote") {
        runtimeRejectionCounts.missing_quote += 1;
      }
    }
  }
  scannerDiagnostics.rejectionReasonCounts = {
    ...scannerDiagnostics.rejectionReasonCounts,
    ...runtimeRejectionCounts,
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
      alerts,
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
      streamHealth: {
        connected: streamHealth.connected,
        reconnecting: streamHealth.reconnecting,
        statusOnlyStream: streamHealth.statusOnlyStream,
        degraded: streamHealth.degraded,
        degradedReason: streamHealth.degradedReason ?? null,
        wsMessagesReceived: streamHealth.wsMessagesReceived,
        wsUpdatesApplied: streamHealth.wsUpdatesApplied,
        lastMessageAt: streamHealth.lastMessageAt,
        lastWsUpdateAt: streamHealth.lastWsUpdateAt,
      },
      scannerDiagnostics,
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
      alerts,
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
      streamHealth: {
        connected: streamHealth.connected,
        reconnecting: streamHealth.reconnecting,
        statusOnlyStream: streamHealth.statusOnlyStream,
        degraded: streamHealth.degraded,
        degradedReason: streamHealth.degradedReason ?? null,
        wsMessagesReceived: streamHealth.wsMessagesReceived,
        wsUpdatesApplied: streamHealth.wsUpdatesApplied,
        lastMessageAt: streamHealth.lastMessageAt,
        lastWsUpdateAt: streamHealth.lastWsUpdateAt,
      },
      scannerDiagnostics,
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

export function getRunnerAlertDebugState() {
  return {
    highTracking: [...runnerAlertStateByTicker.entries()].map(([ticker, state]) => ({
      ticker,
      sessionDate: state.sessionDate,
      dayHigh: state.dayHigh,
      sessionHigh: state.sessionHigh,
      previousDayHigh: state.previousDayHigh,
      previousSessionHigh: state.previousSessionHigh,
      lastAlertHigh: state.lastAlertHigh,
      alertCountToday: state.alertCountToday,
      lastAlertType: state.lastAlertType,
      lastAlertAt: state.lastAlertAt ? new Date(state.lastAlertAt).toISOString() : null,
      lastVolume: state.lastVolume,
      lastRelativeVolume: state.lastRelativeVolume,
    })),
    suppressedDuplicates: [...suppressedDuplicateAlerts].slice(-200),
    transitionLog: [...transitionLog].slice(-400),
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
  alertMemorySessionDate = null;
  cachedUniverseCandidates = [];
  cachedUniverseDiscovery = {
    source: "fallback_empty",
    discoveredCount: 0,
    discoveredBeforeFilters: 0,
    selectedCount: 0,
    topSymbols: [],
    reasonsBySymbol: {},
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
  };
  nextUniverseRefreshAt = 0;
  lastNonEmptyUniverseCandidates = [];
  lastNonEmptyUniverseAt = 0;
  cachedNewsByTicker = new Map();
  nextNewsRefreshAt = 0;
  signalMemoryBySymbol.clear();
  runnerAlertStateByTicker.clear();
  suppressedDuplicateAlerts.length = 0;
  transitionLog.length = 0;
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
