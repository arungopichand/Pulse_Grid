import type { PersistedRecentEvaluation } from "./session-state-store";
import type { QuoteFreshness, QuoteProvider, QuoteSnapshot } from "./market-data";
import type { VolumeSnapshot } from "./volume-data";
import type { WatchlistTicker } from "./watchlist";
import type { StructuredNewsSnapshot } from "./news-data";
import { buildMomentumAlertDescriptor, type MomentumPatternLabel } from "./alert-wording";
import {
  detectDisruptionSignal,
  type DisruptionSignalType,
  type HaltSuppressionReason,
  type SignalObservationPoint,
} from "./signal-disruption";
import { getSignalRuntimeConfig } from "./signal-runtime-config";

export type SignalType =
  | DisruptionSignalType
  | "PREMARKET_BREAKOUT"
  | "VOLUME_BREAKOUT"
  | "GREEN_CANDLE_MOMENTUM"
  | "LOW_FLOAT_MOMENTUM"
  | "BULLISH"
  | "BEARISH";
export type SignalConfidence = "HIGH" | "MEDIUM" | "LOW";
export type SignalNewsSentiment = "bullish" | "bearish" | "none";
export type SignalNewsContext = {
  availability: "available" | "unavailable";
  hasNews: boolean;
  bullishNews: boolean;
  bearishNews: boolean;
  sentimentScore: number | null;
  bullishPercent: number | null;
  bearishPercent: number | null;
  headline: string | null;
  source: string | null;
  publishedAt: string | null;
  provider: "finnhub" | null;
};
export type SignalFactors = {
  strongMove: boolean;
  volumeSpike: boolean;
  news: boolean;
  trending: boolean;
};

export type SignalScoreBreakdown = {
  momentumScore: number;
  volumeScore: number;
  newsScore: number;
  trendScore: number;
  finalScore: number;
};

export type SignalQualityDebug = {
  baseScore: number;
  rvolBoost: number;
  accelerationBoost: number;
  finalScore: number;
  confidence: SignalConfidence;
  relativeVolume: number | null;
  isAccelerating: boolean;
};

export type Signal = {
  id: string;
  ticker: string;
  company: string;
  signalType: SignalType;
  severityScore: number;
  signalState: "new" | "active" | "cooled_down" | "resolved";
  price: number;
  timestamp: string;
  confidence: SignalConfidence;
  confidenceScore: number;
  reason: string;
  reasons: string[];
  changePercent: number;
  quoteFreshness: Exclude<QuoteFreshness, "stale">;
  quoteProvider: QuoteProvider;
  degraded: boolean;
  sector: string;
  exchange: WatchlistTicker["exchange"];
  countryCode: WatchlistTicker["country"];
  instrumentType: WatchlistTicker["instrumentType"];
  watchlisted?: boolean;
  tags: string[];
  score: number;
  finalScore: number;
  scoreBreakdown: SignalScoreBreakdown;
  factors: SignalFactors;
  factorCount: number;
  newsSentiment: SignalNewsSentiment;
  news: SignalNewsContext;
  topOpportunity: boolean;
  reasonBadges: string[];
  relativeVolume: number | null;
  currentVolume: number | null;
  averageVolume: number | null;
  streakCount: number;
  sourceData: string[];
  volumeRatio: number | null;
  freezeSeconds: number;
  reappearance: {
    isReappearing: boolean;
    strongerReappearance: boolean;
    label: "Back again" | "Reappearing" | "Building" | null;
    scoreBoost: number;
    lastSeenAt: string | null;
    lastScore: number | null;
    lastRank: number | null;
  };
  floatShares: number | null;
  alertSummary: string;
  explanationLine: string;
  primaryPatternLabel: MomentumPatternLabel;
  secondaryReasonLabel: string | null;
  occurrenceCount: number;
  sequenceLabel: string | null;
  priceBucketLabel: string;
  volume: number | null;
  themeTags: string[];
  specialTags: string[];
  haltStatus: "active";
  riskFlags: string[];
  alertSequence?: number;
  eventType?: "MOMENTUM_BREAKOUT" | "NEW_HOD" | "SHARP_FALL" | "NEW_LOD" | "VOLUME_SPIKE" | "CONTINUATION";
  eventLabel?: string;
  emittedAt?: string;
  source?: "Massive";
  qualityDebug?: SignalQualityDebug;
  alertTime?: string;
  direction?: "up" | "down" | "flat";
  alertType?:
    | "NHOD"
    | "NSH"
    | "VOLUME_SPIKE"
    | "GREEN_CANDLE_MOMENTUM"
    | "PR_SPIKE"
    | "HALTED_UP"
    | "HALTED_DOWN"
    | "NEWS_PENDING_HALT"
    | "HIGH_CTB"
    | "THEME_MOMENTUM"
    | "SQUEEZE_WATCH";
  priceBucket?: string;
  alertCountToday?: number;
  countryFlag?: string | null;
  marketCap?: number | null;
  institutionalOwnershipPercent?: number | null;
  shortInterestPercent?: number | null;
  costToBorrowPercent?: number | null;
  theme?: string | null;
  newsHeadline?: string | null;
  newsUrl?: string | null;
  sessionHigh?: number | null;
  dayHigh?: number | null;
  previousHigh?: number | null;
  previousDayHigh?: number | null;
  formattedLine?: string;
  retained?: boolean;
  retainedReason?: string | null;
  retainedAgeMs?: number | null;
  alertCount?: number;
  catalystType?: string | null;
  catalystTitle?: string | null;
  catalystUrl?: string | null;
  country?: string | null;
};

export type WatchlistQuote = WatchlistTicker & {
  price: number | null;
  changePercent: number | null;
  timestamp: string | null;
  freshness: QuoteFreshness | "missing";
  quoteProvider: QuoteProvider | null;
  activeSignalType?: SignalType;
  hasActiveSignal: boolean;
  scannerScore?: number | null;
  reasonBadges?: string[];
  scannerStatus?: "eligible" | "excluded";
  exclusionReason?:
    | "missing_quote"
    | "stale_quote"
    | "missing_volume"
    | "thin_liquidity"
    | "low_score"
    | "failed_confluence"
    | "above_max_price"
    | "low_relative_volume"
    | "low_volume"
    | "low_change"
    | "bearish_filtered"
    | "no_signal_yet"
    | "no_breakout"
    | "bearish_candle"
    | "below_score_threshold"
    | null;
};

export type TickerEvaluationState = {
  firstObservedAt?: string | null;
  observedHigh: number | null;
  lastQuoteTimestamp: string | null;
  lastEvaluatedAt: string | null;
  lastChangePercent?: number | null;
  lastSignals: SignalType[];
  lastSignalAt?: string | null;
  lastSignalType?: SignalType | null;
  lastSeverityScore?: number | null;
  history?: SignalObservationPoint[];
};

export type LiveSignalEngineState = {
  tickers: Record<string, TickerEvaluationState>;
};

export type LiveSignalEngineOutput = {
  signals: Signal[];
  watchlist: WatchlistQuote[];
  generatedAt: string;
};

