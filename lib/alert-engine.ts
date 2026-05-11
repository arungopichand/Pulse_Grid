import type { MomentumEvent } from "./event-detector";

type AlertState = {
  lastAlertAt: number;
  lastPrice: number | null;
  lastVolume: number | null;
  lastChangePercent: number | null;
  lastScore: number;
  lastNewsIds: Set<string>;
};

const byTicker = new Map<string, AlertState>();
const WEAK_COOLDOWN_MS = 2 * 60_000;

export function shouldEmitEventAlert(params: {
  ticker: string;
  event: MomentumEvent;
  newsId?: string | null;
}) {
  const now = Date.now();
  const key = params.ticker.toUpperCase();
  const prev = byTicker.get(key);
  if (!prev) return true;
  const strong = params.event.score >= 85;
  if (strong) return true;

  if (params.newsId && !prev.lastNewsIds.has(params.newsId)) return true;
  if (params.event.eventType === "NHOD" && params.event.price !== null && prev.lastPrice !== null && params.event.price > prev.lastPrice) return true;
  if (
    params.event.changePercent !== null &&
    prev.lastChangePercent !== null &&
    params.event.changePercent - prev.lastChangePercent >= 10
  )
    return true;
  if (params.event.volume !== null && prev.lastVolume !== null && prev.lastVolume > 0 && params.event.volume >= prev.lastVolume * 1.5) return true;

  return now - prev.lastAlertAt >= WEAK_COOLDOWN_MS;
}

export function noteEmittedEventAlert(params: {
  ticker: string;
  event: MomentumEvent;
  newsId?: string | null;
}) {
  const key = params.ticker.toUpperCase();
  const prev = byTicker.get(key);
  const nextNewsIds = new Set(prev?.lastNewsIds ?? []);
  if (params.newsId) nextNewsIds.add(params.newsId);
  byTicker.set(key, {
    lastAlertAt: Date.now(),
    lastPrice: params.event.price,
    lastVolume: params.event.volume,
    lastChangePercent: params.event.changePercent,
    lastScore: params.event.score,
    lastNewsIds: nextNewsIds,
  });
}

export function getAlertEngineStateCount() {
  return byTicker.size;
}

