import { getNHOD, getPremarketHighBreak, getVolumeBurst, isThreeGreenBars } from "./candle-store";

export type MomentumEventType =
  | "FIRST_SCAN"
  | "NHOD"
  | "PREMARKET_HIGH_BREAK"
  | "VOLUME_BURST"
  | "THREE_GREEN_BARS"
  | "NEWS_SPIKE"
  | "CONTINUATION";

export type MomentumEvent = {
  ticker: string;
  eventType: MomentumEventType;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  relativeVolume: number | null;
  score: number;
  reason: string;
};

export function detectMomentumEvents(params: {
  ticker: string;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  relativeVolume: number | null;
  hasNews: boolean;
  isFirstSeen: boolean;
}) {
  const events: MomentumEvent[] = [];
  const ticker = params.ticker.toUpperCase();
  if (params.isFirstSeen) {
    events.push({
      ticker,
      eventType: "FIRST_SCAN",
      price: params.price,
      changePercent: params.changePercent,
      volume: params.volume,
      relativeVolume: params.relativeVolume,
      score: 50,
      reason: "First scanner observation.",
    });
  }
  if (getNHOD(ticker)) {
    events.push({
      ticker,
      eventType: "NHOD",
      price: params.price,
      changePercent: params.changePercent,
      volume: params.volume,
      relativeVolume: params.relativeVolume,
      score: 80,
      reason: "New high of day transition from live candles.",
    });
  }
  if (getPremarketHighBreak(ticker)) {
    events.push({
      ticker,
      eventType: "PREMARKET_HIGH_BREAK",
      price: params.price,
      changePercent: params.changePercent,
      volume: params.volume,
      relativeVolume: params.relativeVolume,
      score: 75,
      reason: "Premarket/session high breakout.",
    });
  }
  const volumeBurst = getVolumeBurst(ticker);
  if (volumeBurst !== null && volumeBurst >= 1.5) {
    events.push({
      ticker,
      eventType: "VOLUME_BURST",
      price: params.price,
      changePercent: params.changePercent,
      volume: params.volume,
      relativeVolume: params.relativeVolume,
      score: volumeBurst >= 3 ? 90 : 70,
      reason: `1m volume burst ratio ${volumeBurst.toFixed(2)}x.`,
    });
  }
  if (isThreeGreenBars(ticker, 5)) {
    events.push({
      ticker,
      eventType: "THREE_GREEN_BARS",
      price: params.price,
      changePercent: params.changePercent,
      volume: params.volume,
      relativeVolume: params.relativeVolume,
      score: 72,
      reason: "At least three green 1m bars in the recent window.",
    });
  }
  if (params.hasNews) {
    events.push({
      ticker,
      eventType: "NEWS_SPIKE",
      price: params.price,
      changePercent: params.changePercent,
      volume: params.volume,
      relativeVolume: params.relativeVolume,
      score: 78,
      reason: "Fresh related news detected.",
    });
  }
  if ((params.changePercent ?? 0) >= 10) {
    events.push({
      ticker,
      eventType: "CONTINUATION",
      price: params.price,
      changePercent: params.changePercent,
      volume: params.volume,
      relativeVolume: params.relativeVolume,
      score: 74,
      reason: "Continuation strength detected.",
    });
  }

  return events;
}

