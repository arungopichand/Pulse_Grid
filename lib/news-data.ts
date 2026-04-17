export type StructuredNewsSnapshot = {
  ticker: string;
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

export type StructuredNewsResult =
  | {
      ok: true;
      snapshots: StructuredNewsSnapshot[];
      degraded: false;
      summary: {
        requested: number;
        available: number;
        unavailable: number;
        withNews: number;
        bullish: number;
        bearish: number;
      };
    }
  | {
      ok: false;
      snapshots: StructuredNewsSnapshot[];
      degraded: true;
      reason: "missing_api_key" | "invalid_api_key" | "rate_limited" | "network_error" | "upstream_error";
      message: string;
      retryAfterMs: number;
      summary: {
        requested: number;
        available: number;
        unavailable: number;
        withNews: number;
        bullish: number;
        bearish: number;
      };
    };

type CachedNewsEntry = {
  snapshot: StructuredNewsSnapshot;
  cachedAt: number;
};
type NewsFailureReason = Extract<StructuredNewsResult, { ok: false }>["reason"];

const NEWS_CACHE_TTL_MS = 5 * 60_000;
const NEWS_REFRESH_BATCH_SIZE = 4;
const NEWS_RETRY_AFTER_MS = 60_000;
const newsCache = new Map<string, CachedNewsEntry>();
let newsRefreshCursor = 0;

function getFinnhubApiKey() {
  return process.env.FINNHUB_API_KEY?.trim() ?? "";
}

function parseNumeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readKey(payload: Record<string, unknown>, key: string) {
  return payload[key];
}

function readNestedNumeric(payload: Record<string, unknown>, path: string[]) {
  let cursor: unknown = payload;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") {
      return null;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return parseNumeric(cursor);
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function getDateDaysAgoIsoDate(daysAgo: number) {
  const now = new Date();
  const date = new Date(now.getTime() - daysAgo * 24 * 60 * 60_000);
  return date.toISOString().slice(0, 10);
}

function createUnavailableSnapshot(ticker: string): StructuredNewsSnapshot {
  return {
    ticker,
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
}

function chooseTickersToRefresh(tickers: string[], batchSize: number) {
  if (tickers.length <= batchSize) {
    return [...tickers];
  }

  const start = newsRefreshCursor % tickers.length;
  const selected: string[] = [];

  for (let offset = 0; offset < batchSize; offset += 1) {
    selected.push(tickers[(start + offset) % tickers.length]);
  }

  newsRefreshCursor = (start + batchSize) % tickers.length;
  return selected;
}

function prioritizeTickers(tickers: string[], prioritizedTickers: string[]) {
  if (!prioritizedTickers.length) {
    return tickers;
  }

  const set = new Set(prioritizedTickers);
  const prioritized = tickers.filter((ticker) => set.has(ticker));
  const rest = tickers.filter((ticker) => !set.has(ticker));
  return [...prioritized, ...rest];
}

function extractSentiment(payload: Record<string, unknown>) {
  const bullishPercent =
    readNestedNumeric(payload, ["sentiment", "bullishPercent"]) ??
    readNestedNumeric(payload, ["sentiment", "bullish"]) ??
    null;
  const bearishPercent =
    readNestedNumeric(payload, ["sentiment", "bearishPercent"]) ??
    readNestedNumeric(payload, ["sentiment", "bearish"]) ??
    null;
  const companyNewsScore = readNestedNumeric(payload, ["companyNewsScore"]);
  const articlesInLastWeek = readNestedNumeric(payload, ["buzz", "articlesInLastWeek"]);

  const hasNews =
    (articlesInLastWeek !== null && articlesInLastWeek > 0) ||
    bullishPercent !== null ||
    bearishPercent !== null ||
    companyNewsScore !== null;

  let sentimentScore: number | null = null;
  if (bullishPercent !== null && bearishPercent !== null) {
    sentimentScore = bullishPercent - bearishPercent;
  } else if (companyNewsScore !== null) {
    sentimentScore = companyNewsScore;
  }

  const bullishNews =
    hasNews &&
    ((bullishPercent !== null && bearishPercent !== null && bullishPercent >= 0.55 && bullishPercent - bearishPercent >= 0.1) ||
      (sentimentScore !== null && sentimentScore >= 0.25));
  const bearishNews =
    hasNews &&
    ((bullishPercent !== null && bearishPercent !== null && bearishPercent >= 0.55 && bearishPercent - bullishPercent >= 0.1) ||
      (sentimentScore !== null && sentimentScore <= -0.25));

  return {
    hasNews,
    bullishNews,
    bearishNews,
    sentimentScore,
    bullishPercent,
    bearishPercent,
  };
}

async function fetchLatestCompanyHeadline(ticker: string, token: string) {
  try {
    const params = new URLSearchParams({
      symbol: ticker,
      from: getDateDaysAgoIsoDate(3),
      to: getTodayIsoDate(),
      token,
    });
    const response = await fetch(`https://finnhub.io/api/v1/company-news?${params.toString()}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return {
        headline: null,
        source: null,
        publishedAt: null,
      };
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload) || payload.length === 0) {
      return {
        headline: null,
        source: null,
        publishedAt: null,
      };
    }

    const latest = payload
      .filter((item) => item && typeof item === "object")
      .map((item) => item as Record<string, unknown>)
      .sort((left, right) => {
        const leftTs = parseNumeric(readKey(left, "datetime")) ?? 0;
        const rightTs = parseNumeric(readKey(right, "datetime")) ?? 0;
        return rightTs - leftTs;
      })[0];

    if (!latest) {
      return {
        headline: null,
        source: null,
        publishedAt: null,
      };
    }

    const timestampUnix = parseNumeric(readKey(latest, "datetime"));
    return {
      headline: typeof latest.headline === "string" ? latest.headline.trim() || null : null,
      source: typeof latest.source === "string" ? latest.source.trim() || null : null,
      publishedAt:
        timestampUnix && timestampUnix > 0
          ? new Date(timestampUnix * 1000).toISOString()
          : null,
    };
  } catch {
    return {
      headline: null,
      source: null,
      publishedAt: null,
    };
  }
}

async function fetchTickerNewsSnapshot(ticker: string, token: string): Promise<StructuredNewsSnapshot | null> {
  const params = new URLSearchParams({
    symbol: ticker,
    token,
  });
  const response = await fetch(`https://finnhub.io/api/v1/news-sentiment?${params.toString()}`, {
    cache: "no-store",
  });

  if (response.status === 401 || response.status === 403 || response.status === 429) {
    return null;
  }

  if (!response.ok) {
    return createUnavailableSnapshot(ticker);
  }

  const payload = (await response.json()) as unknown;
  if (!payload || typeof payload !== "object") {
    return createUnavailableSnapshot(ticker);
  }

  const sentiment = extractSentiment(payload as Record<string, unknown>);
  const headline = sentiment.hasNews ? await fetchLatestCompanyHeadline(ticker, token) : { headline: null, source: null, publishedAt: null };

  return {
    ticker,
    availability: "available",
    hasNews: sentiment.hasNews,
    bullishNews: sentiment.bullishNews,
    bearishNews: sentiment.bearishNews,
    sentimentScore: sentiment.sentimentScore,
    bullishPercent: sentiment.bullishPercent,
    bearishPercent: sentiment.bearishPercent,
    headline: headline.headline,
    source: headline.source,
    publishedAt: headline.publishedAt,
    provider: "finnhub",
  };
}

function buildSummary(snapshots: StructuredNewsSnapshot[]) {
  return {
    requested: snapshots.length,
    available: snapshots.filter((item) => item.availability === "available").length,
    unavailable: snapshots.filter((item) => item.availability === "unavailable").length,
    withNews: snapshots.filter((item) => item.hasNews).length,
    bullish: snapshots.filter((item) => item.bullishNews).length,
    bearish: snapshots.filter((item) => item.bearishNews).length,
  };
}

export async function fetchStructuredNewsSnapshots(
  tickers: string[],
  options?: { prioritizedTickers?: string[]; refreshBatchSize?: number },
): Promise<StructuredNewsResult> {
  const uniqueTickers = Array.from(new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)));
  if (!uniqueTickers.length) {
    return {
      ok: true,
      snapshots: [],
      degraded: false,
      summary: {
        requested: 0,
        available: 0,
        unavailable: 0,
        withNews: 0,
        bullish: 0,
        bearish: 0,
      },
    };
  }

  const token = getFinnhubApiKey();
  if (!token) {
    const snapshots = uniqueTickers.map((ticker) => createUnavailableSnapshot(ticker));
    return {
      ok: false,
      degraded: true,
      reason: "missing_api_key",
      message: "Structured news sentiment is unavailable because FINNHUB_API_KEY is missing.",
      retryAfterMs: NEWS_RETRY_AFTER_MS,
      snapshots,
      summary: buildSummary(snapshots),
    };
  }

  const nowMs = Date.now();
  const prioritizedTickers = options?.prioritizedTickers?.map((ticker) => ticker.trim().toUpperCase()) ?? [];
  const ordered = prioritizeTickers(uniqueTickers, prioritizedTickers);
  const refreshCandidates = ordered.filter((ticker) => {
    const cached = newsCache.get(ticker);
    return !cached || nowMs - cached.cachedAt > NEWS_CACHE_TTL_MS;
  });
  const refreshBatch = chooseTickersToRefresh(refreshCandidates, options?.refreshBatchSize ?? NEWS_REFRESH_BATCH_SIZE);

  let hardFailureReason: NewsFailureReason | null = null;
  for (const ticker of refreshBatch) {
    try {
      const snapshot = await fetchTickerNewsSnapshot(ticker, token);
      if (snapshot === null) {
        hardFailureReason = "upstream_error";
        continue;
      }
      newsCache.set(ticker, {
        snapshot,
        cachedAt: Date.now(),
      });
    } catch {
      hardFailureReason = "network_error";
    }
  }

  const snapshots = uniqueTickers.map((ticker) => {
    const cached = newsCache.get(ticker);
    return cached ? cached.snapshot : createUnavailableSnapshot(ticker);
  });
  const summary = buildSummary(snapshots);

  if (hardFailureReason && summary.available === 0) {
    return {
      ok: false,
      degraded: true,
      reason: hardFailureReason,
      message: "Structured news sentiment is temporarily unavailable from provider data.",
      retryAfterMs: NEWS_RETRY_AFTER_MS,
      snapshots,
      summary,
    };
  }

  return {
    ok: true,
    degraded: false,
    snapshots,
    summary,
  };
}
