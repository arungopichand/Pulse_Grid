import {
  fetchMassiveStockSnapshots,
  getMassiveApiKey,
  isMassiveErrorPayload,
  normalizeMassiveStockSnapshots,
} from "./providers/massive";
import type { RunnerAlert } from "./runner-alerts";
import type { MomentumAlert } from "./active-now";
import type { BotFeedItem } from "./bot-feed/types";

export type MarketDataProvider = {
  name: string;
  apiKeyEnvVar: string;
  baseUrl: string;
  pollIntervalMs: number;
};

export type QuoteFreshness = "fresh" | "cached" | "stale";
export type QuoteProvider = "massive" | "finnhub" | "twelve_data";

export type QuoteSnapshot = {
  ticker: string;
  price: number;
  changePercent: number;
  timestamp: string;
  lastUpdated: string;
  freshness: QuoteFreshness;
  provider: QuoteProvider;
};

export type QuoteState = {
  ticker: string;
  available: boolean;
  freshness: QuoteFreshness | "missing";
  lastUpdated: string | null;
  provider: QuoteProvider | null;
};

export type QuoteFetchSummary = {
  requested: number;
  fresh: number;
  cached: number;
  stale: number;
  failed: number;
  servedFromCache: number;
  fetchedFromMassive: number;
  fetchedFromFinnhub: number;
  fetchedFromTwelveData: number;
};

export type QuoteFailureReason =
  | "missing_api_key"
  | "invalid_api_key"
  | "rate_limited"
  | "network_error"
  | "upstream_error"
  | "invalid_request";

type QuoteFetchBase = {
  summary: QuoteFetchSummary;
  quoteStates: Record<string, QuoteState>;
  cacheTtlMs: number;
  staleAfterMs: number;
  refreshBatchSize: number;
};

export type QuoteFetchResult =
  | (QuoteFetchBase & {
      ok: true;
      quotes: QuoteSnapshot[];
      degraded: false;
    })
  | (QuoteFetchBase & {
      ok: false;
      quotes: QuoteSnapshot[];
      degraded: true;
      reason:
        | "missing_api_key"
        | "invalid_api_key"
        | "rate_limited"
        | "network_error"
        | "upstream_error"
        | "invalid_request";
      message: string;
      retryAfterMs: number;
    });

export type LiveSessionSnapshot =
  | {
      ok: true;
      degraded: false;
      message: string;
      retryAfterMs: number;
      generatedAt: string;
      sessionDate: string;
      sessionStatus: "premarket" | "regular" | "after-hours" | "closed";
      sessionLabel: string;
      signals: import("./live-signal-engine").Signal[];
      alerts: RunnerAlert[];
      watchlist: import("./live-signal-engine").WatchlistQuote[];
      lastUpdated: string | null;
      persistence: import("./session-state-store").PersistenceStatus;
      events: import("./live-events").LiveEvent[];
      liveAlertsNow: MomentumAlert[];
      botFeed: BotFeedItem[];
      notifications: import("./live-events").LiveEvent[];
      volumeMovers: import("./volume-movers").VolumeMover[];
      volumeMoversMessage: string | null;
      activeUniverseTickers?: string[];
      universeAdjusted?: boolean;
      universeMessage?: string | null;
      marketData?: QuoteFetchBase;
      streamHealth?: {
        connected: boolean;
        reconnecting: boolean;
        statusOnlyStream: boolean;
        degraded: boolean;
        degradedReason: string | null;
        wsMessagesReceived: number;
        wsUpdatesApplied: number;
        lastMessageAt: string | null;
        lastWsUpdateAt: string | null;
      };
      scannerDiagnostics?: {
        massiveApiKeyConfigured: boolean;
        universeSource: string;
        activeUniverseCount: number;
        discoveredCount: number;
        selectedCount: number;
        noQualifyingSymbols: boolean;
        websocketConnected: boolean;
        websocketAuthenticated: boolean | null;
        websocketSubscribedCount: number;
        websocketMessagesReceived: number;
        websocketUpdatesApplied: number;
        websocketDegradedReason: string | null;
        quoteFresh: number;
        quoteCached: number;
        quoteStale: number;
        quoteFailed: number;
        primaryMessages: string[];
        stocksOnly?: boolean;
        etfRejectedCount?: number;
        rejectedEtfSymbols?: string[];
        rejectedWarrantSymbols?: string[];
        unknownAllowedSymbols?: string[];
        eventsDetectedCount?: number;
        alertsEmittedCount?: number;
        cooldownSuppressedCount?: number;
        newsFetchStatus?: "ok" | "empty" | "error";
        retainedUniverse?: boolean;
        retainedUniverseCount?: number;
        retainedSignalCount?: number;
        activeSignalMemoryCount?: number;
        latestSnapshotSignalCount?: number;
        uiRetentionTtlMs?: number;
        lastSignalReceivedAt?: string | null;
        lastNonEmptySignalTimestamp?: string | null;
        flickerProtectionActive?: boolean;
        scannerThresholds?: {
          minPrice: number;
          maxPrice: number;
          minVolume: number;
          minRelativeVolume: number;
          minAbsChangePercent: number;
          bullishOnly: boolean;
        };
        discoveredBeforeFilters?: number;
        rejectionReasonCounts?: Record<string, number>;
        topCandidates?: Array<{
          ticker: string;
          price: number;
          changePercent: number;
          currentVolume: number;
          relativeVolume: number | null;
          reason: string;
        }>;
      };
      diagnostics?: {
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
      };
    }
  | {
      ok: false;
      degraded: true;
      message: string;
      retryAfterMs: number;
      sessionDate: string;
      sessionStatus: "premarket" | "regular" | "after-hours" | "closed";
      sessionLabel: string;
      signals: import("./live-signal-engine").Signal[];
      alerts: RunnerAlert[];
      watchlist: import("./live-signal-engine").WatchlistQuote[];
      lastUpdated: string | null;
      persistence: import("./session-state-store").PersistenceStatus;
      events: import("./live-events").LiveEvent[];
      liveAlertsNow: MomentumAlert[];
      botFeed: BotFeedItem[];
      notifications: import("./live-events").LiveEvent[];
      volumeMovers: import("./volume-movers").VolumeMover[];
      volumeMoversMessage: string | null;
      activeUniverseTickers?: string[];
      universeAdjusted?: boolean;
      universeMessage?: string | null;
      marketData?: QuoteFetchBase;
      streamHealth?: {
        connected: boolean;
        reconnecting: boolean;
        statusOnlyStream: boolean;
        degraded: boolean;
        degradedReason: string | null;
        wsMessagesReceived: number;
        wsUpdatesApplied: number;
        lastMessageAt: string | null;
        lastWsUpdateAt: string | null;
      };
      scannerDiagnostics?: {
        massiveApiKeyConfigured: boolean;
        universeSource: string;
        activeUniverseCount: number;
        discoveredCount: number;
        selectedCount: number;
        noQualifyingSymbols: boolean;
        websocketConnected: boolean;
        websocketAuthenticated: boolean | null;
        websocketSubscribedCount: number;
        websocketMessagesReceived: number;
        websocketUpdatesApplied: number;
        websocketDegradedReason: string | null;
        quoteFresh: number;
        quoteCached: number;
        quoteStale: number;
        quoteFailed: number;
        primaryMessages: string[];
        stocksOnly?: boolean;
        etfRejectedCount?: number;
        rejectedEtfSymbols?: string[];
        rejectedWarrantSymbols?: string[];
        unknownAllowedSymbols?: string[];
        eventsDetectedCount?: number;
        alertsEmittedCount?: number;
        cooldownSuppressedCount?: number;
        newsFetchStatus?: "ok" | "empty" | "error";
        retainedUniverse?: boolean;
        retainedUniverseCount?: number;
        retainedSignalCount?: number;
        activeSignalMemoryCount?: number;
        latestSnapshotSignalCount?: number;
        uiRetentionTtlMs?: number;
        lastSignalReceivedAt?: string | null;
        lastNonEmptySignalTimestamp?: string | null;
        flickerProtectionActive?: boolean;
        scannerThresholds?: {
          minPrice: number;
          maxPrice: number;
          minVolume: number;
          minRelativeVolume: number;
          minAbsChangePercent: number;
          bullishOnly: boolean;
        };
        discoveredBeforeFilters?: number;
        rejectionReasonCounts?: Record<string, number>;
        topCandidates?: Array<{
          ticker: string;
          price: number;
          changePercent: number;
          currentVolume: number;
          relativeVolume: number | null;
          reason: string;
        }>;
      };
      diagnostics?: {
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
      };
    };

