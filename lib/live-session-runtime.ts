import { createLiveSignalEngineState, evaluateLiveSignals, type Signal } from "./live-signal-engine";
import { getMarketDataThresholds, marketDataProvider, type LiveSessionSnapshot, type QuoteSnapshot, type QuoteState, fetchFinnhubQuotes } from "./market-data";
import { getMarketClock } from "./market-session";
import { computeVolumeMovers, type VolumeMover } from "./volume-movers";
import { fetchVolumeSnapshots, type VolumeSnapshot } from "./volume-data";
import { loadPersistedSessionState, savePersistedSessionState, type PersistedSessionState, type PersistenceStatus, type PersistedSymbolHealth, type SymbolHealthOutcome } from "./session-state-store";
import { backupWatchlistUniverse, type WatchlistTicker, watchlistUniverse } from "./watchlist";

const LIVE_SESSION_FAST_INTERVAL_MS = 4_000;
const LIVE_SESSION_IDLE_INTERVAL_MS = marketDataProvider.pollIntervalMs;
const LIVE_SESSION_ACTIVE_DEMAND_WINDOW_MS = 60_000;
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
  volumeMoverCandidates: VolumeSnapshot[];
  volumeMovers: VolumeMover[];
  persistence: PersistenceStatus | null;
  sessionDate: string | null;
  sessionStatus: LiveSessionSnapshot["sessionStatus"] | null;
  sessionLabel: string | null;
  lastCompletedAt: string | null;
  lastCycleLatencyMs: number | null;
};

const listeners = new Set<SnapshotListener>();

const liveStateStore: SharedLiveStateStore = {
  version: 0,
  snapshot: null,
  latestQuotes: [],
  quoteStates: {},
  observedHighs: {},
  activeSignals: [],
  volumeMoverCandidates: [],
  volumeMovers: [],
  persistence: null,
  sessionDate: null,
  sessionStatus: null,
  sessionLabel: null,
  lastCompletedAt: null,
  lastCycleLatencyMs: null,
};

let persistedState: PersistedSessionState | null = null;
let latestPersistenceStatus: PersistenceStatus | null = null;
let cyclePromise: Promise<LiveSessionSnapshot> | null = null;
let nextCycleTimer: ReturnType<typeof setTimeout> | null = null;
let lastDemandAt = 0;

function createEmptySymbolHealth(): PersistedSymbolHealth {
  return {
    recentOutcomes: [],
    lastHealthyAt: null,
    lastActiveAt: null,
    lastIncludedAt: null,
    coldUntil: null,
  };
}

