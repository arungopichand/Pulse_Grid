type MassiveSnapshotBar = {
  c?: number;
  h?: number;
  l?: number;
  o?: number;
  t?: number;
  v?: number;
  vw?: number;
};

type MassiveSnapshotTicker = {
  ticker?: string;
  todaysChangePerc?: number;
  todaysChange?: number;
  updated?: number;
  lastTrade?: {
    p?: number;
    t?: number;
  };
  min?: MassiveSnapshotBar;
  day?: MassiveSnapshotBar;
  prevDay?: MassiveSnapshotBar;
};

type MassiveSnapshotResponse = {
  status?: string;
  request_id?: string;
  ticker?: MassiveSnapshotTicker;
  tickers?: MassiveSnapshotTicker[];
  error?: string;
  message?: string;
};

type MassiveAggregateBar = {
  c?: number;
  h?: number;
  l?: number;
  n?: number;
  o?: number;
  t?: number;
  v?: number;
  vw?: number;
};

type MassiveAggregateResponse = {
  status?: string;
  request_id?: string;
  ticker?: string;
  results?: MassiveAggregateBar[];
  resultsCount?: number;
  error?: string;
  message?: string;
};

export type MassiveQuoteSnapshot = {
  ticker: string;
  price: number;
  changePercent: number;
  timestamp: string;
  currentVolume: number | null;
  minuteVolume: number | null;
};

export type MassiveIntradayBar = {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MassiveIntradayMetrics = {
  ticker: string;
  bars: MassiveIntradayBar[];
  lastPrice: number | null;
  oneMinuteChangePercent: number | null;
  fiveMinuteChangePercent: number | null;
  sessionVolume: number;
  greenCandleCount: number;
  breakoutAboveRecentHigh: boolean;
  sma5: number | null;
  sma10: number | null;
  smaMomentumConfirmed: boolean;
};

const MASSIVE_BASE_URL = "https://api.massive.com";
const MASSIVE_STOCK_SNAPSHOT_PATH = "/v2/snapshot/locale/us/markets/stocks/tickers";

export function getMassiveApiKey() {
  return process.env.MASSIVE_API_KEY?.trim() ?? "";
}

function buildMassiveUrl(pathname: string, params?: Record<string, string | number | boolean | undefined>) {
  const url = new URL(pathname, MASSIVE_BASE_URL);

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }

  url.searchParams.set("apiKey", getMassiveApiKey());
  return url.toString();
}

function ensureFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function massiveTimestampToIso(timestamp: unknown) {
  const parsed = ensureFiniteNumber(timestamp);
  if (parsed === null) return null;

  const milliseconds = parsed > 9_999_999_999_999 ? Math.floor(parsed / 1_000_000) : parsed;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function deriveChangePercent(rawTicker: MassiveSnapshotTicker, price: number | null) {
  const directPercent = ensureFiniteNumber(rawTicker.todaysChangePerc);
  if (directPercent !== null) {
    return directPercent;
  }

  const todaysChange = ensureFiniteNumber(rawTicker.todaysChange);
  if (price !== null && todaysChange !== null) {
    const previousClose = price - todaysChange;
    if (Math.abs(previousClose) > 0.000001) {
      return (todaysChange / previousClose) * 100;
    }
  }

  const dayClose = ensureFiniteNumber(rawTicker.day?.c);
  const previousClose = ensureFiniteNumber(rawTicker.prevDay?.c);
  if (dayClose !== null && previousClose !== null && Math.abs(previousClose) > 0.000001) {
    return ((dayClose - previousClose) / previousClose) * 100;
  }

  return null;
}

function normalizeSnapshotTicker(rawTicker: MassiveSnapshotTicker): MassiveQuoteSnapshot | null {
  const ticker = typeof rawTicker.ticker === "string" ? rawTicker.ticker.trim().toUpperCase() : "";
  if (!ticker) {
    return null;
  }

  const lastTradePrice = ensureFiniteNumber(rawTicker.lastTrade?.p);
  const minuteClose = ensureFiniteNumber(rawTicker.min?.c);
  const dayClose = ensureFiniteNumber(rawTicker.day?.c);
  const price = lastTradePrice ?? minuteClose ?? dayClose;
  const timestamp =
    massiveTimestampToIso(rawTicker.updated) ??
    massiveTimestampToIso(rawTicker.lastTrade?.t) ??
    massiveTimestampToIso(rawTicker.min?.t) ??
    massiveTimestampToIso(rawTicker.day?.t) ??
    new Date().toISOString();
  const changePercent = deriveChangePercent(rawTicker, price);
  const currentVolume = ensureFiniteNumber(rawTicker.day?.v);
  const minuteVolume = ensureFiniteNumber(rawTicker.min?.v);

  if (price === null || changePercent === null) {
    return null;
  }

  return {
    ticker,
    price,
    changePercent,
    timestamp,
    currentVolume,
    minuteVolume,
  };
}

function normalizeAggregateBar(rawBar: MassiveAggregateBar): MassiveIntradayBar | null {
  const datetime = massiveTimestampToIso(rawBar.t);
  const open = ensureFiniteNumber(rawBar.o);
  const high = ensureFiniteNumber(rawBar.h);
  const low = ensureFiniteNumber(rawBar.l);
  const close = ensureFiniteNumber(rawBar.c);
  const volume = ensureFiniteNumber(rawBar.v);

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
  };
}

