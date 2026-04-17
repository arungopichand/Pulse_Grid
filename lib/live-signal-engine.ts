import type { PersistedRecentEvaluation } from "./session-state-store";
import type { QuoteFreshness, QuoteProvider, QuoteSnapshot } from "./market-data";
import type { VolumeSnapshot } from "./volume-data";
import type { WatchlistTicker } from "./watchlist";

export type SignalType = "Breakout" | "Momentum Spike";

export type SignalScoreBreakdown = {
  momentum: number;
  volume: number;
  catalyst: number;
  trend: number;
  freshnessPenalty: number;
  riskPenalty: number;
  final: number;
};

export type Signal = {
  id: string;
  ticker: string;
  company: string;
  signalType: SignalType;
  price: number;
  timestamp: string;
  confidence: number;
  reason: string;
  changePercent: number;
  quoteFreshness: Exclude<QuoteFreshness, "stale">;
  quoteProvider: QuoteProvider;
  sector: string;
  watchlisted?: boolean;
  tags: string[];
  score: number;
  scoreBreakdown: SignalScoreBreakdown;
  reasonBadges: string[];
  relativeVolume: number | null;
  currentVolume: number | null;
  averageVolume: number | null;
  streakCount: number;
  floatShares: number | null;
  riskFlags: string[];
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
  exclusionReason?: "missing_quote" | "stale_quote" | "missing_volume" | "thin_liquidity" | "low_score" | "failed_confluence" | null;
};

export type TickerEvaluationState = {
  observedHigh: number | null;
  lastQuoteTimestamp: string | null;
  lastEvaluatedAt: string | null;
  lastSignals: SignalType[];
};

export type LiveSignalEngineState = {
  tickers: Record<string, TickerEvaluationState>;
};

export type LiveSignalEngineOutput = {
  signals: Signal[];
  watchlist: WatchlistQuote[];
  generatedAt: string;
};

