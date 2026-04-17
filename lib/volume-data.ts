import type { QuoteFreshness } from "./market-data";
import {
  fetchMassiveIntradayAggregates,
  fetchMassiveStockSnapshots,
  getMassiveApiKey,
  isMassiveErrorPayload,
  normalizeMassiveAggregateBars,
  normalizeMassiveStockSnapshots,
} from "./providers/massive";
import { watchlistUniverse } from "./watchlist";

export type VolumeBar = {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type VolumeSnapshot = {
  ticker: string;
  company: string;
  price: number;
  changePercent: number;
  currentVolume: number;
  averageVolume: number;
  recentBars: VolumeBar[];
  lastUpdated: string;
  freshness: QuoteFreshness;
};

export type VolumeDataFailureReason =
  | "missing_api_key"
  | "invalid_api_key"
  | "rate_limited"
  | "network_error"
  | "upstream_error"
  | "invalid_request";

type VolumeProvider = "massive" | "twelve_data";

export type VolumeDataResult =
  | {
      ok: true;
      snapshots: VolumeSnapshot[];
      provider: VolumeProvider;
      degraded: false;
      summary: {
        requested: number;
        fulfilled: number;
        failed: number;
      };
    }
  | {
      ok: false;
      snapshots: VolumeSnapshot[];
      provider: VolumeProvider;
      degraded: true;
      reason: VolumeDataFailureReason;
      message: string;
      retryAfterMs: number;
      summary: {
        requested: number;
        fulfilled: number;
        failed: number;
      };
    };

type TwelveDataQuotePayload = Record<string, unknown>;
type TwelveDataTimeSeriesPayload = {
  values?: Record<string, unknown>[];
  status?: string;
  code?: number | string;
  message?: string;
};

type CachedVolumeSnapshotEntry = {
  snapshot: VolumeSnapshot;
  cachedAt: number;
};

type SuccessfulVolumeDataResult = Extract<VolumeDataResult, { ok: true }>;

type CachedVolumeDatasetEntry = {
  result: SuccessfulVolumeDataResult;
  cachedAt: number;
};

type VolumeProviderMetrics = {
  cooldownActivations: number;
  cooldownSkips: number;
  rateLimitResponses: number;
};

type CachedAverageVolumeEntry = {
  averageVolume: number;
  cachedAt: number;
};

type VolumeProviderFailure = {
  ticker: string;
  reason: VolumeDataFailureReason;
  message: string;
};

const TWELVE_DATA_BASE_URL = "https://api.twelvedata.com";
const RECENT_BAR_INTERVAL = "1min";
const RECENT_BAR_OUTPUT_SIZE = 10;
const DEFAULT_RETRY_AFTER_MS = 30_000;
const FRESH_VOLUME_WINDOW_MS = 2 * 60_000;
const STALE_VOLUME_WINDOW_MS = 5 * 60_000;
const VOLUME_CACHE_TTL_MS = 20_000;
const FAST_LANE_VOLUME_CACHE_TTL_MS = 8_000;
const DEFAULT_SLOW_VOLUME_REFRESH_BATCH_SIZE = 4;
const DAILY_AVERAGE_VOLUME_CACHE_TTL_MS = 6 * 60 * 60_000;
const MASSIVE_VOLUME_COOLDOWN_MS = 75_000;
const TWELVE_DATA_VOLUME_COOLDOWN_MS = 75_000;

const volumeSnapshotCache = new Map<string, CachedVolumeSnapshotEntry>();
const volumeDatasetCache = new Map<string, CachedVolumeDatasetEntry>();
const averageVolumeCache = new Map<string, CachedAverageVolumeEntry>();
const inFlightVolumeRequests = new Map<string, Promise<VolumeDataResult>>();
const volumeProviderMetrics: VolumeProviderMetrics = {
  cooldownActivations: 0,
  cooldownSkips: 0,
  rateLimitResponses: 0,
};
let massiveVolumeCooldownUntil = 0;
let twelveDataVolumeCooldownUntil = 0;
let volumeRefreshCursor = 0;

function getMassiveServerApiKey() {
  return getMassiveApiKey();
}

function getTwelveDataApiKey() {
  return process.env.TWELVE_DATA_API_KEY?.trim() ?? "";
}

function logVolumeDataIssue(
  level: "warn" | "error",
  code: string,
  details: Record<string, unknown> = {},
) {
  console[level]("[volume-data]", code, details);
}

function parseNumericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDatetimeValue(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function computeVolumeFreshness(lastUpdated: string): QuoteFreshness {
  const ageMs = Math.max(0, Date.now() - new Date(lastUpdated).getTime());
  return ageMs <= FRESH_VOLUME_WINDOW_MS ? "fresh" : ageMs <= STALE_VOLUME_WINDOW_MS ? "cached" : "stale";
}

function isErrorPayload(payload: unknown): payload is { status?: string; code?: number | string; message?: string } {
  if (!payload || typeof payload !== "object") return false;
  const maybePayload = payload as Record<string, unknown>;

  return (
    maybePayload.status === "error" ||
    typeof maybePayload.code === "number" ||
    typeof maybePayload.code === "string" ||
    typeof maybePayload.message === "string"
  );
}

function buildTwelveDataQuoteUrl(ticker: string) {
  const params = new URLSearchParams({
    symbol: ticker,
    interval: RECENT_BAR_INTERVAL,
    volume_time_period: "30",
    apikey: getTwelveDataApiKey(),
  });

  return `${TWELVE_DATA_BASE_URL}/quote?${params.toString()}`;
}

function buildTwelveDataTimeSeriesUrl(ticker: string) {
  const params = new URLSearchParams({
    symbol: ticker,
    interval: RECENT_BAR_INTERVAL,
    outputsize: String(RECENT_BAR_OUTPUT_SIZE),
    apikey: getTwelveDataApiKey(),
  });

  return `${TWELVE_DATA_BASE_URL}/time_series?${params.toString()}`;
}

function normalizeRecentBars(payload: TwelveDataTimeSeriesPayload): VolumeBar[] | null {
  if (!Array.isArray(payload.values) || payload.values.length === 0) {
    return null;
  }

  const normalized = payload.values
    .map((entry) => {
      const datetime = parseDatetimeValue(entry.datetime);
      const open = parseNumericValue(entry.open);
      const high = parseNumericValue(entry.high);
      const low = parseNumericValue(entry.low);
      const close = parseNumericValue(entry.close);
      const volume = parseNumericValue(entry.volume);

      if (!datetime || open === null || high === null || low === null || close === null || volume === null || volume < 0) {
        return null;
      }

      return {
        datetime,
        open,
        high,
        low,
        close,
        volume,
      } satisfies VolumeBar;
    })
    .filter((bar): bar is VolumeBar => Boolean(bar))
    .sort((left, right) => new Date(left.datetime).getTime() - new Date(right.datetime).getTime());

  return normalized.length > 1 ? normalized : null;
}

function normalizeVolumeSnapshot(ticker: string, quotePayload: TwelveDataQuotePayload, recentBars: VolumeBar[]): VolumeSnapshot | null {
  const company = watchlistUniverse.find((item) => item.ticker === ticker)?.company ?? ticker;
  const price = parseNumericValue(quotePayload.close) ?? parseNumericValue(quotePayload.price);
  const changePercent = parseNumericValue(quotePayload.percent_change);
  const currentVolume =
    parseNumericValue(quotePayload.volume) ??
    parseNumericValue(quotePayload.current_volume) ??
    recentBars.reduce((sum, bar) => sum + bar.volume, 0);
  const averageVolume =
    parseNumericValue(quotePayload.average_volume) ??
    parseNumericValue(quotePayload.avg_volume) ??
    parseNumericValue(quotePayload.average_volume_30d);
  const lastUpdated =
    parseDatetimeValue(quotePayload.datetime) ??
    parseDatetimeValue(quotePayload.timestamp) ??
    recentBars[recentBars.length - 1]?.datetime ??
    null;

  if (price === null || currentVolume === null || averageVolume === null || !lastUpdated || changePercent === null) {
    return null;
  }

  return {
    ticker,
    company,
    price,
    changePercent,
    currentVolume,
    averageVolume,
    recentBars,
    lastUpdated,
    freshness: computeVolumeFreshness(lastUpdated),
  };
}

function buildVolumeRequestKey(tickers: string[]) {
  return [...tickers].sort().join(",");
}

function chooseVolumeSlowLaneTickers(tickers: string[], batchSize: number) {
  if (tickers.length <= batchSize) {
    return [...tickers];
  }

  const start = volumeRefreshCursor % tickers.length;
  const selected: string[] = [];

  for (let offset = 0; offset < batchSize; offset += 1) {
    selected.push(tickers[(start + offset) % tickers.length]);
  }

  volumeRefreshCursor = (start + batchSize) % tickers.length;
  return selected;
}

function prioritizeVolumeTickers(tickers: string[], prioritizedTickers: string[]) {
  if (!prioritizedTickers.length) {
    return tickers;
  }

  const prioritySet = new Set(prioritizedTickers);
  const prioritized = tickers.filter((ticker) => prioritySet.has(ticker));
  const remaining = tickers.filter((ticker) => !prioritySet.has(ticker));
  return [...prioritized, ...remaining];
}

function isMassiveVolumeCoolingDown() {
  return massiveVolumeCooldownUntil > Date.now();
}

function getMassiveVolumeCooldownRemainingMs() {
  return Math.max(0, massiveVolumeCooldownUntil - Date.now());
}

function activateMassiveVolumeCooldown() {
  volumeProviderMetrics.cooldownActivations += 1;
  massiveVolumeCooldownUntil = Date.now() + MASSIVE_VOLUME_COOLDOWN_MS;
}

function isTwelveDataVolumeCoolingDown() {
  return twelveDataVolumeCooldownUntil > Date.now();
}

function getTwelveDataVolumeCooldownRemainingMs() {
  return Math.max(0, twelveDataVolumeCooldownUntil - Date.now());
}

function activateTwelveDataVolumeCooldown() {
  volumeProviderMetrics.cooldownActivations += 1;
  twelveDataVolumeCooldownUntil = Date.now() + TWELVE_DATA_VOLUME_COOLDOWN_MS;
}

function cloneSnapshotWithFreshness(snapshot: VolumeSnapshot): VolumeSnapshot {
  return {
    ...snapshot,
    recentBars: snapshot.recentBars.map((bar) => ({ ...bar })),
    freshness: computeVolumeFreshness(snapshot.lastUpdated),
  };
}

function orderSnapshots(tickers: string[], snapshots: VolumeSnapshot[]) {
  const snapshotMap = new Map(snapshots.map((snapshot) => [snapshot.ticker, snapshot]));
  return tickers.map((ticker) => snapshotMap.get(ticker)).filter((snapshot): snapshot is VolumeSnapshot => Boolean(snapshot));
}

function readAverageVolumeCache(ticker: string) {
  const entry = averageVolumeCache.get(ticker);
  if (!entry) {
    return null;
  }

  const ageMs = Math.max(0, Date.now() - entry.cachedAt);
  if (ageMs > DAILY_AVERAGE_VOLUME_CACHE_TTL_MS) {
    averageVolumeCache.delete(ticker);
    return null;
  }

  return entry.averageVolume;
}

function writeAverageVolumeCache(ticker: string, averageVolume: number) {
  averageVolumeCache.set(ticker, {
    averageVolume,
    cachedAt: Date.now(),
  });
}

function buildSuccessResult(provider: VolumeProvider, tickers: string[], snapshots: VolumeSnapshot[]): SuccessfulVolumeDataResult {
  const orderedSnapshots = orderSnapshots(tickers, snapshots);
  return {
    ok: true,
    snapshots: orderedSnapshots,
    provider,
    degraded: false,
    summary: {
      requested: tickers.length,
      fulfilled: orderedSnapshots.length,
      failed: Math.max(0, tickers.length - orderedSnapshots.length),
    },
  };
}

function writeVolumeSnapshotsToCache(snapshots: VolumeSnapshot[]) {
  const cachedAt = Date.now();

  for (const snapshot of snapshots) {
    volumeSnapshotCache.set(snapshot.ticker, {
      snapshot: cloneSnapshotWithFreshness(snapshot),
      cachedAt,
    });
  }
}

function writeVolumeDatasetToCache(tickers: string[], result: SuccessfulVolumeDataResult) {
  volumeDatasetCache.set(buildVolumeRequestKey(tickers), {
    result: buildSuccessResult(result.provider, tickers, result.snapshots.map(cloneSnapshotWithFreshness)),
    cachedAt: Date.now(),
  });
}

function readTickerCache(ticker: string) {
  const entry = volumeSnapshotCache.get(ticker);
  if (!entry) {
    return null;
  }

  return {
    snapshot: cloneSnapshotWithFreshness(entry.snapshot),
    cacheAgeMs: Math.max(0, Date.now() - entry.cachedAt),
  };
}

function getTickerSnapshotsFromCache(
  tickers: string[],
  options?: {
    maxCacheAgeMs?: number;
  },
) {
  const snapshots: VolumeSnapshot[] = [];

  for (const ticker of tickers) {
    const cached = readTickerCache(ticker);
    if (!cached || (typeof options?.maxCacheAgeMs === "number" && cached.cacheAgeMs > options.maxCacheAgeMs) || cached.snapshot.freshness === "stale") {
      continue;
    }

    snapshots.push(cached.snapshot);
  }

  return orderSnapshots(tickers, snapshots);
}

function getCachedDataset(
  tickers: string[],
  options?: {
    maxCacheAgeMs?: number;
  },
): SuccessfulVolumeDataResult | null {
  const entry = volumeDatasetCache.get(buildVolumeRequestKey(tickers));
  if (!entry) {
    return null;
  }

  const cacheAgeMs = Math.max(0, Date.now() - entry.cachedAt);
  if (typeof options?.maxCacheAgeMs === "number" && cacheAgeMs > options.maxCacheAgeMs) {
    return null;
  }

  const refreshed = buildSuccessResult(entry.result.provider, tickers, entry.result.snapshots.map(cloneSnapshotWithFreshness));
  if (!refreshed.snapshots.length || refreshed.snapshots.some((snapshot) => snapshot.freshness === "stale")) {
    return null;
  }

  return refreshed;
}

function tryServeLastGoodVolumeDataset(tickers: string[]) {
  const dataset = getCachedDataset(tickers);
  if (dataset) {
    logVolumeDataIssue("warn", "serving_cached_dataset_during_cooldown", {
      tickers: tickers.length,
      massiveCooldownMs: getMassiveVolumeCooldownRemainingMs(),
      twelveDataCooldownMs: getTwelveDataVolumeCooldownRemainingMs(),
      metrics: volumeProviderMetrics,
    });
    return dataset;
  }

  const snapshots = getTickerSnapshotsFromCache(tickers);
  if (snapshots.length === tickers.length) {
    const result = buildSuccessResult("massive", tickers, snapshots);
    writeVolumeDatasetToCache(tickers, result);
    logVolumeDataIssue("warn", "serving_cached_snapshots_during_cooldown", {
      tickers: tickers.length,
      massiveCooldownMs: getMassiveVolumeCooldownRemainingMs(),
      twelveDataCooldownMs: getTwelveDataVolumeCooldownRemainingMs(),
      metrics: volumeProviderMetrics,
    });
    return result;
  }

  return null;
}

function buildFailure(
  provider: VolumeProvider,
  reason: VolumeDataFailureReason,
  message: string,
  requested: number,
  snapshots: VolumeSnapshot[] = [],
  retryAfterMs = DEFAULT_RETRY_AFTER_MS,
): VolumeDataResult {
  return {
    ok: false,
    snapshots,
    provider,
    degraded: true,
    reason,
    message,
    retryAfterMs,
    summary: {
      requested,
      fulfilled: snapshots.length,
      failed: Math.max(0, requested - snapshots.length),
    },
  };
}

async function fetchMassiveVolumeSnapshots(
  tickers: string[],
): Promise<{ provider: "massive"; snapshots: VolumeSnapshot[]; failures: VolumeProviderFailure[] }> {
  const apiKey = getMassiveServerApiKey();
  if (!apiKey) {
    return {
      provider: "massive",
      snapshots: [],
      failures: tickers.map((ticker) => ({
        ticker,
        reason: "missing_api_key",
        message: "Massive is not configured on the server.",
      })),
    };
  }

  if (isMassiveVolumeCoolingDown()) {
    volumeProviderMetrics.cooldownSkips += 1;
    return {
      provider: "massive",
      snapshots: [],
      failures: tickers.map((ticker) => ({
        ticker,
        reason: "rate_limited",
        message: `Massive cooldown active for ${getMassiveVolumeCooldownRemainingMs()}ms.`,
      })),
    };
  }

  try {
    const { response, payload } = await fetchMassiveStockSnapshots(tickers);

    if (response.status === 401 || response.status === 403) {
      return {
        provider: "massive",
        snapshots: [],
        failures: tickers.map((ticker) => ({
          ticker,
          reason: "invalid_api_key",
          message: "Massive rejected the server API key for volume access.",
        })),
      };
    }

    if (response.status === 429) {
      volumeProviderMetrics.rateLimitResponses += 1;
      activateMassiveVolumeCooldown();
      return {
        provider: "massive",
        snapshots: [],
        failures: tickers.map((ticker) => ({
          ticker,
          reason: "rate_limited",
          message: "Massive rate limit hit while fetching volume data.",
        })),
      };
    }

    if (!response.ok || isMassiveErrorPayload(payload)) {
      return {
        provider: "massive",
        snapshots: [],
        failures: tickers.map((ticker) => ({
          ticker,
          reason: "upstream_error",
          message: "Massive returned an upstream error for volume data.",
        })),
      };
    }

    const normalizedSnapshots = normalizeMassiveStockSnapshots(payload);
    const quoteMap = new Map(normalizedSnapshots.map((snapshot) => [snapshot.ticker, snapshot]));
    const now = new Date();
    const minuteFrom = new Date(now.getTime() - 30 * 60_000);
    const dailyFrom = new Date(now.getTime() - 45 * 24 * 60 * 60_000);

    const [minuteResults, averageResults] = await Promise.all([
      Promise.all(
        tickers.map(async (ticker) => {
          try {
            const { response: barsResponse, payload: barsPayload } = await fetchMassiveIntradayAggregates(ticker, {
              timespan: "minute",
              from: minuteFrom.getTime(),
              to: now.getTime(),
              limit: RECENT_BAR_OUTPUT_SIZE,
            });

            if (barsResponse.status === 401 || barsResponse.status === 403) {
              return {
                ticker,
                failure: {
                  ticker,
                  reason: "invalid_api_key" as const,
                  message: "Massive rejected the server API key for intraday aggregate volume access.",
                },
              };
            }

            if (barsResponse.status === 429) {
              volumeProviderMetrics.rateLimitResponses += 1;
              activateMassiveVolumeCooldown();
              return {
                ticker,
                failure: {
                  ticker,
                  reason: "rate_limited" as const,
                  message: "Massive rate limit hit while fetching recent intraday bars.",
                },
              };
            }

            if (!barsResponse.ok || isMassiveErrorPayload(barsPayload)) {
              return {
                ticker,
                failure: {
                  ticker,
                  reason: "upstream_error" as const,
                  message: "Massive intraday aggregate data was unavailable.",
                },
              };
            }

            const recentBars = normalizeMassiveAggregateBars(barsPayload).slice(-RECENT_BAR_OUTPUT_SIZE);
            if (recentBars.length < 2) {
              return {
                ticker,
                failure: {
                  ticker,
                  reason: "upstream_error" as const,
                  message: "Massive did not return enough recent 1-minute bars.",
                },
              };
            }

            return {
              ticker,
              recentBars,
            };
          } catch (error) {
            logVolumeDataIssue("error", "provider_network_error", {
              provider: "massive",
              ticker,
              phase: "minute_aggregates",
              error: error instanceof Error ? error.message : "unknown_error",
            });

            return {
              ticker,
              failure: {
                ticker,
                reason: "network_error" as const,
                message: "Massive network request failed while fetching recent intraday bars.",
              },
            };
          }
        }),
      ),
      Promise.all(
        tickers.map(async (ticker) => {
          const cachedAverage = readAverageVolumeCache(ticker);
          if (cachedAverage !== null) {
            return {
              ticker,
              averageVolume: cachedAverage,
            };
          }

          try {
            const { response: dailyResponse, payload: dailyPayload } = await fetchMassiveIntradayAggregates(ticker, {
              timespan: "day",
              from: dailyFrom.toISOString().slice(0, 10),
              to: now.toISOString().slice(0, 10),
              limit: 30,
            });

            if (dailyResponse.status === 401 || dailyResponse.status === 403) {
              return {
                ticker,
                failure: {
                  ticker,
                  reason: "invalid_api_key" as const,
                  message: "Massive rejected the server API key for daily aggregate volume access.",
                },
              };
            }

            if (dailyResponse.status === 429) {
              volumeProviderMetrics.rateLimitResponses += 1;
              activateMassiveVolumeCooldown();
              return {
                ticker,
                failure: {
                  ticker,
                  reason: "rate_limited" as const,
                  message: "Massive rate limit hit while fetching average daily volume.",
                },
              };
            }

            if (!dailyResponse.ok || isMassiveErrorPayload(dailyPayload)) {
              return {
                ticker,
                failure: {
                  ticker,
                  reason: "upstream_error" as const,
                  message: "Massive daily aggregate data was unavailable.",
                },
              };
            }

            const bars = normalizeMassiveAggregateBars(dailyPayload);
            if (!bars.length) {
              return {
                ticker,
                failure: {
                  ticker,
                  reason: "upstream_error" as const,
                  message: "Massive did not return valid daily aggregate bars.",
                },
              };
            }

            const sample = bars.slice(-20);
            const averageVolume = sample.reduce((sum, bar) => sum + bar.volume, 0) / sample.length;
            if (!Number.isFinite(averageVolume) || averageVolume <= 0) {
              return {
                ticker,
                failure: {
                  ticker,
                  reason: "upstream_error" as const,
                  message: "Massive daily aggregate volume was incomplete.",
                },
              };
            }

            writeAverageVolumeCache(ticker, averageVolume);
            return {
              ticker,
              averageVolume,
            };
          } catch (error) {
            logVolumeDataIssue("error", "provider_network_error", {
              provider: "massive",
              ticker,
              phase: "daily_aggregates",
              error: error instanceof Error ? error.message : "unknown_error",
            });

            return {
              ticker,
              failure: {
                ticker,
                reason: "network_error" as const,
                message: "Massive network request failed while fetching average daily volume.",
              },
            };
          }
        }),
      ),
    ]);

    const minuteBarMap = new Map<string, VolumeBar[]>();
    const averageVolumeMap = new Map<string, number>();
    const failuresByTicker = new Map<string, VolumeProviderFailure>();

    for (const result of minuteResults) {
      if ("failure" in result && result.failure) {
        if (!failuresByTicker.has(result.ticker)) {
          failuresByTicker.set(result.ticker, result.failure);
        }
        continue;
      }

      minuteBarMap.set(result.ticker, result.recentBars);
    }

    for (const result of averageResults) {
      if ("failure" in result && result.failure) {
        if (!failuresByTicker.has(result.ticker)) {
          failuresByTicker.set(result.ticker, result.failure);
        }
        continue;
      }

      averageVolumeMap.set(result.ticker, result.averageVolume);
    }

    const snapshots = tickers.flatMap((ticker) => {
      const quote = quoteMap.get(ticker);
      const recentBars = minuteBarMap.get(ticker);
      const averageVolume = averageVolumeMap.get(ticker);
      const company = watchlistUniverse.find((item) => item.ticker === ticker)?.company ?? ticker;

      if (!quote || quote.currentVolume === null || !recentBars || averageVolume === undefined) {
        if (!failuresByTicker.has(ticker)) {
          failuresByTicker.set(ticker, {
            ticker,
            reason: "upstream_error",
            message: "Massive did not return all required real volume fields.",
          });
        }
        return [];
      }

      const lastUpdated = quote.timestamp || recentBars[recentBars.length - 1]?.datetime;
      if (!lastUpdated) {
        failuresByTicker.set(ticker, {
          ticker,
          reason: "upstream_error",
          message: "Massive did not return a usable volume timestamp.",
        });
        return [];
      }

      return [
        {
          ticker,
          company,
          price: quote.price,
          changePercent: quote.changePercent,
          currentVolume: quote.currentVolume,
          averageVolume,
          recentBars,
          lastUpdated,
          freshness: computeVolumeFreshness(lastUpdated),
        } satisfies VolumeSnapshot,
      ];
    });

    return {
      provider: "massive",
      snapshots,
      failures: tickers
        .filter((ticker) => !snapshots.some((snapshot) => snapshot.ticker === ticker))
        .map((ticker) => {
          return (
            failuresByTicker.get(ticker) ?? {
              ticker,
              reason: "upstream_error",
              message: "Massive volume data was incomplete.",
            }
          );
        }),
    };
  } catch (error) {
    logVolumeDataIssue("error", "provider_network_error", {
      provider: "massive",
      tickers,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return {
      provider: "massive",
      snapshots: [],
      failures: tickers.map((ticker) => ({
        ticker,
        reason: "network_error",
        message: "Massive network request failed while fetching volume data.",
      })),
    };
  }
}

async function fetchTwelveDataVolumeSnapshots(
  tickers: string[],
): Promise<{ provider: "twelve_data"; snapshots: VolumeSnapshot[]; failures: VolumeProviderFailure[] }> {
  if (!tickers.length) {
    return {
      provider: "twelve_data",
      snapshots: [],
      failures: [],
    };
  }

  const apiKey = getTwelveDataApiKey();
  if (!apiKey) {
    return {
      provider: "twelve_data",
      snapshots: [],
      failures: tickers.map((ticker) => ({
        ticker,
        reason: "missing_api_key",
        message: "Twelve Data is not configured on the server.",
      })),
    };
  }

  if (isTwelveDataVolumeCoolingDown()) {
    volumeProviderMetrics.cooldownSkips += 1;
    return {
      provider: "twelve_data",
      snapshots: [],
      failures: tickers.map((ticker) => ({
        ticker,
        reason: "rate_limited",
        message: `Twelve Data cooldown active for ${getTwelveDataVolumeCooldownRemainingMs()}ms.`,
      })),
    };
  }

  const results = await Promise.all(
    tickers.map(async (ticker) => {
      try {
        const [quoteResponse, barsResponse] = await Promise.all([
          fetch(buildTwelveDataQuoteUrl(ticker), { cache: "no-store" }),
          fetch(buildTwelveDataTimeSeriesUrl(ticker), { cache: "no-store" }),
        ]);

        if (quoteResponse.status === 401 || quoteResponse.status === 403 || barsResponse.status === 401 || barsResponse.status === 403) {
          return {
            ticker,
            failure: {
              ticker,
              reason: "invalid_api_key" as const,
              message: "Twelve Data rejected the server API key for volume access.",
            },
          };
        }

        if (quoteResponse.status === 429 || barsResponse.status === 429) {
          volumeProviderMetrics.rateLimitResponses += 1;
          activateTwelveDataVolumeCooldown();
          return {
            ticker,
            failure: {
              ticker,
              reason: "rate_limited" as const,
              message: "Twelve Data rate limit hit while fetching volume data.",
            },
          };
        }

        if (!quoteResponse.ok || !barsResponse.ok) {
          return {
            ticker,
            failure: {
              ticker,
              reason: "upstream_error" as const,
              message: "Twelve Data returned an upstream error for volume data.",
            },
          };
        }

        const quotePayload = (await quoteResponse.json()) as TwelveDataQuotePayload;
        const barsPayload = (await barsResponse.json()) as TwelveDataTimeSeriesPayload;

        if (isErrorPayload(quotePayload) || isErrorPayload(barsPayload)) {
          const code = Number.parseInt(
            String((quotePayload as { code?: unknown }).code ?? (barsPayload as { code?: unknown }).code ?? ""),
            10,
          );

          if (code === 401 || code === 403) {
            return {
              ticker,
              failure: {
                ticker,
                reason: "invalid_api_key" as const,
                message: "Twelve Data rejected the server API key for volume access.",
              },
            };
          }

          if (code === 429) {
            volumeProviderMetrics.rateLimitResponses += 1;
            activateTwelveDataVolumeCooldown();
            return {
              ticker,
              failure: {
                ticker,
                reason: "rate_limited" as const,
                message: "Twelve Data rate limit hit while fetching volume data.",
              },
            };
          }

          return {
            ticker,
            failure: {
              ticker,
              reason: "upstream_error" as const,
              message: "Twelve Data returned an error payload for volume data.",
            },
          };
        }

        const recentBars = normalizeRecentBars(barsPayload);
        if (!recentBars) {
          return {
            ticker,
            failure: {
              ticker,
              reason: "upstream_error" as const,
              message: "Twelve Data did not return valid recent OHLCV bars.",
            },
          };
        }

        const snapshot = normalizeVolumeSnapshot(ticker, quotePayload, recentBars);
        if (!snapshot) {
          return {
            ticker,
            failure: {
              ticker,
              reason: "upstream_error" as const,
              message: "Twelve Data did not return all required volume fields.",
            },
          };
        }

        return {
          ticker,
          snapshot,
        };
      } catch (error) {
        logVolumeDataIssue("error", "provider_network_error", {
          provider: "twelve_data",
          ticker,
          error: error instanceof Error ? error.message : "unknown_error",
        });

        return {
          ticker,
          failure: {
            ticker,
            reason: "network_error" as const,
            message: "Twelve Data network request failed while fetching volume data.",
          },
        };
      }
    }),
  );

  return {
    provider: "twelve_data",
    snapshots: results.flatMap((result) => ("snapshot" in result && result.snapshot ? [result.snapshot] : [])),
    failures: results.flatMap((result) => ("failure" in result && result.failure ? [result.failure] : [])),
  };
}

export function __getVolumeDataDebugState() {
  return {
    cacheTtlMs: VOLUME_CACHE_TTL_MS,
    staleAfterMs: STALE_VOLUME_WINDOW_MS,
    cooldownMs: MASSIVE_VOLUME_COOLDOWN_MS,
    massiveCooldownRemainingMs: getMassiveVolumeCooldownRemainingMs(),
    twelveDataCooldownRemainingMs: getTwelveDataVolumeCooldownRemainingMs(),
    snapshotCacheSize: volumeSnapshotCache.size,
    datasetCacheSize: volumeDatasetCache.size,
    averageVolumeCacheSize: averageVolumeCache.size,
    inFlightRequests: inFlightVolumeRequests.size,
    metrics: { ...volumeProviderMetrics },
  };
}

export function __resetVolumeDataDebugState() {
  volumeSnapshotCache.clear();
  volumeDatasetCache.clear();
  averageVolumeCache.clear();
  inFlightVolumeRequests.clear();
  volumeProviderMetrics.cooldownActivations = 0;
  volumeProviderMetrics.cooldownSkips = 0;
  volumeProviderMetrics.rateLimitResponses = 0;
  massiveVolumeCooldownUntil = 0;
  twelveDataVolumeCooldownUntil = 0;
}

export async function fetchVolumeSnapshots(
  tickers: string[],
  options?: {
    prioritizedTickers?: string[];
    fastLaneTickers?: string[];
    fastLaneCacheTtlMs?: number;
    slowLaneCacheTtlMs?: number;
    slowLaneBatchSize?: number;
  },
): Promise<VolumeDataResult> {
  const uniqueTickers = Array.from(new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)));

  if (!uniqueTickers.length) {
    return buildFailure("massive", "invalid_request", "No tickers were provided for the volume data request.", 0, [], 15_000);
  }

  const requestKey = buildVolumeRequestKey(uniqueTickers);
  const fastLaneTickers = Array.from(
    new Set(
      (options?.fastLaneTickers ?? options?.prioritizedTickers ?? [])
        .map((ticker) => ticker.trim().toUpperCase())
        .filter((ticker) => uniqueTickers.includes(ticker)),
    ),
  );
  const fastLaneSet = new Set(fastLaneTickers);
  const fastLaneCacheTtlMs = options?.fastLaneCacheTtlMs ?? FAST_LANE_VOLUME_CACHE_TTL_MS;
  const slowLaneCacheTtlMs = options?.slowLaneCacheTtlMs ?? VOLUME_CACHE_TTL_MS;
  const slowLaneBatchSize = options?.slowLaneBatchSize ?? DEFAULT_SLOW_VOLUME_REFRESH_BATCH_SIZE;
  const datasetShortTtlMs = fastLaneTickers.length > 0 ? Math.min(fastLaneCacheTtlMs, slowLaneCacheTtlMs) : slowLaneCacheTtlMs;
  const cachedDataset = getCachedDataset(uniqueTickers, { maxCacheAgeMs: datasetShortTtlMs });
  if (cachedDataset) {
    return cachedDataset;
  }

  const inFlightRequest = inFlightVolumeRequests.get(requestKey);
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const requestPromise = (async () => {
    const cachedSnapshots = getTickerSnapshotsFromCache(uniqueTickers);
    const prioritizedTickers = Array.from(
      new Set(
        (options?.prioritizedTickers ?? [])
          .map((ticker) => ticker.trim().toUpperCase())
          .filter((ticker) => uniqueTickers.includes(ticker)),
      ),
    );
    const slowLaneUniverse = prioritizeVolumeTickers(
      uniqueTickers.filter((ticker) => !fastLaneSet.has(ticker)),
      prioritizedTickers.filter((ticker) => !fastLaneSet.has(ticker)),
    );
    const rotatedSlowLane = new Set(chooseVolumeSlowLaneTickers(slowLaneUniverse, slowLaneBatchSize));
    const fastLaneRefreshes: string[] = [];
    const slowLaneMissing: string[] = [];
    const slowLaneExpired: string[] = [];

    for (const ticker of uniqueTickers) {
      const cached = readTickerCache(ticker);

      if (!cached || cached.snapshot.freshness === "stale") {
        if (fastLaneSet.has(ticker)) {
          fastLaneRefreshes.push(ticker);
        } else {
          slowLaneMissing.push(ticker);
        }
        continue;
      }

      if (fastLaneSet.has(ticker) && cached.cacheAgeMs > fastLaneCacheTtlMs) {
        fastLaneRefreshes.push(ticker);
      } else if (rotatedSlowLane.has(ticker) && cached.cacheAgeMs > slowLaneCacheTtlMs) {
        slowLaneExpired.push(ticker);
      }
    }

    const tickersToFetch = Array.from(
      new Set([...fastLaneRefreshes, ...[...slowLaneMissing, ...slowLaneExpired].slice(0, slowLaneBatchSize)]),
    );

    if (!tickersToFetch.length) {
      const cachedResult = buildSuccessResult("massive", uniqueTickers, cachedSnapshots);
      writeVolumeDatasetToCache(uniqueTickers, cachedResult);
      return cachedResult;
    }

    const massiveResult = await fetchMassiveVolumeSnapshots(tickersToFetch);

    if (
      massiveResult.failures.some((failure) => failure.reason === "rate_limited") &&
      massiveResult.snapshots.length === 0
    ) {
      const cachedFallback = tryServeLastGoodVolumeDataset(uniqueTickers);
      if (cachedFallback) {
        return cachedFallback;
      }
    }

    const unresolvedAfterMassive = tickersToFetch.filter(
      (ticker) => !massiveResult.snapshots.some((snapshot) => snapshot.ticker === ticker),
    );
    const twelveDataResult = await fetchTwelveDataVolumeSnapshots(unresolvedAfterMassive);

    const fetchedSnapshots = [...massiveResult.snapshots, ...twelveDataResult.snapshots];
    if (fetchedSnapshots.length) {
      writeVolumeSnapshotsToCache(fetchedSnapshots);
    }

    const snapshots = orderSnapshots(uniqueTickers, [...cachedSnapshots, ...fetchedSnapshots]);
    const finalFailures = tickersToFetch
      .filter((ticker) => !fetchedSnapshots.some((snapshot) => snapshot.ticker === ticker))
      .map((ticker) => {
        return (
          twelveDataResult.failures.find((failure) => failure.ticker === ticker) ??
          massiveResult.failures.find((failure) => failure.ticker === ticker) ?? {
            ticker,
            reason: "upstream_error" as const,
            message: "Real intraday volume data is currently unavailable.",
          }
        );
      });

    if (!finalFailures.length) {
      const provider: VolumeProvider = twelveDataResult.snapshots.length > 0 ? "twelve_data" : "massive";
      const successResult = buildSuccessResult(provider, uniqueTickers, snapshots);
      writeVolumeDatasetToCache(uniqueTickers, successResult);
      return successResult;
    }

    const dominantReason =
      finalFailures.find((failure) => failure.reason === "rate_limited")?.reason ??
      finalFailures.find((failure) => failure.reason === "invalid_api_key")?.reason ??
      finalFailures.find((failure) => failure.reason === "network_error")?.reason ??
      finalFailures[0]?.reason ??
      "upstream_error";

    if (dominantReason === "rate_limited") {
      const fallbackDataset = tryServeLastGoodVolumeDataset(uniqueTickers);
      if (fallbackDataset) {
        return fallbackDataset;
      }
    }

    if (!snapshots.length) {
      return buildFailure(
        twelveDataResult.failures.length > 0 ? "twelve_data" : "massive",
        dominantReason,
        finalFailures[0]?.message ?? "Real intraday volume data is currently unavailable.",
        uniqueTickers.length,
        [],
        dominantReason === "rate_limited"
          ? Math.max(getMassiveVolumeCooldownRemainingMs(), getTwelveDataVolumeCooldownRemainingMs(), DEFAULT_RETRY_AFTER_MS)
          : DEFAULT_RETRY_AFTER_MS,
      );
    }

    logVolumeDataIssue("warn", "partial_volume_data", {
      requested: uniqueTickers.length,
      fulfilled: snapshots.length,
      failed: finalFailures.length,
      primaryProvider: "massive",
      fallbackProvider: "twelve_data",
      metrics: volumeProviderMetrics,
    });

    const partialSuccessResult = buildSuccessResult(
      twelveDataResult.snapshots.length > 0 ? "twelve_data" : "massive",
      uniqueTickers,
      snapshots,
    );
    writeVolumeDatasetToCache(uniqueTickers, partialSuccessResult);
    return partialSuccessResult;
  })();

  inFlightVolumeRequests.set(requestKey, requestPromise);

  try {
    return await requestPromise;
  } finally {
    inFlightVolumeRequests.delete(requestKey);
  }
}
