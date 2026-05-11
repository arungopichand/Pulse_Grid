export type SymbolMemoryRecord = {
  ticker: string;
  firstSeenAt: string;
  lastSeenAt: string;
  alertCount: number;
  sessionOpenPrice: number | null;
  premarketHigh: number | null;
  highOfDay: number | null;
  lastAlertPrice: number | null;
  lastAlertVolume: number | null;
  lastAlertAt: string | null;
  lastSignalType: string | null;
  candles1m: number;
  latestNews: {
    title: string;
    articleUrl: string | null;
    publishedUtc: string | null;
  } | null;
  retainedUntil: string | null;
};

const memory = new Map<string, SymbolMemoryRecord>();

function isoNow() {
  return new Date().toISOString();
}

export function getSymbolMemory(ticker: string) {
  return memory.get(ticker.toUpperCase()) ?? null;
}

export function listSymbolMemory() {
  return [...memory.values()];
}

export function upsertSymbolMemory(params: {
  ticker: string;
  price: number | null;
  volume: number | null;
  sessionStatus: "premarket" | "regular" | "after-hours" | "closed";
  candles1m?: number;
}) {
  const ticker = params.ticker.trim().toUpperCase();
  if (!ticker) return null;
  const now = isoNow();
  const prev = memory.get(ticker);
  const sessionOpenPrice = prev?.sessionOpenPrice ?? params.price ?? null;
  const highOfDay =
    params.price !== null
      ? prev?.highOfDay !== null && prev?.highOfDay !== undefined
        ? Math.max(prev.highOfDay, params.price)
        : params.price
      : prev?.highOfDay ?? null;
  const premarketHigh =
    params.sessionStatus === "premarket" && params.price !== null
      ? prev?.premarketHigh !== null && prev?.premarketHigh !== undefined
        ? Math.max(prev.premarketHigh, params.price)
        : params.price
      : prev?.premarketHigh ?? null;

  const next: SymbolMemoryRecord = {
    ticker,
    firstSeenAt: prev?.firstSeenAt ?? now,
    lastSeenAt: now,
    alertCount: prev?.alertCount ?? 0,
    sessionOpenPrice,
    premarketHigh,
    highOfDay,
    lastAlertPrice: prev?.lastAlertPrice ?? null,
    lastAlertVolume: prev?.lastAlertVolume ?? null,
    lastAlertAt: prev?.lastAlertAt ?? null,
    lastSignalType: prev?.lastSignalType ?? null,
    candles1m: params.candles1m ?? prev?.candles1m ?? 0,
    latestNews: prev?.latestNews ?? null,
    retainedUntil: prev?.retainedUntil ?? null,
  };

  memory.set(ticker, next);
  return next;
}

export function noteSymbolAlert(params: {
  ticker: string;
  signalType: string;
  price: number | null;
  volume: number | null;
  retainedUntil: string | null;
}) {
  const ticker = params.ticker.trim().toUpperCase();
  if (!ticker) return null;
  const prev = memory.get(ticker);
  const now = isoNow();
  const next: SymbolMemoryRecord = {
    ticker,
    firstSeenAt: prev?.firstSeenAt ?? now,
    lastSeenAt: now,
    alertCount: (prev?.alertCount ?? 0) + 1,
    sessionOpenPrice: prev?.sessionOpenPrice ?? params.price ?? null,
    premarketHigh: prev?.premarketHigh ?? params.price ?? null,
    highOfDay: prev?.highOfDay ?? params.price ?? null,
    lastAlertPrice: params.price,
    lastAlertVolume: params.volume,
    lastAlertAt: now,
    lastSignalType: params.signalType,
    candles1m: prev?.candles1m ?? 0,
    latestNews: prev?.latestNews ?? null,
    retainedUntil: params.retainedUntil,
  };
  memory.set(ticker, next);
  return next;
}

export function attachSymbolNews(ticker: string, news: SymbolMemoryRecord["latestNews"]) {
  const key = ticker.trim().toUpperCase();
  const prev = memory.get(key);
  if (!prev) return;
  memory.set(key, {
    ...prev,
    latestNews: news,
    lastSeenAt: isoNow(),
  });
}