export type LiveSignalEngineCycleDiagnostics = {
  generated: number;
  returned: number;
  maxSignalsPerCycle: number;
  suppressedCooldown: number;
  suppressedByMaxSignalsPerCycle: number;
  possibleHaltsEmitted: number;
  possibleHaltsSuppressed: number;
  haltSuppressionReasons: Record<HaltSuppressionReason, number>;
  cooldownSuppressedTickers: string[];
  maxCycleSuppressedTickers: string[];
  lastHaltSuppressionReasons: Array<{
    ticker: string;
    sessionStatus: "premarket" | "regular" | "after-hours" | "closed";
    reasons: HaltSuppressionReason[];
    observedAt: string;
  }>;
};

const DEFAULT_PRICE_CAP = 10;
const MIN_PRICE_FLOOR = 0.2;
const MIN_CURRENT_VOLUME = 50_000;
const MIN_AVERAGE_VOLUME = 125_000;
const MIN_DOLLAR_LIQUIDITY = 300_000;
const MIN_RELATIVE_VOLUME = 1.0;
const MIN_POSITIVE_CHANGE_PERCENT = 2;
const RECENT_STRENGTH_WINDOW_MS = 20 * 60_000;
const STRONG_MOVE_SCORE = 40;
const VOLUME_SPIKE_SCORE = 30;
const TREND_SCORE = 20;
const REAPPEARANCE_WINDOW_MS = 10 * 60_000;
const REAPPEARANCE_BOOST = 5;
const STRONG_REAPPEARANCE_BOOST = 10;
const STRONG_REAPPEARANCE_DELTA = 8;
const REAPPEARING_MIN_MOVE_DELTA = 0.9;
const REAPPEARING_MIN_BREAKOUT_PERCENT = 0.6;
const REAPPEARING_MIN_RELATIVE_VOLUME = 2.1;
const AFTER_LULL_WINDOW_MS = 18 * 60_000;
const AFTER_LULL_MIN_MOVE_PERCENT = 5;
const AFTER_LULL_MIN_BREAKOUT_PERCENT = 0.9;
const AFTER_LULL_MIN_RELATIVE_VOLUME = 2.4;
const NHOD_MIN_BREAKOUT_PERCENT = 0.5;
const NHOD_CONFIRMATION_BREAKOUT_PERCENT = 0.3;
const NHOD_MIN_RELATIVE_VOLUME = 2.2;
const NHOD_REPEAT_SUPPRESSION_MS = 7 * 60_000;
const NHOD_ESCAPE_BREAKOUT_PERCENT = 1;
const SPIKE_MIN_MOVE_PERCENT = 4.5;
const SPIKE_MIN_DOLLAR_LIQUIDITY = 350_000;
const TOP_GAINER_MIN_MOVE_PERCENT = 25;
const TOP_GAINER_MIN_RELATIVE_VOLUME = 2.2;
const TOP_GAINER_MIN_BREAKOUT_PERCENT = 1;
const SUMMARY_MIN_RELATIVE_VOLUME = 1.8;
const SUMMARY_MIN_VOLUME = 250_000;
const MAX_HISTORY_POINTS = 24;
const MAX_DIAGNOSTIC_TICKERS = 16;
const MAX_HALT_SUPPRESSION_EVENTS = 24;

type SensitivityGateProfile = {
  strongMoveThreshold: number;
  volumeSpikeThreshold: number;
  trendBreakoutThreshold: number;
  trendQualityThreshold: number;
  minVisibleScore: number;
  momentumOnlyVisibleScore: number;
  momentumOnlyStrongMoveThreshold: number;
  spikeRelativeVolumeThreshold: number;
};

let lastCycleDiagnostics: LiveSignalEngineCycleDiagnostics = {
  generated: 0,
  returned: 0,
  maxSignalsPerCycle: 0,
  suppressedCooldown: 0,
  suppressedByMaxSignalsPerCycle: 0,
  possibleHaltsEmitted: 0,
  possibleHaltsSuppressed: 0,
  haltSuppressionReasons: {
    session_closed: 0,
    extended_hours_disabled: 0,
    stream_reconnecting: 0,
    rate_limited: 0,
    newly_bootstrapped: 0,
    low_liquidity: 0,
  },
  cooldownSuppressedTickers: [],
  maxCycleSuppressedTickers: [],
  lastHaltSuppressionReasons: [],
};

export function getLiveSignalEngineCycleDiagnostics() {
  return {
    ...lastCycleDiagnostics,
    haltSuppressionReasons: { ...lastCycleDiagnostics.haltSuppressionReasons },
    cooldownSuppressedTickers: [...lastCycleDiagnostics.cooldownSuppressedTickers],
    maxCycleSuppressedTickers: [...lastCycleDiagnostics.maxCycleSuppressedTickers],
    lastHaltSuppressionReasons: [...lastCycleDiagnostics.lastHaltSuppressionReasons],
  };
}

