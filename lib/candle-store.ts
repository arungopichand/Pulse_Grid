export type Candle1m = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  startTime: string;
  endTime: string;
};

const candlesByTicker = new Map<string, Candle1m[]>();
const MAX_CANDLES = 60;

function minuteBucket(iso: string) {
  return iso.slice(0, 16);
}

export function upsertCandleFromTick(params: {
  ticker: string;
  price: number;
  volumeDelta?: number | null;
  timestamp: string;
}) {
  const ticker = params.ticker.trim().toUpperCase();
  if (!ticker) return;
  const list = candlesByTicker.get(ticker) ?? [];
  const bucket = minuteBucket(params.timestamp);
  const last = list[list.length - 1];
  if (!last || minuteBucket(last.startTime) !== bucket) {
    list.push({
      open: params.price,
      high: params.price,
      low: params.price,
      close: params.price,
      volume: Math.max(0, params.volumeDelta ?? 0),
      startTime: params.timestamp,
      endTime: params.timestamp,
    });
  } else {
    last.high = Math.max(last.high, params.price);
    last.low = Math.min(last.low, params.price);
    last.close = params.price;
    last.endTime = params.timestamp;
    last.volume += Math.max(0, params.volumeDelta ?? 0);
  }
  while (list.length > MAX_CANDLES) list.shift();
  candlesByTicker.set(ticker, list);
}

export function upsertCandleFromAggregate(params: {
  ticker: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: string;
}) {
  const ticker = params.ticker.trim().toUpperCase();
  if (!ticker) return;
  const list = candlesByTicker.get(ticker) ?? [];
  list.push({
    open: params.open,
    high: params.high,
    low: params.low,
    close: params.close,
    volume: Math.max(0, params.volume),
    startTime: params.timestamp,
    endTime: params.timestamp,
  });
  while (list.length > MAX_CANDLES) list.shift();
  candlesByTicker.set(ticker, list);
}

export function getLastNCandles(ticker: string, n: number) {
  const list = candlesByTicker.get(ticker.trim().toUpperCase()) ?? [];
  return list.slice(-Math.max(1, n));
}

export function getSma(ticker: string, period: number) {
  const candles = getLastNCandles(ticker, period);
  if (candles.length < period) return null;
  const sum = candles.reduce((acc, candle) => acc + candle.close, 0);
  return sum / candles.length;
}

export function isThreeGreenBars(ticker: string, withinMinutes = 5) {
  const candles = getLastNCandles(ticker, withinMinutes);
  if (candles.length < 3) return false;
  const green = candles.filter((candle) => candle.close > candle.open);
  return green.length >= 3;
}

export function getVolumeBurst(ticker: string) {
  const candles = getLastNCandles(ticker, 6);
  if (candles.length < 2) return null;
  const last = candles[candles.length - 1];
  const prev = candles.slice(0, -1);
  const avgPrev = prev.reduce((acc, candle) => acc + candle.volume, 0) / prev.length;
  if (avgPrev <= 0) return null;
  return last.volume / avgPrev;
}

export function getPremarketHighBreak(ticker: string) {
  const candles = getLastNCandles(ticker, 60);
  if (candles.length < 2) return false;
  const last = candles[candles.length - 1];
  const priorHigh = Math.max(...candles.slice(0, -1).map((candle) => candle.high));
  return last.close > priorHigh;
}

export function getNHOD(ticker: string) {
  return getPremarketHighBreak(ticker);
}

export function getCandleCounts() {
  return [...candlesByTicker.entries()].map(([ticker, candles]) => ({ ticker, candles: candles.length }));
}