type ProviderAttemptFailureReason =
  | "missing_api_key"
  | "invalid_api_key"
  | "rate_limited"
  | "network_error"
  | "upstream_error";

type ProviderTickerFailure = {
  ticker: string;
  reason: ProviderAttemptFailureReason;
  message: string;
};

type ProviderAttemptResult = {
  provider: QuoteProvider;
  quotes: QuoteSnapshot[];
  failures: ProviderTickerFailure[];
};

type CachedQuoteEntry = {
  ticker: string;
  price: number;
  changePercent: number;
  timestamp: string;
  provider: QuoteProvider;
  cachedAt: number;
};

type ProviderMetrics = {
  cooldownActivations: number;
  cooldownSkips: number;
  rateLimitResponses: number;
};

const QUOTE_CACHE_TTL_MS = 20_000;
const FAST_LANE_QUOTE_CACHE_TTL_MS = 4_000;
const STALE_QUOTE_AFTER_MS = 60_000;
const DEFAULT_REFRESH_BATCH_SIZE = 4;
const DEGRADED_REFRESH_BATCH_SIZE = 3;
const RATE_LIMIT_REFRESH_BATCH_SIZE = 2;
const MIN_HEALTHY_QUOTES = 8;
const MASSIVE_COOLDOWN_MS = 75_000;
const FINNHUB_COOLDOWN_MS = 75_000;
const TWELVE_DATA_COOLDOWN_MS = 75_000;

const quoteCache = new Map<string, CachedQuoteEntry>();
const providerCooldownUntil: Record<QuoteProvider, number> = {
  massive: 0,
  finnhub: 0,
  twelve_data: 0,
};
const providerMetrics: Record<QuoteProvider, ProviderMetrics> = {
  massive: {
    cooldownActivations: 0,
    cooldownSkips: 0,
    rateLimitResponses: 0,
  },
  finnhub: {
    cooldownActivations: 0,
    cooldownSkips: 0,
    rateLimitResponses: 0,
  },
  twelve_data: {
    cooldownActivations: 0,
    cooldownSkips: 0,
    rateLimitResponses: 0,
  },
};
let refreshCursor = 0;
let degradedModeActive = false;
let degradedModeReason: QuoteFailureReason | null = null;

export const marketDataProvider: MarketDataProvider = {
  name: "Massive",
  apiKeyEnvVar: "MASSIVE_API_KEY",
  baseUrl: "https://api.massive.com",
  pollIntervalMs: 15000,
};

function getMassiveServerApiKey() {
  return getMassiveApiKey();
}

function getFinnhubApiKey() {
  return process.env.FINNHUB_API_KEY?.trim() ?? "";
}

function getTwelveDataApiKey() {
  return process.env.TWELVE_DATA_API_KEY?.trim() ?? "";
}

function logMarketDataIssue(
  level: "warn" | "error",
  code: string,
  details: Record<string, unknown> = {},
) {
  console[level]("[market-data]", code, details);
}

function isProviderCoolingDown(provider: QuoteProvider) {
  return providerCooldownUntil[provider] > Date.now();
}

function getProviderCooldownRemainingMs(provider: QuoteProvider) {
  return Math.max(0, providerCooldownUntil[provider] - Date.now());
}

function activateProviderCooldown(provider: QuoteProvider) {
  providerMetrics[provider].cooldownActivations += 1;
  providerCooldownUntil[provider] =
    Date.now() +
    (provider === "massive"
      ? MASSIVE_COOLDOWN_MS
      : provider === "finnhub"
        ? FINNHUB_COOLDOWN_MS
        : TWELVE_DATA_COOLDOWN_MS);
}

function getRefreshBatchSize() {
  if (!degradedModeActive) {
    return DEFAULT_REFRESH_BATCH_SIZE;
  }

  return degradedModeReason === "rate_limited" ? RATE_LIMIT_REFRESH_BATCH_SIZE : DEGRADED_REFRESH_BATCH_SIZE;
}

function buildFinnhubQuoteUrl(ticker: string) {
  const params = new URLSearchParams({
    symbol: ticker,
    token: getFinnhubApiKey(),
  });

  return `https://finnhub.io/api/v1/quote?${params.toString()}`;
}

function buildTwelveDataQuoteUrl(ticker: string) {
  const params = new URLSearchParams({
    symbol: ticker,
    apikey: getTwelveDataApiKey(),
  });

  return `https://api.twelvedata.com/quote?${params.toString()}`;
}