function isCoreTicker(ticker: string) {
  return watchlistUniverse.some((entry) => entry.ticker === ticker);
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

  let score = isCoreTicker(ticker.ticker) ? 28 : 12;
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

function selectActiveUniverse(state: PersistedSessionState, observedAt: string) {
  const nowMs = new Date(observedAt).getTime();
  const targetSize = watchlistUniverse.length;
  const candidates = [...watchlistUniverse, ...backupWatchlistUniverse];
  const rankedCandidates = [...candidates].sort((left, right) => {
    const leftScore = scoreTickerHealth(left, state.symbolHealth[left.ticker], nowMs);
    const rightScore = scoreTickerHealth(right, state.symbolHealth[right.ticker], nowMs);

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    if (isCoreTicker(left.ticker) !== isCoreTicker(right.ticker)) {
      return Number(isCoreTicker(right.ticker)) - Number(isCoreTicker(left.ticker));
    }

    return left.ticker.localeCompare(right.ticker);
  });

  const activeUniverse = rankedCandidates.slice(0, targetSize);
  const activeTickerSet = new Set(activeUniverse.map((ticker) => ticker.ticker));
  const displacedCore = watchlistUniverse.filter((ticker) => !activeTickerSet.has(ticker.ticker));
  const promotedBackups = activeUniverse.filter((ticker) => !isCoreTicker(ticker.ticker));
  const universeAdjusted = displacedCore.length > 0 || promotedBackups.length > 0;
  const universeMessage = universeAdjusted
    ? promotedBackups.length > 0
      ? `Universe adjusted for live coverage with ${promotedBackups.length} healthier backup ${promotedBackups.length === 1 ? "name" : "names"}.`
      : "Universe adjusted for live coverage."
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
  for (const signal of signals) {
    const existing = state.recentEvaluations[signal.ticker] ?? [];
    const next = [
      {
        signalType: signal.signalType,
        timestamp: signal.timestamp,
        reason: signal.reason,
        confidence: signal.confidence,
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

function buildDegradedSessionMessage(quotesResult: Awaited<ReturnType<typeof fetchFinnhubQuotes>>) {
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
  const hasRecentDemand = listeners.size > 0 || Date.now() - lastDemandAt < LIVE_SESSION_ACTIVE_DEMAND_WINDOW_MS;
  return hasRecentDemand ? LIVE_SESSION_FAST_INTERVAL_MS : LIVE_SESSION_IDLE_INTERVAL_MS;
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
  volumeSnapshots: VolumeSnapshot[];
  volumeMovers: VolumeMover[];
  persistence: PersistenceStatus;
  latencyMs: number;
}) {
  liveStateStore.version += 1;
  liveStateStore.snapshot = snapshot;
  liveStateStore.latestQuotes = params.quotes;
  liveStateStore.quoteStates = params.quoteStates;
  liveStateStore.observedHighs = params.observedHighs;
  liveStateStore.activeSignals = params.signals;
  liveStateStore.volumeMoverCandidates = params.volumeSnapshots;
  liveStateStore.volumeMovers = params.volumeMovers;
  liveStateStore.persistence = params.persistence;
  liveStateStore.sessionDate = snapshot.sessionDate;
  liveStateStore.sessionStatus = snapshot.sessionStatus;
  liveStateStore.sessionLabel = snapshot.sessionLabel;
  liveStateStore.lastCompletedAt = "generatedAt" in snapshot ? snapshot.generatedAt : snapshot.lastUpdated;
  liveStateStore.lastCycleLatencyMs = params.latencyMs;
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
  const marketClock = getMarketClock();
  const loaded = await ensurePersistedState(marketClock.sessionDate);
  const universeSelection = selectActiveUniverse(loaded.state, new Date(startedAt).toISOString());
  const activeUniverse = universeSelection.activeUniverse;
  const activeTickers = activeUniverse.map((ticker) => ticker.ticker);
  const fastLaneTickers = deriveFastLaneTickers();
  const quoteThresholds = getMarketDataThresholds();

  const [quotesResult, volumeResult] = await Promise.all([
    fetchFinnhubQuotes(activeTickers, {
      prioritizedTickers: fastLaneTickers,
      fastLaneTickers,
      slowLaneBatchSize: quoteThresholds.refreshBatchSize,
    }),
    fetchVolumeSnapshots(activeTickers, {
      prioritizedTickers: fastLaneTickers,
      fastLaneTickers,
    }),
  ]);

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
  const engineState = createLiveSignalEngineState();
  engineState.tickers = { ...loaded.state.tickerState };
  const evaluation = evaluateLiveSignals({
    state: engineState,
    watchlist: activeUniverse,
    quotes: quotesResult.quotes,
    volumeSnapshots: volumeResult.snapshots,
    recentEvaluations: loaded.state.recentEvaluations,
    observedAt: generatedAt,
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
      lastUpdated: lastQuoteUpdate ?? loaded.state.lastUpdated,
      lastWatchlist: evaluation.watchlist.length > 0 ? evaluation.watchlist : loaded.state.lastWatchlist,
      lastSignals: loaded.state.lastSignals,
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
      signals: evaluation.signals,
      watchlist:
        evaluation.watchlist.length > 0
          ? evaluation.watchlist
          : loaded.state.lastWatchlist.length > 0
            ? loaded.state.lastWatchlist
            : createFallbackWatchlist(activeUniverse),
      lastUpdated: lastQuoteUpdate ?? loaded.state.lastUpdated,
      persistence: nextPersistenceStatus,
      volumeMovers,
      volumeMoversMessage,
      activeUniverseTickers: activeTickers,
      universeAdjusted: universeSelection.universeAdjusted,
      universeMessage: universeSelection.universeMessage,
      marketData,
    };
  } else {
    const nextState: PersistedSessionState = {
      sessionDate: marketClock.sessionDate,
      history: loaded.state.history,
      tickerState: engineState.tickers,
      recentEvaluations: { ...loaded.state.recentEvaluations },
      symbolHealth,
      lastUpdated: evaluation.generatedAt,
      lastWatchlist: evaluation.watchlist,
      lastSignals: evaluation.signals,
      persistedAt: loaded.state.persistedAt,
    };
    appendRecentEvaluations(nextState, evaluation.signals);
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
      signals: evaluation.signals,
      watchlist: evaluation.watchlist,
      lastUpdated: lastQuoteUpdate ?? evaluation.generatedAt,
      persistence: nextPersistenceStatus,
      volumeMovers,
      volumeMoversMessage,
      activeUniverseTickers: activeTickers,
      universeAdjusted: universeSelection.universeAdjusted,
      universeMessage: universeSelection.universeMessage,
      marketData,
    };
  }

  updateSharedStore(snapshot, {
    quotes: quotesResult.quotes,
    quoteStates: quotesResult.quoteStates,
    observedHighs,
    signals: evaluation.signals,
    volumeSnapshots: volumeResult.snapshots,
    volumeMovers,
    persistence: nextPersistenceStatus,
    latencyMs: Date.now() - startedAt,
  });

  console.log("[live-session-runtime]", "cycle", {
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
    volumeMovers: volumeMovers.length,
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
    volumeMovers: [...liveStateStore.volumeMovers],
    volumeMoverCandidates: [...liveStateStore.volumeMoverCandidates],
    latestQuotes: [...liveStateStore.latestQuotes],
    quoteStates: { ...liveStateStore.quoteStates },
    observedHighs: { ...liveStateStore.observedHighs },
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
  liveStateStore.version = 0;
  liveStateStore.snapshot = null;
  liveStateStore.latestQuotes = [];
  liveStateStore.quoteStates = {};
  liveStateStore.observedHighs = {};
  liveStateStore.activeSignals = [];
  liveStateStore.volumeMoverCandidates = [];
  liveStateStore.volumeMovers = [];
  liveStateStore.persistence = null;
  liveStateStore.sessionDate = null;
  liveStateStore.sessionStatus = null;
  liveStateStore.sessionLabel = null;
  liveStateStore.lastCompletedAt = null;
  liveStateStore.lastCycleLatencyMs = null;
}