function roundMetric(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function getSensitivityGateProfile(config: ReturnType<typeof getSignalRuntimeConfig>): SensitivityGateProfile {
  if (config.sensitivityMode === "active") {
    return {
      strongMoveThreshold: Math.max(0.8, config.minPriceMovePercent),
      volumeSpikeThreshold: Math.max(1.3, config.minVolumeRatioThreshold),
      trendBreakoutThreshold: 0.18,
      trendQualityThreshold: 0.6,
      minVisibleScore: 38,
      momentumOnlyVisibleScore: 22,
      momentumOnlyStrongMoveThreshold: Math.max(1.1, config.minPriceMovePercent + 0.25),
      spikeRelativeVolumeThreshold: Math.max(1.35, config.minVolumeRatioThreshold),
    };
  }

  if (config.sensitivityMode === "conservative") {
    return {
      strongMoveThreshold: Math.max(2.5, config.minPriceMovePercent),
      volumeSpikeThreshold: Math.max(2.8, config.minVolumeRatioThreshold),
      trendBreakoutThreshold: 0.45,
      trendQualityThreshold: 1,
      minVisibleScore: 62,
      momentumOnlyVisibleScore: 40,
      momentumOnlyStrongMoveThreshold: Math.max(3.4, config.minPriceMovePercent + 0.9),
      spikeRelativeVolumeThreshold: Math.max(2.4, config.minVolumeRatioThreshold),
    };
  }

  return {
    strongMoveThreshold: Math.max(1.5, config.minPriceMovePercent),
    volumeSpikeThreshold: Math.max(1.9, config.minVolumeRatioThreshold),
    trendBreakoutThreshold: 0.3,
    trendQualityThreshold: 0.8,
    minVisibleScore: 52,
    momentumOnlyVisibleScore: 32,
    momentumOnlyStrongMoveThreshold: Math.max(2.1, config.minPriceMovePercent + 0.6),
    spikeRelativeVolumeThreshold: Math.max(1.8, config.minVolumeRatioThreshold),
  };
}

function createDefaultTickerState(): TickerEvaluationState {
  return {
    firstObservedAt: null,
    observedHigh: null,
    lastQuoteTimestamp: null,
    lastEvaluatedAt: null,
    lastSignals: [],
    lastSignalAt: null,
    lastSignalType: null,
    lastSeverityScore: null,
    history: [],
  };
}

function getRecentStrengthCount(recentEvaluations: PersistedRecentEvaluation[] | undefined, observedAt: string) {
  if (!recentEvaluations?.length) {
    return 0;
  }

  const observedAtMs = new Date(observedAt).getTime();
  return recentEvaluations.filter((evaluation) => {
    const ageMs = observedAtMs - new Date(evaluation.timestamp).getTime();
    return ageMs >= 0 && ageMs <= RECENT_STRENGTH_WINDOW_MS && evaluation.confidence >= 75;
  }).length;
}

function getRecentEvaluationCountWithinWindow(
  recentEvaluations: PersistedRecentEvaluation[] | undefined,
  observedAt: string,
  windowMs: number,
) {
  if (!recentEvaluations?.length) {
    return 0;
  }

  const observedAtMs = new Date(observedAt).getTime();
  return recentEvaluations.filter((evaluation) => {
    const ageMs = observedAtMs - new Date(evaluation.timestamp).getTime();
    return ageMs >= 0 && ageMs <= windowMs;
  }).length;
}

function createReasonSummary(reasonBadges: string[]) {
  if (!reasonBadges.length) {
    return "Monitoring for deterministic factor confluence.";
  }

  return reasonBadges.slice(0, 3).join(" | ");
}

function formatFloatLabel(floatShares: number | null) {
  if (!floatShares || floatShares <= 0) {
    return null;
  }

  if (floatShares >= 1_000_000_000) {
    return `${roundMetric(floatShares / 1_000_000_000, 1)}B`;
  }

  return `${roundMetric(floatShares / 1_000_000, 1)}M`;
}

function getPriceBucketLabel(price: number) {
  if (price < 1) return "Sub-$1";
  if (price < 2) return "$1-$2";
  if (price < 5) return "$2-$5";
  if (price < 10) return "$5-$10";
  return ">$10";
}

function getNuntioPriceBucket(price: number) {
  if (price < 0.15) return "< $.15c";
  if (price < 0.5) return "< $.50c";
  if (price < 1) return "< $1";
  if (price < 2) return "< $2";
  if (price < 3) return "< $3";
  if (price < 5) return "< $5";
  if (price < 10) return "< $10";
  return `< $${Math.round(price)}`;
}

function formatCompactVolume(value: number | null) {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  if (value >= 1_000_000) return `${roundMetric(value / 1_000_000, 1)}M`;
  if (value >= 1_000) return `${roundMetric(value / 1_000, 1)}k`;
  return `${Math.round(value)}`;
}

function toCountryFlag(countryCode: string | null | undefined) {
  if (!countryCode || countryCode.length !== 2) return null;
  const code = countryCode.toUpperCase();
  const first = code.codePointAt(0);
  const second = code.codePointAt(1);
  if (!first || !second) return null;
  return String.fromCodePoint(first + 127397) + String.fromCodePoint(second + 127397);
}

function resolveAlertType(params: { signalType: SignalType; breakoutPercent: number; sessionStatus: "premarket" | "regular" | "after-hours" | "closed"; hasNews: boolean }) {
  if (params.signalType === "PREMARKET_BREAKOUT") return "NSH" as const;
  if (params.signalType === "VOLUME_BREAKOUT") return "VOLUME_SPIKE" as const;
  if (params.signalType === "GREEN_CANDLE_MOMENTUM") return "GREEN_CANDLE_MOMENTUM" as const;
  if (params.hasNews) return "PR_SPIKE" as const;
  if (params.breakoutPercent > 0.3) return "NHOD" as const;
  return "THEME_MOMENTUM" as const;
}

function buildFormattedAlertLine(params: {
  time: string;
  direction: "up" | "down" | "flat";
  ticker: string;
  priceBucket: string;
  changePercent: number | null;
  alertCountToday: number;
  alertType: string;
  countryFlag: string | null;
  floatLabel: string | null;
  relativeVolume: number | null;
  currentVolume: number | null;
  theme: string | null;
  newsHeadline: string | null;
}) {
  const arrow = params.direction === "up" ? "↑" : params.direction === "down" ? "↓" : "→";
  const base = `${params.time} ${arrow} ${params.ticker} ${params.priceBucket}${params.changePercent !== null ? ` ${roundMetric(params.changePercent, 1)}%` : ""} · ${params.alertCountToday} ${params.alertType}`;
  const chips: string[] = [];
  if (params.countryFlag) chips.push(params.countryFlag);
  if (params.floatLabel) chips.push(`Float: ${params.floatLabel}`);
  if (params.relativeVolume !== null) chips.push(`RVol: ${roundMetric(params.relativeVolume, 1)}x`);
  const vol = formatCompactVolume(params.currentVolume);
  if (vol) chips.push(`Vol: ${vol}`);
  if (params.theme) chips.push(`Theme: ${params.theme}`);
  if (params.newsHeadline) chips.push(params.newsHeadline);
  if (!chips.length) return base;
  return `${base} ~ ${chips.join(" | ")}`;
}

function getSignalConfidence(factorCount: number): SignalConfidence {
  if (factorCount >= 3) {
    return "HIGH";
  }

  if (factorCount === 2) {
    return "MEDIUM";
  }

  return "LOW";
}

function getConfidenceScore(confidence: SignalConfidence) {
  if (confidence === "HIGH") {
    return 92;
  }

  if (confidence === "MEDIUM") {
    return 78;
  }

  return 62;
}

function getConfidenceFromScore(score: number): SignalConfidence {
  if (score >= 85) {
    return "HIGH";
  }

  if (score >= 67) {
    return "MEDIUM";
  }

  return "LOW";
}

function mapStructuredNewsSentiment(news: SignalNewsContext): SignalNewsSentiment {
  if (news.bullishNews && !news.bearishNews) {
    return "bullish";
  }

  if (news.bearishNews && !news.bullishNews) {
    return "bearish";
  }

  if (news.sentimentScore !== null) {
    if (news.sentimentScore >= 0.2) return "bullish";
    if (news.sentimentScore <= -0.2) return "bearish";
  }

  return "none";
}

export function createLiveSignalEngineState(): LiveSignalEngineState {
  return {
    tickers: {},
  };
}

export function evaluateLiveSignals(params: {
  state: LiveSignalEngineState;
  watchlist: WatchlistTicker[];
  quotes: QuoteSnapshot[];
  volumeSnapshots?: VolumeSnapshot[];
  newsSnapshots?: StructuredNewsSnapshot[];
  recentEvaluations?: Record<string, PersistedRecentEvaluation[]>;
  observedAt: string;
  sessionStatus?: "premarket" | "regular" | "after-hours" | "closed";
  haltGuards?: {
    isStreamReconnecting: boolean;
    isRateLimited: boolean;
  };
}): LiveSignalEngineOutput {
  const { state, watchlist, quotes, volumeSnapshots = [], newsSnapshots = [], recentEvaluations = {}, observedAt } = params;
  const sessionStatus = params.sessionStatus ?? "closed";
  const haltGuards = params.haltGuards ?? {
    isStreamReconnecting: false,
    isRateLimited: false,
  };
  const runtimeConfig = getSignalRuntimeConfig();
  const sensitivityGates = getSensitivityGateProfile(runtimeConfig);
  const observedAtMs = new Date(observedAt).getTime();
  const quoteMap = new Map(quotes.map((quote) => [quote.ticker, quote]));
  const volumeMap = new Map(volumeSnapshots.map((snapshot) => [snapshot.ticker, snapshot]));
  const newsMap = new Map(newsSnapshots.map((snapshot) => [snapshot.ticker, snapshot]));
  const signals: Signal[] = [];
  const diagnostics = {
    generated: 0,
    suppressedCooldown: 0,
    possibleHaltsEmitted: 0,
    possibleHaltsSuppressed: 0,
    suppressedByMaxSignalsPerCycle: 0,
    haltSuppressionReasons: {
      session_closed: 0,
      extended_hours_disabled: 0,
      stream_reconnecting: 0,
      rate_limited: 0,
      newly_bootstrapped: 0,
      low_liquidity: 0,
    } satisfies Record<HaltSuppressionReason, number>,
    cooldownSuppressedTickers: [] as string[],
    maxCycleSuppressedTickers: [] as string[],
    lastHaltSuppressionReasons: [] as LiveSignalEngineCycleDiagnostics["lastHaltSuppressionReasons"],
  };

  const watchlistItems = watchlist.map((tickerMeta) => {
    const quote = quoteMap.get(tickerMeta.ticker);

    if (!quote) {
      const tickerState = state.tickers[tickerMeta.ticker] ?? createDefaultTickerState();
      state.tickers[tickerMeta.ticker] = {
        ...tickerState,
        lastEvaluatedAt: observedAt,
        lastSignals: [],
      };

      return {
        ...tickerMeta,
        price: null,
        changePercent: null,
        timestamp: null,
        freshness: "missing",
        quoteProvider: null,
        hasActiveSignal: false,
        scannerScore: null,
        reasonBadges: ["No Quote"],
        scannerStatus: "excluded",
        exclusionReason: "missing_quote",
      } satisfies WatchlistQuote;
    }

    const priorTickerState = state.tickers[tickerMeta.ticker] ?? createDefaultTickerState();
    const firstObservedAt = priorTickerState.firstObservedAt ?? observedAt;
    const firstObservedAtMs = new Date(firstObservedAt).getTime();
    const previousObservedHigh = priorTickerState.observedHigh;
    const previousChangePercent = priorTickerState.lastChangePercent ?? null;
    const volumeSnapshot = volumeMap.get(tickerMeta.ticker);
    const previousQuoteTimestamp = priorTickerState.lastQuoteTimestamp ?? null;
    const history = [...(priorTickerState.history ?? [])];
    const hasNewQuotePoint = previousQuoteTimestamp !== quote.timestamp;
    if (hasNewQuotePoint) {
      history.push({
        timestamp: quote.timestamp,
        price: quote.price,
        changePercent: quote.changePercent,
        currentVolume: volumeSnapshot?.currentVolume ?? null,
      });
    }
    const trimmedHistory = history.slice(-MAX_HISTORY_POINTS);
    const signalFreshness = quote.freshness === "fresh" ? "fresh" : quote.freshness === "cached" ? "cached" : null;
    const canEvaluate = signalFreshness !== null;
    const isNewlyBootstrapped =
      observedAtMs - firstObservedAtMs < runtimeConfig.haltFreezeThresholdMs * 2 ||
      trimmedHistory.length < 2;
    const relativeVolume =
      volumeSnapshot && volumeSnapshot.averageVolume > 0 ? volumeSnapshot.currentVolume / volumeSnapshot.averageVolume : null;
    const dollarLiquidity = volumeSnapshot ? volumeSnapshot.currentVolume * volumeSnapshot.price : 0;
    const streakCount = getRecentStrengthCount(recentEvaluations[tickerMeta.ticker], observedAt);
    const breakoutPercent =
      canEvaluate && previousObservedHigh && quote.price > previousObservedHigh
        ? ((quote.price - previousObservedHigh) / previousObservedHigh) * 100
        : 0;
    const riskFlags = tickerMeta.riskFlags ?? [];
    const latestRecentEvaluation = recentEvaluations[tickerMeta.ticker]?.[0];
    const lastSeenAt = latestRecentEvaluation?.timestamp ?? null;
    const lastSeenAgeMs = lastSeenAt ? Math.max(0, new Date(observedAt).getTime() - new Date(lastSeenAt).getTime()) : null;
    const recentAlertsInNhodWindow = getRecentEvaluationCountWithinWindow(
      recentEvaluations[tickerMeta.ticker],
      observedAt,
      NHOD_REPEAT_SUPPRESSION_MS,
    );
    const reasonBadges: string[] = [];
    const reasons: string[] = [];
    const universeTag = runtimeConfig.signalUniverseMode === "penny" ? "Penny Scan" : "Live Momentum";
    const tags = ["Live", universeTag];
    let exclusionReason: WatchlistQuote["exclusionReason"] = null;

    if (tickerMeta.exchange) {
      reasonBadges.push(tickerMeta.exchange);
    }

    const isPennyCandidate = quote.price >= MIN_PRICE_FLOOR && quote.price <= DEFAULT_PRICE_CAP;
    const passesUniverseMode = runtimeConfig.signalUniverseMode === "all" ? true : isPennyCandidate;
    const isBullish = canEvaluate && quote.changePercent > 0;
    const hasLiquidity =
      volumeSnapshot !== undefined &&
      volumeSnapshot.currentVolume >= MIN_CURRENT_VOLUME &&
      volumeSnapshot.averageVolume >= MIN_AVERAGE_VOLUME &&
      dollarLiquidity >= MIN_DOLLAR_LIQUIDITY;
    const hasStrongMove = canEvaluate && quote.changePercent >= MIN_POSITIVE_CHANGE_PERCENT;
    const hasVolumeSpike =
      hasLiquidity &&
      relativeVolume !== null &&
      relativeVolume >= Math.max(MIN_RELATIVE_VOLUME, sensitivityGates.volumeSpikeThreshold);
    const hasAcceleratingMove =
      canEvaluate &&
      typeof previousChangePercent === "number" &&
      quote.changePercent > previousChangePercent;
    const hasTrending = canEvaluate && (streakCount >= 2 || breakoutPercent >= sensitivityGates.trendBreakoutThreshold);
    const hasTrendQuality = streakCount >= 2 || breakoutPercent >= sensitivityGates.trendQualityThreshold;
    const structuredNews = newsMap.get(tickerMeta.ticker);
    const news: SignalNewsContext = structuredNews
      ? {
          availability: structuredNews.availability,
          hasNews: structuredNews.hasNews,
          bullishNews: structuredNews.bullishNews,
          bearishNews: structuredNews.bearishNews,
          sentimentScore: structuredNews.sentimentScore,
          bullishPercent: structuredNews.bullishPercent,
          bearishPercent: structuredNews.bearishPercent,
          headline: structuredNews.headline,
          source: structuredNews.source,
          publishedAt: structuredNews.publishedAt,
          provider: structuredNews.provider,
        }
      : {
          availability: "unavailable",
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
        };
    const newsSentiment = mapStructuredNewsSentiment(news);
    const hasDirectionalNews = news.availability === "available" && (news.bullishNews || news.bearishNews);
    const hasNews = news.availability === "available" && news.hasNews;

    if (quote.freshness === "cached") {
      reasonBadges.push("Cached");
      reasons.push("Quote freshness is cached this cycle, so setup quality is treated cautiously.");
    }

    if (quote.freshness === "stale") {
      exclusionReason = "stale_quote";
      reasonBadges.push("Stale");
    }

    if (hasStrongMove) {
      reasonBadges.push(`Strong Move ${quote.changePercent.toFixed(1)}%`);
      reasons.push(
        `Price moved ${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}%, meeting the strong-move factor.`,
      );
      tags.push("Strong Move");
    }

    if (hasVolumeSpike && relativeVolume !== null) {
      reasonBadges.push(`RVOL ${relativeVolume.toFixed(1)}x`);
      reasons.push(`Relative volume is ${relativeVolume.toFixed(2)}x, confirming a volume-spike factor.`);
      tags.push("Volume");
    }

    if (hasNews) {
      if (hasDirectionalNews) {
        reasonBadges.push(newsSentiment === "bullish" ? "Bullish News" : "Bearish News");
      } else {
        reasonBadges.push("News Context");
      }
      reasons.push(`Structured provider news context is present for this ticker.`);
      if (news.headline) {
        reasons.push(`Headline: ${news.headline}`);
      }
      tags.push("News");
    }

    if (hasTrending) {
      reasonBadges.push("TRENDING");
      reasons.push("Recent repeated activity/trending context is active.");
      reasonBadges.push(`${streakCount}x Repeat Strength`);
      tags.push("TRENDING");
      if (streakCount >= 2) {
        tags.push("Repeat");
      }
    }

    if (!isPennyCandidate && runtimeConfig.signalUniverseMode === "penny") {
      reasonBadges.push("Above $10");
      reasons.push("Price is above the configured low-price scanner threshold.");
      exclusionReason = "above_max_price";
    }

    if (canEvaluate && !isBullish) {
      reasonBadges.push("Bearish Candle");
      reasons.push("Bullish-only scanner requires positive momentum.");
      exclusionReason = "bearish_filtered";
    }

    if (relativeVolume !== null && relativeVolume < MIN_RELATIVE_VOLUME) {
      reasonBadges.push("Low RVOL");
      reasons.push(`Relative volume ${relativeVolume.toFixed(2)}x is below ${MIN_RELATIVE_VOLUME.toFixed(1)}x.`);
      exclusionReason = "low_relative_volume";
    }

    if (!hasLiquidity) {
      reasonBadges.push("Thin Liquidity");
      reasons.push("Liquidity thresholds are not met for this cycle.");
      exclusionReason = volumeSnapshot ? "low_volume" : "missing_volume";
    }

    const factors: SignalFactors = {
      strongMove: hasStrongMove,
      volumeSpike: hasVolumeSpike,
      news: false,
      trending: hasTrending,
    };
    const factorCount = Object.values(factors).filter(Boolean).length;
    const momentumScore = hasStrongMove ? STRONG_MOVE_SCORE : 0;
    const volumeScore = hasVolumeSpike ? VOLUME_SPIKE_SCORE : 0;
    const newsScore = 0;
    const trendScore = hasTrending ? TREND_SCORE : 0;
    const baseFinalScore = momentumScore + volumeScore + newsScore + trendScore;
    const lastScore = latestRecentEvaluation?.finalScore ?? null;
    const scoreDeltaFromLast = lastScore !== null ? baseFinalScore - lastScore : 0;
    const moveDeltaFromPreviousQuote =
      typeof previousChangePercent === "number" ? quote.changePercent - previousChangePercent : null;
    const reclaimedHod = Boolean(previousObservedHigh && quote.price >= previousObservedHigh);
    const hasFreshExpansion =
      scoreDeltaFromLast >= STRONG_REAPPEARANCE_DELTA ||
      breakoutPercent >= REAPPEARING_MIN_BREAKOUT_PERCENT ||
      reclaimedHod ||
      (moveDeltaFromPreviousQuote !== null && moveDeltaFromPreviousQuote >= REAPPEARING_MIN_MOVE_DELTA) ||
      (relativeVolume !== null && relativeVolume >= REAPPEARING_MIN_RELATIVE_VOLUME);
    const isReappearing = Boolean(
      lastSeenAgeMs !== null &&
      lastSeenAgeMs >= REAPPEARANCE_WINDOW_MS &&
      hasStrongMove &&
      hasFreshExpansion,
    );
    const strongerReappearance = isReappearing && scoreDeltaFromLast >= STRONG_REAPPEARANCE_DELTA;
    const reappearanceScoreBoost = strongerReappearance ? STRONG_REAPPEARANCE_BOOST : isReappearing ? REAPPEARANCE_BOOST : 0;
    const finalScore = baseFinalScore + reappearanceScoreBoost;
    const baseConfidence = getSignalConfidence(factorCount);
    const baseConfidenceScore = getConfidenceScore(baseConfidence);
    const rvolBoost = relativeVolume !== null && relativeVolume > 1.5 ? 5 : 0;
    const accelerationBoost = hasAcceleratingMove ? 5 : 0;
    const confidenceBoost = rvolBoost + accelerationBoost;
    const confidenceScore = Math.min(99, baseConfidenceScore + confidenceBoost);
    const confidence = getConfidenceFromScore(confidenceScore);
    const qualityDebug: SignalQualityDebug = {
      baseScore: baseConfidenceScore,
      rvolBoost,
      accelerationBoost,
      finalScore: confidenceScore,
      confidence,
      relativeVolume: relativeVolume !== null ? roundMetric(relativeVolume, 2) : null,
      isAccelerating: hasAcceleratingMove,
    };
    const lastDisruptionType: DisruptionSignalType | null =
      priorTickerState.lastSignalType &&
      (
        priorTickerState.lastSignalType === "MOMENTUM_UP" ||
        priorTickerState.lastSignalType === "MOMENTUM_DOWN" ||
        priorTickerState.lastSignalType === "VOLUME_SURGE" ||
        priorTickerState.lastSignalType === "POSSIBLE_HALT_UP" ||
        priorTickerState.lastSignalType === "POSSIBLE_HALT_DOWN" ||
        priorTickerState.lastSignalType === "RESUMPTION_WATCH" ||
        priorTickerState.lastSignalType === "BREAKOUT_CONTINUATION" ||
        priorTickerState.lastSignalType === "BREAKDOWN_CONTINUATION" ||
        priorTickerState.lastSignalType === "SPIKE"
      )
        ? priorTickerState.lastSignalType
        : null;

    const disruption = detectDisruptionSignal({
      ticker: tickerMeta.ticker,
      price: quote.price,
      changePercent: quote.changePercent,
      relativeVolume,
      currentVolume: volumeSnapshot?.currentVolume ?? null,
      averageVolume: volumeSnapshot?.averageVolume ?? null,
      previousChangePercent,
      previousQuoteTimestamp,
      currentQuoteTimestamp: quote.timestamp,
      breakoutPercent,
      streakCount,
      history: trimmedHistory,
      observedAtMs,
      sessionStatus,
      lastSignalType: lastDisruptionType,
      quoteFreshness: quote.freshness,
      hasNewQuoteTick: hasNewQuotePoint,
      isNewlyBootstrapped,
      isStreamReconnecting: haltGuards.isStreamReconnecting,
      isRateLimited: haltGuards.isRateLimited,
      hasLiquidity,
      onPossibleHaltSuppressed: (details) => {
        diagnostics.possibleHaltsSuppressed += 1;
        for (const reason of details.reasons) {
          diagnostics.haltSuppressionReasons[reason] += 1;
        }
        diagnostics.lastHaltSuppressionReasons.push({
          ticker: details.ticker,
          sessionStatus: details.sessionStatus,
          reasons: [...details.reasons],
          observedAt,
        });
        if (diagnostics.lastHaltSuppressionReasons.length > MAX_HALT_SUPPRESSION_EVENTS) {
          diagnostics.lastHaltSuppressionReasons.shift();
        }
        console.log("[live-signal-engine]", "possible_halt_suppressed", {
          ticker: details.ticker,
          reasons: details.reasons,
          sessionStatus: details.sessionStatus,
          freezeSeconds: details.freezeSeconds,
          shortWindowMove: roundMetric(details.shortWindowMove, 2),
          volumeRatio: details.volumeRatio !== null ? roundMetric(details.volumeRatio, 2) : null,
          observedAt,
        });
      },
      onPossibleHaltEmitted: (details) => {
        diagnostics.possibleHaltsEmitted += 1;
        console.log("[live-signal-engine]", "possible_halt_emitted", {
          ticker: details.ticker,
          signalType: details.signalType,
          freezeSeconds: details.freezeSeconds,
          shortWindowMove: roundMetric(details.shortWindowMove, 2),
          volumeRatio: details.volumeRatio !== null ? roundMetric(details.volumeRatio, 2) : null,
          observedAt,
        });
      },
      config: runtimeConfig,
    });
    const intradayBreakout = breakoutPercent >= Math.max(0.25, sensitivityGates.trendBreakoutThreshold);
    const activeSignalType: SignalType | null =
      sessionStatus === "premarket" && intradayBreakout && hasVolumeSpike
        ? "PREMARKET_BREAKOUT"
        : hasVolumeSpike && intradayBreakout
          ? "VOLUME_BREAKOUT"
          : streakCount >= 3 && hasStrongMove
            ? "GREEN_CANDLE_MOMENTUM"
            : typeof tickerMeta.floatShares === "number" && tickerMeta.floatShares > 0 && tickerMeta.floatShares <= 50_000_000 && hasStrongMove && hasVolumeSpike
              ? "LOW_FLOAT_MOMENTUM"
              : disruption?.signalType ?? null;

    const reappearanceLabel: Signal["reappearance"]["label"] = strongerReappearance
      ? "Back again"
      : isReappearing
        ? hasTrending
          ? "Building"
          : "Reappearing"
        : null;

    if (reappearanceLabel) {
      reasonBadges.push(reappearanceLabel);
      reasons.push(
        strongerReappearance
          ? "This symbol is back with stronger confluence than its prior appearance."
          : "This symbol has returned to the scanner after a meaningful absence.",
      );
      if (!tags.includes("Reappearance")) {
        tags.push("Reappearance");
      }
    }

    const reason = createReasonSummary(reasonBadges);
    const floatLabel = formatFloatLabel(tickerMeta.floatShares ?? null);
    const occurrenceCount = (recentEvaluations[tickerMeta.ticker]?.length ?? 0) + 1;
    const hasMeaningfulNhodBreakout = Boolean(
      canEvaluate &&
      previousObservedHigh &&
      quote.price > previousObservedHigh &&
      (
        breakoutPercent >= NHOD_MIN_BREAKOUT_PERCENT ||
        (breakoutPercent >= NHOD_CONFIRMATION_BREAKOUT_PERCENT &&
          relativeVolume !== null &&
          relativeVolume >= NHOD_MIN_RELATIVE_VOLUME)
      ),
    );
    const isNhod = Boolean(
      hasMeaningfulNhodBreakout &&
      (
        lastSeenAgeMs === null ||
        lastSeenAgeMs >= NHOD_REPEAT_SUPPRESSION_MS ||
        breakoutPercent >= NHOD_ESCAPE_BREAKOUT_PERCENT
      ) &&
      recentAlertsInNhodWindow === 0,
    );
    const isThreeGreenBars = streakCount >= 3;
    const isAfterLull = Boolean(
      lastSeenAgeMs !== null &&
      lastSeenAgeMs >= AFTER_LULL_WINDOW_MS &&
      hasTrending &&
      hasLiquidity &&
      (
        quote.changePercent >= AFTER_LULL_MIN_MOVE_PERCENT ||
        breakoutPercent >= AFTER_LULL_MIN_BREAKOUT_PERCENT ||
        (relativeVolume !== null && relativeVolume >= AFTER_LULL_MIN_RELATIVE_VOLUME)
      ),
    );
    const isPrBacked = hasNews;
    const combinedRiskFlags = Array.from(new Set([...riskFlags, ...(disruption?.riskFlags ?? [])]));
    const haltLabel = combinedRiskFlags.includes("POSSIBLE_HALT_UP")
      ? "Possible Halt Up"
      : combinedRiskFlags.includes("POSSIBLE_HALT_DOWN")
        ? "Possible Halt Down"
        : combinedRiskFlags.includes("HALTED_UP")
          ? "Halted Up"
          : combinedRiskFlags.includes("HALTED_DOWN")
            ? "Halted Down"
            : combinedRiskFlags.includes("NEWS_PENDING")
          ? "News Pending"
          : null;
    const isTopGainerContinuation = Boolean(
      hasStrongMove &&
      hasVolumeSpike &&
      quote.changePercent >= TOP_GAINER_MIN_MOVE_PERCENT &&
      relativeVolume !== null &&
      relativeVolume >= TOP_GAINER_MIN_RELATIVE_VOLUME &&
      (hasAcceleratingMove || streakCount >= 3 || breakoutPercent >= TOP_GAINER_MIN_BREAKOUT_PERCENT) &&
      !isAfterLull &&
      !isReappearing &&
      !isNhod,
    );
    const summaryRelativeVolume =
      relativeVolume !== null && relativeVolume >= SUMMARY_MIN_RELATIVE_VOLUME ? roundMetric(relativeVolume, 2) : null;
    const summaryVolumeLabel =
      volumeSnapshot?.currentVolume && volumeSnapshot.currentVolume >= SUMMARY_MIN_VOLUME
        ? `${Math.round(volumeSnapshot.currentVolume).toLocaleString("en-US")}`
        : null;
    const momentumAlert = buildMomentumAlertDescriptor({
      occurrenceCount,
      isReappearing,
      isAfterLull,
      isNhod,
      isThreeGreenBars,
      isPrBacked,
      isTopGainerContinuation,
      haltLabel,
      relativeVolume: summaryRelativeVolume,
      floatLabel,
      volumeLabel: summaryVolumeLabel,
      reclaimedHod,
      liquidityConfirmed: hasLiquidity,
    });
    const explanationLine = momentumAlert.alertSummary || reason;
    const specialTags = [
      signalFreshness === "fresh" ? "Live" : null,
      hasDirectionalNews ? "PR/News" : null,
      signalFreshness === "cached" ? "Cached" : null,
      isReappearing ? "Reappearing" : null,
      hasTrending ? "Momentum Continuation" : null,
      streakCount >= 3 ? "Multi-Green-Bars" : null,
      hasVolumeSpike ? "Unusual Volume" : null,
      hasStrongMove ? "Top Gainer" : null,
      combinedRiskFlags.includes("HIGH_SHORT_INTEREST") ? "High SI" : null,
      combinedRiskFlags.includes("HIGH_CTB") ? "High CTB" : null,
      combinedRiskFlags.includes("POSSIBLE_HALT_UP") ? "Possible Halt Up" : null,
      combinedRiskFlags.includes("POSSIBLE_HALT_DOWN") ? "Possible Halt Down" : null,
    ].filter((item): item is string => Boolean(item));
    const themeTags = tickerMeta.sector && tickerMeta.sector !== "Dynamic" ? [tickerMeta.sector] : [];

    const cooldownUntilMs = priorTickerState.lastSignalAt
      ? new Date(priorTickerState.lastSignalAt).getTime() + runtimeConfig.perSymbolCooldownMs
      : 0;
    const inCooldown = cooldownUntilMs > observedAtMs;
    const suppressionByCooldown =
      inCooldown &&
      priorTickerState.lastSignalType === activeSignalType &&
      (priorTickerState.lastSeverityScore ?? 0) >= (disruption?.severityScore ?? 0);
    const meetsLegacyGate =
      canEvaluate &&
      passesUniverseMode &&
      isBullish &&
      hasLiquidity &&
      quote.price >= MIN_PRICE_FLOOR &&
      quote.price <= DEFAULT_PRICE_CAP &&
      quote.changePercent >= MIN_POSITIVE_CHANGE_PERCENT &&
      relativeVolume !== null &&
      relativeVolume >= MIN_RELATIVE_VOLUME &&
      (intradayBreakout || streakCount >= 2) &&
      (
        (
          factorCount >= 2 &&
          (hasTrendQuality || hasVolumeSpike) &&
          finalScore >= sensitivityGates.minVisibleScore
        ) ||
        (
          Math.abs(quote.changePercent) >= Math.max(sensitivityGates.momentumOnlyStrongMoveThreshold, SPIKE_MIN_MOVE_PERCENT) &&
          relativeVolume !== null &&
          relativeVolume >= sensitivityGates.spikeRelativeVolumeThreshold &&
          dollarLiquidity >= SPIKE_MIN_DOLLAR_LIQUIDITY &&
          finalScore >= sensitivityGates.momentumOnlyVisibleScore
        )
      );
    const shouldSurfaceSignal = meetsLegacyGate && Boolean(activeSignalType) && !suppressionByCooldown;
    const signalState: Signal["signalState"] = suppressionByCooldown
      ? "cooled_down"
      : priorTickerState.lastSignalType && priorTickerState.lastSignalType === activeSignalType
        ? "active"
        : "new";

    if (!shouldSurfaceSignal && !exclusionReason) {
      if (suppressionByCooldown) {
        diagnostics.suppressedCooldown += 1;
        if (diagnostics.cooldownSuppressedTickers.length < MAX_DIAGNOSTIC_TICKERS) {
          diagnostics.cooldownSuppressedTickers.push(tickerMeta.ticker);
        }
      }
      exclusionReason = suppressionByCooldown
        ? "below_score_threshold"
        : !canEvaluate
        ? "stale_quote"
        : !hasLiquidity
          ? volumeSnapshot
            ? "low_volume"
            : "missing_volume"
          : !isBullish
            ? "bearish_filtered"
          : quote.changePercent < MIN_POSITIVE_CHANGE_PERCENT
            ? "low_change"
          : relativeVolume === null || relativeVolume < MIN_RELATIVE_VOLUME
            ? "low_relative_volume"
          : !intradayBreakout && streakCount < 2
            ? "no_breakout"
          : factorCount < 2
            ? "failed_confluence"
            : "no_signal_yet";
    }

    if (shouldSurfaceSignal && signalFreshness) {
      const normalizedReasons =
        disruption?.reasons.length
          ? disruption.reasons
          : reasons.length > 0
            ? reasons
            : ["Signal is active from deterministic factor confluence."];
      const finalReason = disruption?.reason ?? reason;
      const finalConfidence = disruption?.confidence ?? confidence;
      const finalConfidenceScore = disruption?.confidenceScore ?? confidenceScore;
      const finalSeverityScore = disruption?.severityScore ?? finalScore;
      const appliedRiskFlags = combinedRiskFlags;
      const direction: "up" | "down" | "flat" = quote.changePercent > 0 ? "up" : quote.changePercent < 0 ? "down" : "flat";
      const alertCountToday = occurrenceCount;
      const countryFlag = toCountryFlag(tickerMeta.country ?? null);
      const priceBucket = getNuntioPriceBucket(quote.price);
      const alertType = resolveAlertType({
        signalType: activeSignalType ?? "VOLUME_BREAKOUT",
        breakoutPercent,
        sessionStatus,
        hasNews,
      });
      const theme = themeTags.length > 0 ? themeTags[0] : null;
      const alertTime = new Date(quote.timestamp).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "America/New_York",
      });
      const formattedLine = buildFormattedAlertLine({
        time: alertTime,
        direction,
        ticker: tickerMeta.ticker,
        priceBucket,
        changePercent: quote.changePercent,
        alertCountToday,
        alertType,
        countryFlag,
        floatLabel,
        relativeVolume,
        currentVolume: volumeSnapshot?.currentVolume ?? null,
        theme,
        newsHeadline: news.headline,
      });
      signals.push({
        id: `${tickerMeta.ticker}-scanner-setup`,
        ticker: tickerMeta.ticker,
        company: tickerMeta.company,
        sector: tickerMeta.sector,
        exchange: tickerMeta.exchange,
        countryCode: tickerMeta.country,
        instrumentType: tickerMeta.instrumentType,
        signalType: activeSignalType ?? "VOLUME_BREAKOUT",
        severityScore: finalSeverityScore,
        signalState,
        price: quote.price,
        timestamp: quote.timestamp,
        confidence: finalConfidence,
        confidenceScore: finalConfidenceScore,
        reason: finalReason,
        alertSummary: momentumAlert.alertSummary,
        explanationLine,
        primaryPatternLabel: momentumAlert.primaryPatternLabel,
        secondaryReasonLabel: momentumAlert.secondaryReasonLabel,
        occurrenceCount: momentumAlert.occurrenceCount,
        sequenceLabel: momentumAlert.sequenceLabel,
        reasons: normalizedReasons,
        changePercent: roundMetric(quote.changePercent, 2),
        quoteFreshness: signalFreshness,
        quoteProvider: quote.provider,
        priceBucketLabel: getPriceBucketLabel(quote.price),
        degraded: signalFreshness === "cached",
        watchlisted: true,
        tags,
        score: Math.max(finalScore, finalSeverityScore),
        finalScore: Math.max(finalScore, finalSeverityScore),
        scoreBreakdown: {
          momentumScore,
          volumeScore,
          newsScore,
          trendScore,
          finalScore: Math.max(finalScore, finalSeverityScore),
        },
        factors,
        factorCount,
        newsSentiment,
        news,
        topOpportunity: false,
        reasonBadges,
        relativeVolume: relativeVolume !== null ? roundMetric(relativeVolume, 2) : null,
        volumeRatio: disruption?.volumeRatio ?? (relativeVolume !== null ? roundMetric(relativeVolume, 2) : null),
        volume: volumeSnapshot?.currentVolume ?? null,
        currentVolume: volumeSnapshot?.currentVolume ?? null,
        averageVolume: volumeSnapshot?.averageVolume ?? null,
        themeTags,
        specialTags,
        haltStatus: "active",
        streakCount,
        sourceData: disruption?.sourceData ?? ["price", "change_percent", "relative_volume"],
        freezeSeconds: disruption?.freezeSeconds ?? Math.round(Math.max(0, observedAtMs - new Date(quote.timestamp).getTime()) / 1000),
        reappearance: {
          isReappearing,
          strongerReappearance,
          label: reappearanceLabel,
          scoreBoost: reappearanceScoreBoost,
          lastSeenAt,
          lastScore,
          lastRank: latestRecentEvaluation?.rank ?? null,
        },
        floatShares: tickerMeta.floatShares ?? null,
        riskFlags: appliedRiskFlags,
        qualityDebug,
        alertTime,
        direction,
        alertType,
        priceBucket,
        alertCountToday,
        countryFlag,
        marketCap: null,
        institutionalOwnershipPercent: null,
        shortInterestPercent: null,
        costToBorrowPercent: null,
        theme,
        newsHeadline: news.headline,
        newsUrl: null,
        sessionHigh: previousObservedHigh ?? null,
        dayHigh: previousObservedHigh ?? null,
        previousHigh: previousObservedHigh ?? null,
        formattedLine,
      });
      diagnostics.generated += 1;
    }

    state.tickers[tickerMeta.ticker] = canEvaluate
      ? {
          firstObservedAt,
          observedHigh: Math.max(previousObservedHigh ?? quote.price, quote.price),
          lastQuoteTimestamp: quote.timestamp,
          lastEvaluatedAt: observedAt,
          lastChangePercent: quote.changePercent,
          lastSignals: shouldSurfaceSignal && activeSignalType ? [activeSignalType] : [],
          lastSignalAt: shouldSurfaceSignal ? observedAt : priorTickerState.lastSignalAt ?? null,
          lastSignalType: shouldSurfaceSignal ? activeSignalType : priorTickerState.lastSignalType ?? null,
          lastSeverityScore: shouldSurfaceSignal
            ? disruption?.severityScore ?? finalScore
            : priorTickerState.lastSeverityScore ?? null,
          history: trimmedHistory,
        }
      : {
          ...priorTickerState,
          firstObservedAt: priorTickerState.firstObservedAt ?? observedAt,
          lastEvaluatedAt: observedAt,
          lastSignals: [],
          history: trimmedHistory,
        };

    return {
      ...tickerMeta,
      price: quote.price,
      changePercent: roundMetric(quote.changePercent, 2),
      timestamp: quote.timestamp,
      freshness: quote.freshness,
      quoteProvider: quote.provider,
      activeSignalType: activeSignalType ?? undefined,
      hasActiveSignal: shouldSurfaceSignal,
      scannerScore: shouldSurfaceSignal ? finalScore : null,
      reasonBadges,
      scannerStatus: shouldSurfaceSignal ? "eligible" : "excluded",
      exclusionReason,
    } satisfies WatchlistQuote;
  });

  signals.sort((left, right) => {
    if (right.finalScore !== left.finalScore) {
      return right.finalScore - left.finalScore;
    }

    if (right.confidenceScore !== left.confidenceScore) {
      return right.confidenceScore - left.confidenceScore;
    }

    if ((right.relativeVolume ?? 0) !== (left.relativeVolume ?? 0)) {
      return (right.relativeVolume ?? 0) - (left.relativeVolume ?? 0);
    }

    return right.changePercent - left.changePercent;
  });

  const cappedSignals = signals.slice(0, runtimeConfig.maxSignalsPerCycle);
  if (signals.length > cappedSignals.length) {
    diagnostics.suppressedByMaxSignalsPerCycle = signals.length - cappedSignals.length;
    diagnostics.maxCycleSuppressedTickers = signals
      .slice(runtimeConfig.maxSignalsPerCycle)
      .map((signal) => signal.ticker)
      .slice(0, MAX_DIAGNOSTIC_TICKERS);
  }
  lastCycleDiagnostics = {
    generated: diagnostics.generated,
    returned: cappedSignals.length,
    maxSignalsPerCycle: runtimeConfig.maxSignalsPerCycle,
    suppressedCooldown: diagnostics.suppressedCooldown,
    suppressedByMaxSignalsPerCycle: diagnostics.suppressedByMaxSignalsPerCycle,
    possibleHaltsEmitted: diagnostics.possibleHaltsEmitted,
    possibleHaltsSuppressed: diagnostics.possibleHaltsSuppressed,
    haltSuppressionReasons: { ...diagnostics.haltSuppressionReasons },
    cooldownSuppressedTickers: [...diagnostics.cooldownSuppressedTickers],
    maxCycleSuppressedTickers: [...diagnostics.maxCycleSuppressedTickers],
    lastHaltSuppressionReasons: [...diagnostics.lastHaltSuppressionReasons],
  };

  if (
    diagnostics.generated > 0 ||
    diagnostics.suppressedCooldown > 0 ||
    diagnostics.possibleHaltsEmitted > 0 ||
    diagnostics.possibleHaltsSuppressed > 0 ||
    diagnostics.suppressedByMaxSignalsPerCycle > 0
  ) {
    console.log("[live-signal-engine]", "cycle", {
      generated: diagnostics.generated,
      returned: cappedSignals.length,
      maxSignalsPerCycle: runtimeConfig.maxSignalsPerCycle,
      suppressedCooldown: diagnostics.suppressedCooldown,
      suppressedByMaxSignalsPerCycle: diagnostics.suppressedByMaxSignalsPerCycle,
      possibleHaltsEmitted: diagnostics.possibleHaltsEmitted,
      possibleHaltsSuppressed: diagnostics.possibleHaltsSuppressed,
      haltSuppressionReasons: diagnostics.haltSuppressionReasons,
      cooldownSuppressedTickers: diagnostics.cooldownSuppressedTickers,
      maxCycleSuppressedTickers: diagnostics.maxCycleSuppressedTickers,
    });
  }

  cappedSignals.forEach((signal, index) => {
    signal.topOpportunity = index === 0;
    if (signal.topOpportunity) {
      if (!signal.reasonBadges.includes("TOP OPPORTUNITY")) {
        signal.reasonBadges.unshift("TOP OPPORTUNITY");
      }
      if (!signal.tags.includes("TOP OPPORTUNITY")) {
        signal.tags.push("TOP OPPORTUNITY");
      }
    }
  });
  const surfacedTickers = new Set(cappedSignals.map((signal) => signal.ticker));

  const rankedWatchlist = [...watchlistItems].sort((left, right) => {
    const leftScore = left.scannerScore ?? -1;
    const rightScore = right.scannerScore ?? -1;
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    const freshnessRank = (value: WatchlistQuote["freshness"]) =>
      value === "fresh" ? 2 : value === "cached" ? 1 : 0;
    if (freshnessRank(right.freshness) !== freshnessRank(left.freshness)) {
      return freshnessRank(right.freshness) - freshnessRank(left.freshness);
    }

    return (right.changePercent ?? -999) - (left.changePercent ?? -999);
  }).map((item) => {
    if (!item.hasActiveSignal) {
      return item;
    }

    if (!surfacedTickers.has(item.ticker)) {
      return {
        ...item,
        hasActiveSignal: false,
        activeSignalType: undefined,
        scannerStatus: "excluded" as const,
        exclusionReason: "low_score" as const,
      };
    }

    return item;
  });

  return {
    signals: cappedSignals,
    watchlist: rankedWatchlist,
    generatedAt: observedAt,
  };
}