export function isMassiveErrorPayload(payload: unknown): payload is { status?: string; error?: string; message?: string } {
  if (!payload || typeof payload !== "object") return false;
  const maybePayload = payload as Record<string, unknown>;

  return (
    maybePayload.status === "ERROR" ||
    maybePayload.status === "error" ||
    typeof maybePayload.error === "string" ||
    typeof maybePayload.message === "string"
  );
}

export function buildMassiveStockSnapshotUrl(tickers: string[]) {
  return buildMassiveUrl(MASSIVE_STOCK_SNAPSHOT_PATH, {
    tickers: tickers.join(","),
  });
}

export function buildMassiveAggregateUrl(
  ticker: string,
  options: {
    multiplier: number;
    timespan: "minute" | "day" | "second";
    from: string | number;
    to: string | number;
    adjusted?: boolean;
    sort?: "asc" | "desc";
    limit?: number;
  },
) {
  const from = encodeURIComponent(String(options.from));
  const to = encodeURIComponent(String(options.to));

  return buildMassiveUrl(`/v2/aggs/ticker/${ticker}/range/${options.multiplier}/${options.timespan}/${from}/${to}`, {
    adjusted: options.adjusted ?? true,
    sort: options.sort ?? "asc",
    limit: options.limit,
  });
}

export async function fetchMassiveStockSnapshots(tickers: string[]) {
  const response = await fetch(buildMassiveStockSnapshotUrl(tickers), {
    cache: "no-store",
  });

  return {
    response,
    payload: (await response.json()) as MassiveSnapshotResponse,
  };
}

export async function fetchMassiveIntradayAggregates(
  ticker: string,
  options: {
    multiplier?: number;
    timespan?: "minute" | "day" | "second";
    from: string | number;
    to: string | number;
    adjusted?: boolean;
    sort?: "asc" | "desc";
    limit?: number;
  },
) {
  const response = await fetch(
    buildMassiveAggregateUrl(ticker, {
      multiplier: options.multiplier ?? 1,
      timespan: options.timespan ?? "minute",
      from: options.from,
      to: options.to,
      adjusted: options.adjusted ?? true,
      sort: options.sort ?? "asc",
      limit: options.limit,
    }),
    {
      cache: "no-store",
    },
  );

  return {
    response,
    payload: (await response.json()) as MassiveAggregateResponse,
  };
}

export function normalizeMassiveStockSnapshots(payload: MassiveSnapshotResponse) {
  const snapshotList = Array.isArray(payload.tickers)
    ? payload.tickers
    : payload.ticker
      ? [payload.ticker]
      : [];

  return snapshotList.map(normalizeSnapshotTicker).filter((snapshot): snapshot is MassiveQuoteSnapshot => Boolean(snapshot));
}