function isValidQuotePayload(payload: unknown): payload is { c: number; dp?: number } {
  if (!payload || typeof payload !== "object") return false;
  const maybeQuote = payload as Record<string, unknown>;
  return typeof maybeQuote.c === "number" && Number.isFinite(maybeQuote.c);
}

function isTwelveDataErrorPayload(
  payload: unknown,
): payload is { status?: string; code?: number | string; message?: string } {
  if (!payload || typeof payload !== "object") return false;
  const maybeError = payload as Record<string, unknown>;

  return (
    maybeError.status === "error" ||
    typeof maybeError.code === "number" ||
    typeof maybeError.code === "string" ||
    typeof maybeError.message === "string"
  );
}

function parseNumericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeFinnhubQuote(ticker: string, payload: { c: number; dp?: number }): QuoteSnapshot {
  const timestamp = new Date().toISOString();

  return {
    ticker,
    price: Math.max(0, Math.round(payload.c * 100) / 100),
    changePercent: typeof payload.dp === "number" ? payload.dp : 0,
    timestamp,
    lastUpdated: timestamp,
    freshness: "fresh",
    provider: "finnhub",
  };
}

function normalizeTwelveDataQuote(ticker: string, payload: Record<string, unknown>): QuoteSnapshot | null {
  const close = parseNumericValue(payload.close);
  const percentChange = parseNumericValue(payload.percent_change) ?? 0;

  if (close === null || close <= 0) {
    return null;
  }

  const timestampValue =
    typeof payload.timestamp === "number"
      ? new Date(payload.timestamp * 1000).toISOString()
      : typeof payload.datetime === "string"
        ? new Date(payload.datetime).toISOString()
        : new Date().toISOString();

  return {
    ticker,
    price: Math.round(close * 100) / 100,
    changePercent: percentChange,
    timestamp: timestampValue,
    lastUpdated: timestampValue,
    freshness: "fresh",
    provider: "twelve_data",
  };
}

function buildQuoteState(
  ticker: string,
  freshness: QuoteFreshness | "missing",
  entry?: CachedQuoteEntry,
): QuoteState {
  return {
    ticker,
    available: Boolean(entry),
    freshness,
    lastUpdated: entry?.timestamp ?? null,
    provider: entry?.provider ?? null,
  };
}

function createSummary(requested: number): QuoteFetchSummary {
  return {
    requested,
    fresh: 0,
    cached: 0,
    stale: 0,
    failed: 0,
    servedFromCache: 0,
    fetchedFromMassive: 0,
    fetchedFromFinnhub: 0,
    fetchedFromTwelveData: 0,
  };
}

function createQuoteFetchBase(summary: QuoteFetchSummary, quoteStates: Record<string, QuoteState>): QuoteFetchBase {
  return {
    summary,
    quoteStates,
    cacheTtlMs: QUOTE_CACHE_TTL_MS,
    staleAfterMs: STALE_QUOTE_AFTER_MS,
    refreshBatchSize: getRefreshBatchSize(),
  };
}

function createQuoteFetchBaseWithOverrides(
  summary: QuoteFetchSummary,
  quoteStates: Record<string, QuoteState>,
  overrides?: {
    cacheTtlMs?: number;
    refreshBatchSize?: number;
  },
): QuoteFetchBase {
  return {
    ...createQuoteFetchBase(summary, quoteStates),
    cacheTtlMs: overrides?.cacheTtlMs ?? QUOTE_CACHE_TTL_MS,
    refreshBatchSize: overrides?.refreshBatchSize ?? getRefreshBatchSize(),
  };
}

function toCacheEntry(quote: QuoteSnapshot): CachedQuoteEntry {
  return {
    ticker: quote.ticker,
    price: quote.price,
    changePercent: quote.changePercent,
    timestamp: quote.timestamp,
    provider: quote.provider,
    cachedAt: Date.now(),
  };
}

function quoteAgeMs(entry: CachedQuoteEntry, now: number) {
  return Math.max(0, now - entry.cachedAt);
}

function quoteCacheAgeMs(entry: CachedQuoteEntry, now: number) {
  return Math.max(0, now - entry.cachedAt);
}

function buildQuoteFromCache(entry: CachedQuoteEntry, freshness: QuoteFreshness): QuoteSnapshot {
  return {
    ticker: entry.ticker,
    price: entry.price,
    changePercent: entry.changePercent,
    timestamp: entry.timestamp,
    lastUpdated: entry.timestamp,
    freshness,
    provider: entry.provider,
  };
}

function chooseTickersToRefresh(tickers: string[], refreshBatchSize = getRefreshBatchSize()) {

  if (tickers.length <= refreshBatchSize) {
    return [...tickers];
  }

  const start = refreshCursor % tickers.length;
  const selected: string[] = [];

  for (let offset = 0; offset < refreshBatchSize; offset += 1) {
    selected.push(tickers[(start + offset) % tickers.length]);
  }

  refreshCursor = (start + refreshBatchSize) % tickers.length;
  return selected;
}

function prioritizeTickers(tickers: string[], prioritizedTickers: string[]) {
  if (!prioritizedTickers.length) {
    return tickers;
  }

  const prioritySet = new Set(prioritizedTickers);
  const prioritized = tickers.filter((ticker) => prioritySet.has(ticker));
  const remaining = tickers.filter((ticker) => !prioritySet.has(ticker));
  return [...prioritized, ...remaining];
}

function writeQuotesToCache(quotes: QuoteSnapshot[]) {
  for (const quote of quotes) {
    quoteCache.set(quote.ticker, toCacheEntry(quote));
  }
}