const DEFAULT_PRICE_CAP = 5;
const MOMENTUM_THRESHOLD = 4;
const STRONG_MOMENTUM_THRESHOLD = 8;
const BREAKOUT_THRESHOLD_PERCENT = 0.45;
const STRONG_BREAKOUT_THRESHOLD_PERCENT = 1;
const MIN_CURRENT_VOLUME = 300_000;
const MIN_AVERAGE_VOLUME = 250_000;
const MIN_RELATIVE_VOLUME = 1.8;
const MIN_DOLLAR_LIQUIDITY = 750_000;
const LOW_FLOAT_THRESHOLD = 50_000_000;
const VERY_LOW_FLOAT_THRESHOLD = 20_000_000;
const RECENT_STRENGTH_WINDOW_MS = 20 * 60_000;
const MIN_VISIBLE_SCORE = 55;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundMetric(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatFloat(value: number | null) {
  if (!value) {
    return null;
  }

  if (value >= 1_000_000_000) {
    return `${roundMetric(value / 1_000_000_000)}B`;
  }

  return `${roundMetric(value / 1_000_000)}M`;
}

function createDefaultTickerState(): TickerEvaluationState {
  return {
    observedHigh: null,
    lastQuoteTimestamp: null,
    lastEvaluatedAt: null,
    lastSignals: [],
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

function createReasonSummary(reasonBadges: string[]) {
  if (!reasonBadges.length) {
    return "Monitoring for fresh price, volume, and repeat-strength alignment.";
  }

  return reasonBadges.slice(0, 3).join(" | ");
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
  recentEvaluations?: Record<string, PersistedRecentEvaluation[]>;
  observedAt: string;
}): LiveSignalEngineOutput {
  const { state, watchlist, quotes, volumeSnapshots = [], recentEvaluations = {}, observedAt } = params;
  const quoteMap = new Map(quotes.map((quote) => [quote.ticker, quote]));
  const volumeMap = new Map(volumeSnapshots.map((snapshot) => [snapshot.ticker, snapshot]));
  const signals: Signal[] = [];

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
    const previousObservedHigh = priorTickerState.observedHigh;
    const signalFreshness = quote.freshness === "fresh" ? "fresh" : quote.freshness === "cached" ? "cached" : null;
    const canEvaluate = signalFreshness !== null;
    const volumeSnapshot = volumeMap.get(tickerMeta.ticker);
    const relativeVolume =
      volumeSnapshot && volumeSnapshot.averageVolume > 0 ? volumeSnapshot.currentVolume / volumeSnapshot.averageVolume : null;
    const dollarLiquidity = volumeSnapshot ? volumeSnapshot.currentVolume * volumeSnapshot.price : 0;
    const streakCount = getRecentStrengthCount(recentEvaluations[tickerMeta.ticker], observedAt);
    const breakoutPercent =
      canEvaluate && previousObservedHigh && quote.price > previousObservedHigh
        ? ((quote.price - previousObservedHigh) / previousObservedHigh) * 100
        : 0;
    const activeSignalTypes: SignalType[] = [];
    const reasonBadges: string[] = [];
    const tags = ["Live", "Penny Scan"];
    let exclusionReason: WatchlistQuote["exclusionReason"] = null;

    if (tickerMeta.exchange) {
      reasonBadges.push(tickerMeta.exchange);
    }

    let momentumScore = 0;
    let volumeScore = 0;
    let catalystScore = 0;
    let trendScore = 0;
    let freshnessPenalty = 0;
    let riskPenalty = 0;
    let confidenceBase = 50;

    const isPennyCandidate = quote.price <= DEFAULT_PRICE_CAP;
    const hasLiquidity =
      volumeSnapshot !== undefined &&
      volumeSnapshot.currentVolume >= MIN_CURRENT_VOLUME &&
      volumeSnapshot.averageVolume >= MIN_AVERAGE_VOLUME &&
      dollarLiquidity >= MIN_DOLLAR_LIQUIDITY;
    const hasStrongVolume = hasLiquidity && relativeVolume !== null && relativeVolume >= MIN_RELATIVE_VOLUME;
    const hasMomentum = canEvaluate && quote.changePercent >= MOMENTUM_THRESHOLD;
    const hasStrongMomentum = canEvaluate && quote.changePercent >= STRONG_MOMENTUM_THRESHOLD;
    const hasBreakout = canEvaluate && breakoutPercent >= BREAKOUT_THRESHOLD_PERCENT;
    const hasStrongBreakout = canEvaluate && breakoutPercent >= STRONG_BREAKOUT_THRESHOLD_PERCENT;
    const hasTightFloat = typeof tickerMeta.floatShares === "number" && tickerMeta.floatShares <= LOW_FLOAT_THRESHOLD;
    const hasVeryTightFloat = typeof tickerMeta.floatShares === "number" && tickerMeta.floatShares <= VERY_LOW_FLOAT_THRESHOLD;
    const hasRepeatStrength = streakCount >= 2;

    if (quote.freshness === "cached") {
      freshnessPenalty += 8;
      reasonBadges.push("Cached");
    }

    if (quote.freshness === "stale") {
      exclusionReason = "stale_quote";
      reasonBadges.push("Stale");
    }

    if (hasMomentum) {
      momentumScore = clamp(roundMetric((quote.changePercent - MOMENTUM_THRESHOLD) * 4 + 14), 12, 34);
      confidenceBase += 10;
      activeSignalTypes.push("Momentum Spike");
      reasonBadges.push(hasStrongMomentum ? `Price Spike ${quote.changePercent.toFixed(1)}%` : `Move ${quote.changePercent.toFixed(1)}%`);
      tags.push("Momentum");
    }

    if (hasBreakout) {
      trendScore += clamp(roundMetric(breakoutPercent * 10 + 8), 8, 24);
      confidenceBase += 8;
      activeSignalTypes.push("Breakout");
      reasonBadges.push(hasStrongBreakout ? `Breakout ${breakoutPercent.toFixed(1)}%` : "Trend Break");
      tags.push("Breakout");
    }

    if (hasStrongVolume && relativeVolume !== null) {
      volumeScore += clamp(roundMetric(relativeVolume * 8 + 6), 10, 32);
      confidenceBase += 10;
      reasonBadges.push(`RVOL ${relativeVolume.toFixed(1)}x`);
      tags.push("Volume");
    }

    if (hasRepeatStrength) {
      trendScore += clamp(6 + streakCount * 4, 10, 24);
      confidenceBase += 6;
      reasonBadges.push(`${streakCount}x Repeat Strength`);
      tags.push("Repeat");
    }

    if (hasTightFloat) {
      catalystScore += hasVeryTightFloat ? 14 : 8;
      confidenceBase += hasVeryTightFloat ? 5 : 3;
      const floatLabel = formatFloat(tickerMeta.floatShares ?? null);
      if (floatLabel) {
        reasonBadges.push(`Float ${floatLabel}`);
      }
      tags.push("Low Float");
    }

    if (!isPennyCandidate) {
      riskPenalty += 26;
      reasonBadges.push("Above $5");
    }

    if (!hasLiquidity) {
      riskPenalty += 18;
      reasonBadges.push("Thin Liquidity");
      exclusionReason = volumeSnapshot ? "thin_liquidity" : "missing_volume";
    }

    if (tickerMeta.riskFlags?.length) {
      riskPenalty += tickerMeta.riskFlags.length * 4;
    }

    const confluenceFactors = [hasStrongMomentum || hasMomentum, hasStrongVolume, hasBreakout, hasRepeatStrength, hasTightFloat].filter(Boolean).length;
    const finalScore = Math.max(
      0,
      roundMetric(momentumScore + volumeScore + catalystScore + trendScore - freshnessPenalty - riskPenalty),
    );

    const activeSignalType: SignalType | undefined =
      activeSignalTypes.includes("Momentum Spike") && activeSignalTypes.includes("Breakout")
        ? hasStrongMomentum
          ? "Momentum Spike"
          : "Breakout"
        : activeSignalTypes[0];

    const reason = createReasonSummary(reasonBadges);

    const shouldSurfaceSignal =
      canEvaluate &&
      isPennyCandidate &&
      hasLiquidity &&
      confluenceFactors >= 2 &&
      finalScore >= MIN_VISIBLE_SCORE &&
      Boolean(activeSignalType);

    if (!shouldSurfaceSignal && !exclusionReason) {
      exclusionReason = !canEvaluate
        ? "stale_quote"
        : !hasLiquidity
          ? volumeSnapshot
            ? "thin_liquidity"
            : "missing_volume"
          : confluenceFactors < 2
            ? "failed_confluence"
            : "low_score";
    }

    if (shouldSurfaceSignal && signalFreshness) {
      signals.push({
        id: `${tickerMeta.ticker}-scanner-setup`,
        ticker: tickerMeta.ticker,
        company: tickerMeta.company,
        sector: tickerMeta.sector,
        signalType: activeSignalType!,
        price: quote.price,
        timestamp: quote.timestamp,
        confidence: clamp(Math.round(confidenceBase + finalScore * 0.35), 67, 98),
        reason,
        changePercent: roundMetric(quote.changePercent, 2),
        quoteFreshness: signalFreshness,
        quoteProvider: quote.provider,
        watchlisted: true,
        tags,
        score: finalScore,
        scoreBreakdown: {
          momentum: momentumScore,
          volume: volumeScore,
          catalyst: catalystScore,
          trend: trendScore,
          freshnessPenalty,
          riskPenalty,
          final: finalScore,
        },
        reasonBadges,
        relativeVolume: relativeVolume !== null ? roundMetric(relativeVolume, 2) : null,
        currentVolume: volumeSnapshot?.currentVolume ?? null,
        averageVolume: volumeSnapshot?.averageVolume ?? null,
        streakCount,
        floatShares: tickerMeta.floatShares ?? null,
        riskFlags: tickerMeta.riskFlags ?? [],
      });
    }

    state.tickers[tickerMeta.ticker] = canEvaluate
      ? {
          observedHigh: Math.max(previousObservedHigh ?? quote.price, quote.price),
          lastQuoteTimestamp: quote.timestamp,
          lastEvaluatedAt: observedAt,
          lastSignals: shouldSurfaceSignal && activeSignalType ? [activeSignalType] : [],
        }
      : {
          ...priorTickerState,
          lastEvaluatedAt: observedAt,
          lastSignals: [],
        };

    return {
      ...tickerMeta,
      price: quote.price,
      changePercent: roundMetric(quote.changePercent, 2),
      timestamp: quote.timestamp,
      freshness: quote.freshness,
      quoteProvider: quote.provider,
      activeSignalType,
      hasActiveSignal: shouldSurfaceSignal,
      scannerScore: shouldSurfaceSignal ? finalScore : null,
      reasonBadges,
      scannerStatus: shouldSurfaceSignal ? "eligible" : "excluded",
      exclusionReason,
    } satisfies WatchlistQuote;
  });

  signals.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }

    if ((right.relativeVolume ?? 0) !== (left.relativeVolume ?? 0)) {
      return (right.relativeVolume ?? 0) - (left.relativeVolume ?? 0);
    }

    return right.changePercent - left.changePercent;
  });

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
  });

  return {
    signals,
    watchlist: rankedWatchlist,
    generatedAt: observedAt,
  };
}
