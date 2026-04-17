import type { PersistedRecentEvaluation } from "./session-state-store";
import type { QuoteFreshness, QuoteProvider, QuoteSnapshot } from "./market-data";
import type { VolumeSnapshot } from "./volume-data";
import type { WatchlistTicker } from "./watchlist";
import type { StructuredNewsSnapshot } from "./news-data";

export type SignalType = "SPIKE" | "BULLISH" | "BEARISH";
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

export type Signal = {
  id: string;
  ticker: string;
  company: string;
  signalType: SignalType;
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
const STRONG_MOVE_THRESHOLD = 4;
const BREAKOUT_THRESHOLD_PERCENT = 0.45;
const STRONG_TREND_THRESHOLD_PERCENT = 1;
const MIN_CURRENT_VOLUME = 300_000;
const MIN_AVERAGE_VOLUME = 250_000;
const MIN_RELATIVE_VOLUME = 1.8;
const MIN_DOLLAR_LIQUIDITY = 750_000;
const RECENT_STRENGTH_WINDOW_MS = 20 * 60_000;
const MIN_VISIBLE_SCORE = 60;
const STRONG_MOVE_SCORE = 40;
const VOLUME_SPIKE_SCORE = 30;
const NEWS_SCORE = 30;
const TREND_SCORE = 20;

function roundMetric(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
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
    return "Monitoring for deterministic factor confluence.";
  }

  return reasonBadges.slice(0, 3).join(" | ");
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
}): LiveSignalEngineOutput {
  const { state, watchlist, quotes, volumeSnapshots = [], newsSnapshots = [], recentEvaluations = {}, observedAt } = params;
  const quoteMap = new Map(quotes.map((quote) => [quote.ticker, quote]));
  const volumeMap = new Map(volumeSnapshots.map((snapshot) => [snapshot.ticker, snapshot]));
  const newsMap = new Map(newsSnapshots.map((snapshot) => [snapshot.ticker, snapshot]));
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
    const reasonBadges: string[] = [];
    const reasons: string[] = [];
    const tags = ["Live", "Penny Scan"];
    let exclusionReason: WatchlistQuote["exclusionReason"] = null;

    if (tickerMeta.exchange) {
      reasonBadges.push(tickerMeta.exchange);
    }

    const isPennyCandidate = quote.price <= DEFAULT_PRICE_CAP;
    const hasLiquidity =
      volumeSnapshot !== undefined &&
      volumeSnapshot.currentVolume >= MIN_CURRENT_VOLUME &&
      volumeSnapshot.averageVolume >= MIN_AVERAGE_VOLUME &&
      dollarLiquidity >= MIN_DOLLAR_LIQUIDITY;
    const hasStrongMove = canEvaluate && quote.changePercent >= STRONG_MOVE_THRESHOLD;
    const hasVolumeSpike = hasLiquidity && relativeVolume !== null && relativeVolume >= MIN_RELATIVE_VOLUME;
    const hasTrending = canEvaluate && (streakCount >= 2 || breakoutPercent >= BREAKOUT_THRESHOLD_PERCENT);
    const hasTrendQuality = streakCount >= 2 || breakoutPercent >= STRONG_TREND_THRESHOLD_PERCENT;
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
      reasons.push(`Price is up ${quote.changePercent.toFixed(2)}%, meeting the strong-move factor.`);
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

    if (!isPennyCandidate) {
      reasonBadges.push("Above $5");
      reasons.push("Price is above the configured penny threshold.");
    }

    if (!hasLiquidity) {
      reasonBadges.push("Thin Liquidity");
      reasons.push("Liquidity thresholds are not met for this cycle.");
      exclusionReason = volumeSnapshot ? "thin_liquidity" : "missing_volume";
    }

    const factors: SignalFactors = {
      strongMove: hasStrongMove,
      volumeSpike: hasVolumeSpike,
      news: hasDirectionalNews,
      trending: hasTrending,
    };
    const factorCount = Object.values(factors).filter(Boolean).length;
    const momentumScore = hasStrongMove ? STRONG_MOVE_SCORE : 0;
    const volumeScore = hasVolumeSpike ? VOLUME_SPIKE_SCORE : 0;
    const newsScore = hasDirectionalNews ? NEWS_SCORE : 0;
    const trendScore = hasTrending ? TREND_SCORE : 0;
    const finalScore = momentumScore + volumeScore + newsScore + trendScore;
    const confidence = getSignalConfidence(factorCount);
    const confidenceScore = getConfidenceScore(confidence);

    const activeSignalType: SignalType = hasDirectionalNews
      ? newsSentiment === "bullish"
        ? "BULLISH"
        : "BEARISH"
      : "SPIKE";

    const reason = createReasonSummary(reasonBadges);

    const shouldSurfaceSignal =
      canEvaluate &&
      isPennyCandidate &&
      hasLiquidity &&
      factorCount >= 2 &&
      hasTrendQuality &&
      finalScore >= MIN_VISIBLE_SCORE &&
      Boolean(activeSignalType);

    if (!shouldSurfaceSignal && !exclusionReason) {
      exclusionReason = !canEvaluate
        ? "stale_quote"
        : !hasLiquidity
          ? volumeSnapshot
            ? "thin_liquidity"
            : "missing_volume"
          : factorCount < 2
            ? "failed_confluence"
            : "low_score";
    }

    if (shouldSurfaceSignal && signalFreshness) {
      const normalizedReasons = reasons.length > 0 ? reasons : ["Signal is active from deterministic factor confluence."];
      signals.push({
        id: `${tickerMeta.ticker}-scanner-setup`,
        ticker: tickerMeta.ticker,
        company: tickerMeta.company,
        sector: tickerMeta.sector,
        signalType: activeSignalType,
        price: quote.price,
        timestamp: quote.timestamp,
        confidence,
        confidenceScore,
        reason,
        reasons: normalizedReasons,
        changePercent: roundMetric(quote.changePercent, 2),
        quoteFreshness: signalFreshness,
        quoteProvider: quote.provider,
        degraded: signalFreshness === "cached",
        watchlisted: true,
        tags,
        score: finalScore,
        finalScore,
        scoreBreakdown: {
          momentumScore,
          volumeScore,
          newsScore,
          trendScore,
          finalScore,
        },
        factors,
        factorCount,
        newsSentiment,
        news,
        topOpportunity: false,
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

  signals.forEach((signal, index) => {
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