async function fetchMassivePrimaryQuotes(tickers: string[]): Promise<ProviderAttemptResult> {
  const apiKey = getMassiveServerApiKey();

  if (isProviderCoolingDown("massive")) {
    const cooldownMs = getProviderCooldownRemainingMs("massive");
    providerMetrics.massive.cooldownSkips += 1;

    logMarketDataIssue("warn", "provider_cooling_down", {
      provider: "massive",
      cooldownMs,
      tickers: tickers.length,
      counters: providerMetrics.massive,
      skippedNetworkCall: true,
    });

    return {
      provider: "massive",
      quotes: [],
      failures: tickers.map((ticker) => ({
        ticker,
        reason: "rate_limited",
        message: `Massive cooldown active for ${cooldownMs}ms.`,
      })),
    };
  }

  if (!apiKey) {
    logMarketDataIssue("warn", "missing_api_key", {
      provider: "massive",
      envVar: "MASSIVE_API_KEY",
    });

    return {
      provider: "massive",
      quotes: [],
      failures: tickers.map((ticker) => ({
        ticker,
        reason: "missing_api_key",
        message: "Massive server key is not configured.",
      })),
    };
  }

  try {
    const { response, payload } = await fetchMassiveStockSnapshots(tickers);

    if (response.status === 401 || response.status === 403) {
      logMarketDataIssue("warn", "provider_auth_error", {
        provider: "massive",
        status: response.status,
        tickers: tickers.length,
      });

      return {
        provider: "massive",
        quotes: [],
        failures: tickers.map((ticker) => ({
          ticker,
          reason: "invalid_api_key",
          message: "Massive rejected the server API key.",
        })),
      };
    }

    if (response.status === 429) {
      providerMetrics.massive.rateLimitResponses += 1;
      activateProviderCooldown("massive");
      const cooldownMs = getProviderCooldownRemainingMs("massive");
      logMarketDataIssue("warn", "provider_rate_limited", {
        provider: "massive",
        status: response.status,
        cooldownMs,
        counters: providerMetrics.massive,
      });

      return {
        provider: "massive",
        quotes: [],
        failures: tickers.map((ticker) => ({
          ticker,
          reason: "rate_limited",
          message: "Massive rate limit hit.",
        })),
      };
    }

    if (!response.ok) {
      logMarketDataIssue("error", "provider_http_error", {
        provider: "massive",
        status: response.status,
        tickers: tickers.length,
      });

      return {
        provider: "massive",
        quotes: [],
        failures: tickers.map((ticker) => ({
          ticker,
          reason: "upstream_error",
          message: "Massive returned an upstream error.",
        })),
      };
    }

    if (isMassiveErrorPayload(payload)) {
      logMarketDataIssue("warn", "provider_error_payload", {
        provider: "massive",
        status: payload.status ?? null,
        message: payload.message ?? payload.error ?? null,
      });

      return {
        provider: "massive",
        quotes: [],
        failures: tickers.map((ticker) => ({
          ticker,
          reason: "upstream_error",
          message: "Massive returned an error payload.",
        })),
      };
    }

    const normalizedQuotes = normalizeMassiveStockSnapshots(payload).map((quote) => ({
      ticker: quote.ticker,
      price: Math.max(0, Math.round(quote.price * 100) / 100),
      changePercent: quote.changePercent,
      timestamp: quote.timestamp,
      lastUpdated: quote.timestamp,
      freshness: "fresh" as const,
      provider: "massive" as const,
    }));
    const quoteMap = new Map(normalizedQuotes.map((quote) => [quote.ticker, quote]));
    const failures = tickers
      .filter((ticker) => !quoteMap.has(ticker))
      .map((ticker) => ({
        ticker,
        reason: "upstream_error" as const,
        message: "Massive did not return a valid quote snapshot for this ticker.",
      }));

    if (failures.length) {
      logMarketDataIssue("warn", "partial_quote_payload", {
        provider: "massive",
        fulfilled: normalizedQuotes.length,
        failed: failures.length,
      });
    }

    return {
      provider: "massive",
      quotes: normalizedQuotes,
      failures,
    };
  } catch (error) {
    logMarketDataIssue("error", "provider_network_error", {
      provider: "massive",
      tickers: tickers.length,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return {
      provider: "massive",
      quotes: [],
      failures: tickers.map((ticker) => ({
        ticker,
        reason: "network_error",
        message: "Massive network request failed.",
      })),
    };
  }
}

async function fetchFinnhubPrimaryQuotes(tickers: string[]): Promise<ProviderAttemptResult> {
  const apiKey = getFinnhubApiKey();

  if (isProviderCoolingDown("finnhub")) {
    const cooldownMs = getProviderCooldownRemainingMs("finnhub");
    providerMetrics.finnhub.cooldownSkips += 1;

        logMarketDataIssue("warn", "provider_cooling_down", {
          provider: "finnhub",
          cooldownMs,
          tickers: tickers.length,
          counters: providerMetrics.finnhub,
          skippedNetworkCall: true,
        });

    return {
      provider: "finnhub",
      quotes: [],
      failures: tickers.map((ticker) => ({
        ticker,
        reason: "rate_limited",
        message: `Finnhub cooldown active for ${cooldownMs}ms.`,
      })),
    };
  }

  if (!apiKey) {
    logMarketDataIssue("warn", "missing_api_key", {
      provider: "finnhub",
      envVar: marketDataProvider.apiKeyEnvVar,
    });

    return {
      provider: "finnhub",
      quotes: [],
      failures: tickers.map((ticker) => ({
        ticker,
        reason: "missing_api_key",
        message: "Finnhub server key is not configured.",
      })),
    };
  }

  const responses = await Promise.all(
    tickers.map(async (ticker) => {
      try {
        const response = await fetch(buildFinnhubQuoteUrl(ticker), {
          cache: "no-store",
        });

        if (response.status === 401 || response.status === 403) {
          logMarketDataIssue("warn", "provider_auth_error", {
            provider: "finnhub",
            ticker,
            status: response.status,
          });

          return {
            ok: false as const,
            failure: {
              ticker,
              reason: "invalid_api_key" as const,
              message: "Finnhub rejected the server API key.",
            },
          };
        }

        if (response.status === 429) {
          providerMetrics.finnhub.rateLimitResponses += 1;
          activateProviderCooldown("finnhub");
          const cooldownMs = getProviderCooldownRemainingMs("finnhub");
          logMarketDataIssue("warn", "provider_rate_limited", {
            provider: "finnhub",
            ticker,
            status: response.status,
            cooldownMs,
            counters: providerMetrics.finnhub,
          });

          return {
            ok: false as const,
            failure: {
              ticker,
              reason: "rate_limited" as const,
              message: "Finnhub rate limit hit.",
            },
          };
        }

        if (!response.ok) {
          logMarketDataIssue("error", "provider_http_error", {
            provider: "finnhub",
            ticker,
            status: response.status,
          });

          return {
            ok: false as const,
            failure: {
              ticker,
              reason: "upstream_error" as const,
              message: "Finnhub returned an upstream error.",
            },
          };
        }

        const payload = (await response.json()) as unknown;

        if (!isValidQuotePayload(payload)) {
          logMarketDataIssue("warn", "invalid_quote_payload", {
            provider: "finnhub",
            ticker,
          });

          return {
            ok: false as const,
            failure: {
              ticker,
              reason: "upstream_error" as const,
              message: "Finnhub returned an invalid quote payload.",
            },
          };
        }

        return {
          ok: true as const,
          quote: normalizeFinnhubQuote(ticker, payload),
        };
      } catch (error) {
        logMarketDataIssue("error", "provider_network_error", {
          provider: "finnhub",
          ticker,
          error: error instanceof Error ? error.message : "unknown_error",
        });

        return {
          ok: false as const,
          failure: {
            ticker,
            reason: "network_error" as const,
            message: "Finnhub network request failed.",
          },
        };
      }
    }),
  );

  return {
    provider: "finnhub",
    quotes: responses.flatMap((result) => (result.ok ? [result.quote] : [])),
    failures: responses.flatMap((result) => (result.ok ? [] : [result.failure])),
  };
}

async function fetchTwelveDataQuotes(tickers: string[]): Promise<ProviderAttemptResult> {
  const apiKey = getTwelveDataApiKey();

  if (isProviderCoolingDown("twelve_data")) {
    const cooldownMs = getProviderCooldownRemainingMs("twelve_data");
    providerMetrics.twelve_data.cooldownSkips += 1;

        logMarketDataIssue("warn", "provider_cooling_down", {
          provider: "twelve_data",
          cooldownMs,
          tickers: tickers.length,
          counters: providerMetrics.twelve_data,
          skippedNetworkCall: true,
        });

    return {
      provider: "twelve_data",
      quotes: [],
      failures: tickers.map((ticker) => ({
        ticker,
        reason: "rate_limited",
        message: `Twelve Data cooldown active for ${cooldownMs}ms.`,
      })),
    };
  }

  if (!apiKey) {
    logMarketDataIssue("warn", "missing_api_key", {
      provider: "twelve_data",
      envVar: "TWELVE_DATA_API_KEY",
    });

    return {
      provider: "twelve_data",
      quotes: [],
      failures: tickers.map((ticker) => ({
        ticker,
        reason: "missing_api_key",
        message: "Twelve Data server key is not configured.",
      })),
    };
  }

  const responses = await Promise.all(
    tickers.map(async (ticker) => {
      try {
        const response = await fetch(buildTwelveDataQuoteUrl(ticker), {
          cache: "no-store",
        });

        if (response.status === 401 || response.status === 403) {
          logMarketDataIssue("warn", "provider_auth_error", {
            provider: "twelve_data",
            ticker,
            status: response.status,
          });

          return {
            ok: false as const,
            failure: {
              ticker,
              reason: "invalid_api_key" as const,
              message: "Twelve Data rejected the server API key.",
            },
          };
        }

        if (response.status === 429) {
          providerMetrics.twelve_data.rateLimitResponses += 1;
          activateProviderCooldown("twelve_data");
          const cooldownMs = getProviderCooldownRemainingMs("twelve_data");
          logMarketDataIssue("warn", "provider_rate_limited", {
            provider: "twelve_data",
            ticker,
            status: response.status,
            cooldownMs,
            counters: providerMetrics.twelve_data,
          });

          return {
            ok: false as const,
            failure: {
              ticker,
              reason: "rate_limited" as const,
              message: "Twelve Data rate limit hit.",
            },
          };
        }

        if (!response.ok) {
          logMarketDataIssue("error", "provider_http_error", {
            provider: "twelve_data",
            ticker,
            status: response.status,
          });

          return {
            ok: false as const,
            failure: {
              ticker,
              reason: "upstream_error" as const,
              message: "Twelve Data returned an upstream error.",
            },
          };
        }

        const payload = (await response.json()) as unknown;

        if (isTwelveDataErrorPayload(payload)) {
          const code = typeof payload.code === "number" ? payload.code : Number.parseInt(String(payload.code ?? ""), 10);

          logMarketDataIssue("warn", "provider_error_payload", {
            provider: "twelve_data",
            ticker,
            code: Number.isFinite(code) ? code : null,
            status: typeof payload.status === "string" ? payload.status : null,
          });

          if (code === 401 || code === 403) {
            return {
              ok: false as const,
              failure: {
                ticker,
                reason: "invalid_api_key" as const,
                message: "Twelve Data rejected the server API key.",
              },
            };
          }

          if (code === 429) {
            providerMetrics.twelve_data.rateLimitResponses += 1;
            activateProviderCooldown("twelve_data");
            return {
              ok: false as const,
              failure: {
                ticker,
                reason: "rate_limited" as const,
                message: "Twelve Data rate limit hit.",
              },
            };
          }

          return {
            ok: false as const,
            failure: {
              ticker,
              reason: "upstream_error" as const,
              message: "Twelve Data returned an upstream error payload.",
            },
          };
        }

        if (!payload || typeof payload !== "object") {
          logMarketDataIssue("warn", "invalid_quote_payload", {
            provider: "twelve_data",
            ticker,
          });

          return {
            ok: false as const,
            failure: {
              ticker,
              reason: "upstream_error" as const,
              message: "Twelve Data returned an invalid quote payload.",
            },
          };
        }

        const quote = normalizeTwelveDataQuote(ticker, payload as Record<string, unknown>);

        if (!quote) {
          logMarketDataIssue("warn", "invalid_quote_payload", {
            provider: "twelve_data",
            ticker,
          });

          return {
            ok: false as const,
            failure: {
              ticker,
              reason: "upstream_error" as const,
              message: "Twelve Data returned an invalid quote payload.",
            },
          };
        }

        return {
          ok: true as const,
          quote,
        };
      } catch (error) {
        logMarketDataIssue("error", "provider_network_error", {
          provider: "twelve_data",
          ticker,
          error: error instanceof Error ? error.message : "unknown_error",
        });

        return {
          ok: false as const,
          failure: {
            ticker,
            reason: "network_error" as const,
            message: "Twelve Data network request failed.",
          },
        };
      }
    }),
  );

  return {
    provider: "twelve_data",
    quotes: responses.flatMap((result) => (result.ok ? [result.quote] : [])),
    failures: responses.flatMap((result) => (result.ok ? [] : [result.failure])),
  };
}

function buildQuoteFetchFailure(
  reason: QuoteFailureReason,
  message: string,
  retryAfterMs: number,
  quotes: QuoteSnapshot[],
  summary: QuoteFetchSummary,
  quoteStates: Record<string, QuoteState>,
): QuoteFetchResult {
  return {
    ok: false,
    quotes,
    degraded: true,
    reason,
    message,
    retryAfterMs,
    ...createQuoteFetchBase(summary, quoteStates),
  };
}

function mapDominantFailureReason(failures: ProviderTickerFailure[]): QuoteFailureReason {
  if (!failures.length) {
    return "upstream_error";
  }

  if (failures.some((failure) => failure.reason === "rate_limited")) {
    return "rate_limited";
  }

  if (failures.every((failure) => failure.reason === "missing_api_key")) {
    return "missing_api_key";
  }

  if (failures.every((failure) => failure.reason === "invalid_api_key")) {
    return "invalid_api_key";
  }

  if (failures.some((failure) => failure.reason === "network_error")) {
    return "network_error";
  }

  return "upstream_error";
}

function buildUnavailableMessage(reason: QuoteFailureReason) {
  const massiveCoolingDown = isProviderCoolingDown("massive");
  const finnhubCoolingDown = isProviderCoolingDown("finnhub");
  const twelveDataCoolingDown = isProviderCoolingDown("twelve_data");
  const coolingDownText =
    massiveCoolingDown || finnhubCoolingDown || twelveDataCoolingDown
      ? ` Provider cooldowns active: Massive ${getProviderCooldownRemainingMs("massive")}ms, Finnhub ${getProviderCooldownRemainingMs("finnhub")}ms, Twelve Data ${getProviderCooldownRemainingMs("twelve_data")}ms.`
      : "";

  switch (reason) {
    case "missing_api_key":
      return "No market-data provider key is configured on the server. Live quotes cannot be refreshed.";
    case "invalid_api_key":
      return "Market-data provider authentication failed. Live quotes cannot be refreshed until the key is corrected.";
    case "rate_limited":
      return `Market-data providers are rate-limiting quote refreshes and entering cooldown.${coolingDownText}`;
    case "network_error":
      return "Market-data providers are temporarily unreachable. Retrying shortly.";
    default:
      return "Live market data is temporarily unavailable across providers. Retrying shortly.";
  }
}

function buildCycleLog(summary: QuoteFetchSummary) {
  return {
    cacheHits: summary.servedFromCache,
    primaryFetchCount: summary.fetchedFromMassive,
    fallbackFinnhubCount: summary.fetchedFromFinnhub,
    fallbackTwelveDataCount: summary.fetchedFromTwelveData,
    failures: summary.failed,
    cooldowns: {
      massive: providerMetrics.massive,
      finnhub: providerMetrics.finnhub,
      twelveData: providerMetrics.twelve_data,
    },
  };
}

function decrementSummaryForPriorState(summary: QuoteFetchSummary, priorFreshness: QuoteFreshness | "missing" | undefined) {
  if (priorFreshness === "cached") {
    summary.cached = Math.max(0, summary.cached - 1);
    summary.servedFromCache = Math.max(0, summary.servedFromCache - 1);
  }

  if (priorFreshness === "stale") {
    summary.stale = Math.max(0, summary.stale - 1);
  }

  if (priorFreshness === "missing") {
    summary.failed = Math.max(0, summary.failed - 1);
  }
}

export function getMarketDataProviderStatus() {
  return {
    provider: marketDataProvider,
    configured: null,
    pollIntervalMs: marketDataProvider.pollIntervalMs,
    message: "Connecting to the live session to verify quote availability, freshness, and persistence health.",
  };
}

export function getMarketDataThresholds() {
  return {
    cacheTtlMs: QUOTE_CACHE_TTL_MS,
    staleAfterMs: STALE_QUOTE_AFTER_MS,
    refreshBatchSize: getRefreshBatchSize(),
    minHealthyQuotes: MIN_HEALTHY_QUOTES,
  };
}

export async function fetchWatchlistQuotes(
  tickers: string[],
  options?: { signal?: AbortSignal },
): Promise<QuoteFetchResult> {
  if (!tickers.length) {
    return {
      ok: true,
      quotes: [],
      degraded: false,
      ...createQuoteFetchBase(createSummary(0), {}),
    };
  }

  try {
    const params = new URLSearchParams();
    params.set("tickers", tickers.join(","));

    const response = await fetch(`/api/market/quotes?${params.toString()}`, {
      cache: "no-store",
      signal: options?.signal,
    });

    const payload = (await response.json()) as QuoteFetchResult;

    if (!response.ok) {
      return payload;
    }

    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }

    return buildQuoteFetchFailure(
      "network_error",
      "Live quotes are temporarily unavailable. Showing a degraded state until polling recovers.",
      15000,
      [],
      createSummary(tickers.length),
      Object.fromEntries(tickers.map((ticker) => [ticker, buildQuoteState(ticker, "missing")])),
    );
  }
}

export async function fetchLiveSessionSnapshot(options?: { signal?: AbortSignal }): Promise<LiveSessionSnapshot> {
  try {
    const response = await fetch("/api/live-session", {
      cache: "no-store",
      signal: options?.signal,
    });

    return (await response.json()) as LiveSessionSnapshot;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }

    return {
      ok: false,
      degraded: true,
      message: "Live session snapshot is temporarily unavailable. Retrying shortly.",
      retryAfterMs: 15000,
      sessionDate: "",
      sessionStatus: "closed",
      sessionLabel: "Closed",
      signals: [],
      alerts: [],
      watchlist: [],
      lastUpdated: null,
      persistence: {
        mode: "none",
        durable: false,
        healthy: false,
        message: "Live session persistence status is unavailable.",
        lastPersistedAt: null,
      },
      events: [],
      liveAlertsNow: [],
      botFeed: [],
      notifications: [],
      volumeMovers: [],
      volumeMoversMessage: "Volume Movers data is temporarily unavailable.",
    };
  }
}