export function normalizeMassiveAggregateBars(payload: MassiveAggregateResponse) {
  if (!Array.isArray(payload.results)) {
    return [];
  }

  return payload.results
    .map(normalizeAggregateBar)
    .filter((bar): bar is MassiveIntradayBar => Boolean(bar))
    .sort((left, right) => new Date(left.datetime).getTime() - new Date(right.datetime).getTime());
}

function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentChange(current: number, prior: number) {
  if (!Number.isFinite(current) || !Number.isFinite(prior) || Math.abs(prior) < 0.000001) {
    return null;
  }
  return ((current - prior) / prior) * 100;
}

export function computeMassiveIntradayMetrics(ticker: string, bars: MassiveIntradayBar[]): MassiveIntradayMetrics {
  const normalizedBars = [...bars].sort((left, right) => new Date(left.datetime).getTime() - new Date(right.datetime).getTime());
  const last = normalizedBars[normalizedBars.length - 1];
  const fiveAgo = normalizedBars.length >= 6 ? normalizedBars[normalizedBars.length - 6] : null;
  const oneAgo = normalizedBars.length >= 2 ? normalizedBars[normalizedBars.length - 2] : null;
  const closes = normalizedBars.map((bar) => bar.close);
  const recent10 = normalizedBars.slice(-10);
  const prior9 = recent10.slice(0, -1);
  const recentSessionVolume = normalizedBars.reduce((sum, bar) => sum + Math.max(0, bar.volume), 0);
  const greenCandleCount = normalizedBars.slice(-8).filter((bar) => bar.close > bar.open).length;
  const previousHigh = prior9.length > 0 ? Math.max(...prior9.map((bar) => bar.high)) : null;
  const sma5 = average(closes.slice(-5));
  const sma10 = average(closes.slice(-10));
  const lastPrice = last?.close ?? null;
  const smaMomentumConfirmed =
    lastPrice !== null &&
    sma5 !== null &&
    sma10 !== null &&
    lastPrice > sma5 &&
    sma5 > sma10;

  return {
    ticker,
    bars: normalizedBars,
    lastPrice,
    oneMinuteChangePercent: last && oneAgo ? percentChange(last.close, oneAgo.close) : null,
    fiveMinuteChangePercent: last && fiveAgo ? percentChange(last.close, fiveAgo.close) : null,
    sessionVolume: recentSessionVolume,
    greenCandleCount,
    breakoutAboveRecentHigh: previousHigh !== null && last ? last.close > previousHigh : false,
    sma5,
    sma10,
    smaMomentumConfirmed,
  };
}

export async function fetchMassiveRecentIntradayForSymbols(
  tickers: string[],
  options?: { limit?: number; lookbackMinutes?: number },
) {
  const now = Date.now();
  const lookbackMinutes = Math.max(15, options?.lookbackMinutes ?? 90);
  const fromMs = now - lookbackMinutes * 60_000;
  const toMs = now;
  const limit = Math.max(30, Math.min(500, options?.limit ?? 180));

  const settled = await Promise.allSettled(
    tickers.map(async (ticker) => {
      const { response, payload } = await fetchMassiveIntradayAggregates(ticker, {
        multiplier: 1,
        timespan: "minute",
        from: fromMs,
        to: toMs,
        adjusted: true,
        sort: "asc",
        limit,
      });
      if (!response.ok || isMassiveErrorPayload(payload)) {
        return null;
      }
      const bars = normalizeMassiveAggregateBars(payload);
      if (!bars.length) return null;
      return computeMassiveIntradayMetrics(ticker, bars);
    }),
  );

  return settled
    .filter((result): result is PromiseFulfilledResult<MassiveIntradayMetrics | null> => result.status === "fulfilled")
    .map((result) => result.value)
    .filter((value): value is MassiveIntradayMetrics => Boolean(value));
}