export async function fetchFinnhubQuotes(
  tickers: string[],
  options?: {
    prioritizedTickers?: string[];
    fastLaneTickers?: string[];
    fastLaneCacheTtlMs?: number;
    slowLaneCacheTtlMs?: number;
    slowLaneBatchSize?: number;
  },
): Promise<QuoteFetchResult> {
  if (!tickers.length) {
    return {
      ok: true,
      quotes: [],
      degraded: false,
      ...createQuoteFetchBase(createSummary(0), {}),
    };
  }

  const uniqueTickers = Array.from(new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)));
  const startedAt = Date.now();
  const configuredSlowLaneBatchSize = options?.slowLaneBatchSize ?? getRefreshBatchSize();
  const uncachedTickers = uniqueTickers.filter((ticker) => !quoteCache.has(ticker));
  const slowLaneBatchSize =
    uncachedTickers.length === uniqueTickers.length ? uniqueTickers.length : configuredSlowLaneBatchSize;
  const prioritizedTickers = prioritizeTickers(uniqueTickers, options?.prioritizedTickers?.map((ticker) => ticker.trim().toUpperCase()) ?? []);
  const fastLaneTickers = Array.from(
    new Set(
      (options?.fastLaneTickers ?? options?.prioritizedTickers ?? [])
        .map((ticker) => ticker.trim().toUpperCase())
        .filter((ticker) => uniqueTickers.includes(ticker)),
    ),
  );
  const fastLaneSet = new Set(fastLaneTickers);
  const fastLaneCacheTtlMs = options?.fastLaneCacheTtlMs ?? FAST_LANE_QUOTE_CACHE_TTL_MS;
  const slowLaneCacheTtlMs = options?.slowLaneCacheTtlMs ?? QUOTE_CACHE_TTL_MS;
  const effectiveRefreshBatchSize = fastLaneTickers.length + slowLaneBatchSize;
  const now = Date.now();
  const summary = createSummary(uniqueTickers.length);
  const quoteStates: Record<string, QuoteState> = {};
  const servedQuotes = new Map<string, QuoteSnapshot>();
  const slowLaneUniverse = prioritizedTickers.filter((ticker) => !fastLaneSet.has(ticker));
  const slowLaneRotation = new Set(chooseTickersToRefresh(slowLaneUniverse, slowLaneBatchSize));
  const fastLaneRefreshes: string[] = [];
  const staleSlowLane: string[] = [];
  const missingSlowLane: string[] = [];
  const rotatedSlowLaneRefreshes: string[] = [];

  for (const ticker of uniqueTickers) {
    const entry = quoteCache.get(ticker);
    const isFastLaneTicker = fastLaneSet.has(ticker);

    if (!entry) {
      quoteStates[ticker] = buildQuoteState(ticker, "missing");
      if (isFastLaneTicker) {
        fastLaneRefreshes.push(ticker);
      } else {
        missingSlowLane.push(ticker);
      }
      continue;
    }

    const ageMs = quoteAgeMs(entry, now);
    const cacheAgeMs = quoteCacheAgeMs(entry, now);
    const freshness: QuoteFreshness = ageMs > STALE_QUOTE_AFTER_MS ? "stale" : "cached";

    servedQuotes.set(ticker, buildQuoteFromCache(entry, freshness));
    quoteStates[ticker] = buildQuoteState(ticker, freshness, entry);

    if (freshness === "stale") {
      summary.stale += 1;
    } else {
      summary.cached += 1;
      summary.servedFromCache += 1;
    }

    if (freshness === "stale") {
      if (isFastLaneTicker) {
        fastLaneRefreshes.push(ticker);
      } else {
        staleSlowLane.push(ticker);
      }
      continue;
    }

    if (isFastLaneTicker && cacheAgeMs > fastLaneCacheTtlMs) {
      fastLaneRefreshes.push(ticker);
    } else if (slowLaneRotation.has(ticker) && cacheAgeMs > slowLaneCacheTtlMs) {
      rotatedSlowLaneRefreshes.push(ticker);
    }
  }

  const slowLaneRefreshPlan = [...staleSlowLane, ...missingSlowLane, ...rotatedSlowLaneRefreshes].slice(0, slowLaneBatchSize);
  const tickersNeedingRefresh = Array.from(new Set([...fastLaneRefreshes, ...slowLaneRefreshPlan]));

  if (tickersNeedingRefresh.length) {
    const massiveResult = await fetchMassivePrimaryQuotes(tickersNeedingRefresh);
    writeQuotesToCache(massiveResult.quotes);

    for (const quote of massiveResult.quotes) {
      const priorFreshness = quoteStates[quote.ticker]?.freshness;
      decrementSummaryForPriorState(summary, priorFreshness);
      const cacheEntry = toCacheEntry(quote);
      servedQuotes.set(quote.ticker, quote);
      quoteStates[quote.ticker] = buildQuoteState(quote.ticker, "fresh", cacheEntry);
      summary.fetchedFromMassive += 1;
      summary.fresh += 1;
    }

    const failedOnMassive = massiveResult.failures.map((failure) => failure.ticker);

    if (failedOnMassive.length) {
      logMarketDataIssue("warn", "provider_fallback_triggered", {
        provider: "massive",
        fallbackProvider: "finnhub",
        reason: mapDominantFailureReason(massiveResult.failures),
        tickers: failedOnMassive.length,
      });

      const finnhubResult = await fetchFinnhubPrimaryQuotes(failedOnMassive);
      writeQuotesToCache(finnhubResult.quotes);

      for (const quote of finnhubResult.quotes) {
        const priorFreshness = quoteStates[quote.ticker]?.freshness;
        decrementSummaryForPriorState(summary, priorFreshness);
        const cacheEntry = toCacheEntry(quote);
        servedQuotes.set(quote.ticker, quote);
        quoteStates[quote.ticker] = buildQuoteState(quote.ticker, "fresh", cacheEntry);
        summary.fetchedFromFinnhub += 1;
        summary.fresh += 1;
      }

      let finalFailures: ProviderTickerFailure[] = massiveResult.failures.filter(
        (failure) => !finnhubResult.quotes.some((quote) => quote.ticker === failure.ticker),
      );

      const failedOnFinnhub = finnhubResult.failures.map((failure) => failure.ticker);

      if (failedOnFinnhub.length) {
        logMarketDataIssue("warn", "provider_fallback_triggered", {
          provider: "finnhub",
          fallbackProvider: "twelve_data",
          reason: mapDominantFailureReason(finnhubResult.failures),
          tickers: failedOnFinnhub.length,
        });

        const twelveDataResult = await fetchTwelveDataQuotes(failedOnFinnhub);
        writeQuotesToCache(twelveDataResult.quotes);

        for (const quote of twelveDataResult.quotes) {
          const priorFreshness = quoteStates[quote.ticker]?.freshness;
          decrementSummaryForPriorState(summary, priorFreshness);
          const cacheEntry = toCacheEntry(quote);
          servedQuotes.set(quote.ticker, quote);
          quoteStates[quote.ticker] = buildQuoteState(quote.ticker, "fresh", cacheEntry);
          summary.fetchedFromTwelveData += 1;
          summary.fresh += 1;
        }

        const unresolvedFailures = finnhubResult.failures.filter(
          (failure) => !twelveDataResult.quotes.some((quote) => quote.ticker === failure.ticker),
        );

        const fallbackFailures = twelveDataResult.failures.filter(
          (failure) => !twelveDataResult.quotes.some((quote) => quote.ticker === failure.ticker),
        );

        finalFailures = unresolvedFailures.map((failure) => {
          const fallbackFailure = fallbackFailures.find((candidate) => candidate.ticker === failure.ticker);
          return fallbackFailure ?? failure;
        });
      }

      for (const failure of finalFailures) {
        const cachedEntry = quoteCache.get(failure.ticker);
        if (!cachedEntry) {
          if (quoteStates[failure.ticker]?.freshness !== "missing") {
            summary.failed += 1;
          }
          quoteStates[failure.ticker] = buildQuoteState(failure.ticker, "missing");
          continue;
        }

        const ageMs = quoteAgeMs(cachedEntry, Date.now());
        const freshness: QuoteFreshness = ageMs > STALE_QUOTE_AFTER_MS ? "stale" : "cached";
        const priorFreshness = quoteStates[failure.ticker]?.freshness;
        servedQuotes.set(failure.ticker, buildQuoteFromCache(cachedEntry, freshness));
        quoteStates[failure.ticker] = buildQuoteState(failure.ticker, freshness, cachedEntry);

        if (priorFreshness === "missing") {
          summary.failed = Math.max(0, summary.failed - 1);
          if (freshness === "stale") {
            summary.stale += 1;
          } else {
            summary.cached += 1;
            summary.servedFromCache += 1;
          }
        }
      }

      if (!servedQuotes.size) {
        const reason = mapDominantFailureReason(
          finalFailures.length ? finalFailures : [...massiveResult.failures, ...finnhubResult.failures],
        );
        const retryAfterMs =
          reason === "rate_limited"
            ? 20000
            : reason === "invalid_api_key" || reason === "missing_api_key"
              ? 60000
              : 15000;

        logMarketDataIssue("error", "provider_fallback_failed", {
          provider: "twelve_data",
          reason,
          primaryProvider: "massive",
          primaryReason: mapDominantFailureReason(massiveResult.failures),
          secondaryProvider: "finnhub",
          secondaryReason: mapDominantFailureReason(finnhubResult.failures),
          tickers: tickersNeedingRefresh.length,
        });

        const failureResult = buildQuoteFetchFailure(
          reason,
          buildUnavailableMessage(reason),
          retryAfterMs,
          [],
          summary,
          quoteStates,
        );
        failureResult.cacheTtlMs = slowLaneCacheTtlMs;
        failureResult.refreshBatchSize = effectiveRefreshBatchSize;
        degradedModeActive = true;
        degradedModeReason = reason;
        logMarketDataIssue("warn", "cycle_summary", {
          ...buildCycleLog(summary),
          latencyMs: Date.now() - startedAt,
          degraded: true,
          refreshed: tickersNeedingRefresh.length,
          refreshBatchSize: effectiveRefreshBatchSize,
        });
        return failureResult;
      }
    }
  }

  for (const ticker of uniqueTickers) {
    if (servedQuotes.has(ticker) || quoteStates[ticker]?.freshness !== "missing") {
      continue;
    }

    const entry = quoteCache.get(ticker);
    if (!entry) {
      quoteStates[ticker] = buildQuoteState(ticker, "missing");
      summary.failed += 1;
      continue;
    }

    const freshness: QuoteFreshness = quoteAgeMs(entry, Date.now()) > STALE_QUOTE_AFTER_MS ? "stale" : "cached";
    servedQuotes.set(ticker, buildQuoteFromCache(entry, freshness));
    quoteStates[ticker] = buildQuoteState(ticker, freshness, entry);

    if (freshness === "stale") {
      summary.stale += 1;
    } else {
      summary.cached += 1;
      summary.servedFromCache += 1;
    }
  }

  const quotes = uniqueTickers
    .map((ticker) => servedQuotes.get(ticker))
    .filter((quote): quote is QuoteSnapshot => Boolean(quote))
    .map((quote) => {
      const state = quoteStates[quote.ticker];
      return {
        ...quote,
        freshness: state.freshness === "missing" ? "stale" : state.freshness,
        lastUpdated: state.lastUpdated ?? quote.lastUpdated,
      };
    });

  const requiredHealthyQuotes = Math.min(MIN_HEALTHY_QUOTES, uniqueTickers.length);
  const healthyQuotes = quotes.filter((quote) => quote.freshness !== "stale").length;
  const tooManyUnavailable = summary.failed + summary.stale > uniqueTickers.length - requiredHealthyQuotes;

  if (!healthyQuotes && quotes.length === 0) {
    const failureResult = buildQuoteFetchFailure(
      "upstream_error",
      "Live market data is temporarily unavailable across providers. Retrying shortly.",
      15000,
      [],
      summary,
      quoteStates,
    );
    failureResult.cacheTtlMs = slowLaneCacheTtlMs;
    failureResult.refreshBatchSize = effectiveRefreshBatchSize;
    degradedModeActive = true;
    degradedModeReason = "upstream_error";
    logMarketDataIssue("warn", "cycle_summary", {
      ...buildCycleLog(summary),
      latencyMs: Date.now() - startedAt,
      degraded: true,
      refreshed: tickersNeedingRefresh.length,
      refreshBatchSize: effectiveRefreshBatchSize,
    });
    return failureResult;
  }

  if (tooManyUnavailable && healthyQuotes < requiredHealthyQuotes) {
    const failureResult = buildQuoteFetchFailure(
      "upstream_error",
      "Too many watchlist quotes are stale or unavailable to evaluate the live session safely.",
      15000,
      quotes,
      summary,
      quoteStates,
    );
    failureResult.cacheTtlMs = slowLaneCacheTtlMs;
    failureResult.refreshBatchSize = effectiveRefreshBatchSize;
    degradedModeActive = true;
    degradedModeReason = "upstream_error";
    logMarketDataIssue("warn", "cycle_summary", {
      ...buildCycleLog(summary),
      latencyMs: Date.now() - startedAt,
      degraded: true,
      refreshed: tickersNeedingRefresh.length,
      refreshBatchSize: effectiveRefreshBatchSize,
    });
    return failureResult;
  }

  const successResult: QuoteFetchResult = {
    ok: true,
    quotes,
    degraded: false,
    ...createQuoteFetchBaseWithOverrides(summary, quoteStates, {
      cacheTtlMs: slowLaneCacheTtlMs,
      refreshBatchSize: effectiveRefreshBatchSize,
    }),
  };
  degradedModeActive = false;
  degradedModeReason = null;
  logMarketDataIssue("warn", "cycle_summary", {
    ...buildCycleLog(summary),
    latencyMs: Date.now() - startedAt,
    degraded: false,
    refreshed: tickersNeedingRefresh.length,
    refreshBatchSize: effectiveRefreshBatchSize,
  });
  return successResult;
}
