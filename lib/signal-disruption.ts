import type { SignalRuntimeConfig } from "./signal-runtime-config";

export type DisruptionSignalType =
  | "MOMENTUM_UP"
  | "MOMENTUM_DOWN"
  | "VOLUME_SURGE"
  | "POSSIBLE_HALT_UP"
  | "POSSIBLE_HALT_DOWN"
  | "RESUMPTION_WATCH"
  | "BREAKOUT_CONTINUATION"
  | "BREAKDOWN_CONTINUATION"
  | "SPIKE";

export type DisruptionConfidence = "HIGH" | "MEDIUM" | "LOW";
export type HaltSuppressionReason =
  | "session_closed"
  | "extended_hours_disabled"
  | "stream_reconnecting"
  | "rate_limited"
  | "newly_bootstrapped"
  | "low_liquidity";

export type SignalObservationPoint = {
  timestamp: string;
  price: number;
  changePercent: number;
  currentVolume: number | null;
};

export type DisruptionDetectionInput = {
  ticker: string;
  price: number;
  changePercent: number;
  relativeVolume: number | null;
  currentVolume: number | null;
  averageVolume: number | null;
  previousChangePercent: number | null;
  previousQuoteTimestamp: string | null;
  currentQuoteTimestamp: string;
  breakoutPercent: number;
  streakCount: number;
  history: SignalObservationPoint[];
  observedAtMs: number;
  sessionStatus: "premarket" | "regular" | "after-hours" | "closed";
  lastSignalType: DisruptionSignalType | null;
  quoteFreshness: "fresh" | "cached" | "stale" | "missing";
  hasNewQuoteTick: boolean;
  isNewlyBootstrapped: boolean;
  isStreamReconnecting: boolean;
  isRateLimited: boolean;
  hasLiquidity: boolean;
  onPossibleHaltSuppressed?: (details: {
    ticker: string;
    sessionStatus: DisruptionDetectionInput["sessionStatus"];
    reasons: HaltSuppressionReason[];
    shortWindowMove: number;
    volumeRatio: number | null;
    freezeSeconds: number;
  }) => void;
  onPossibleHaltEmitted?: (details: {
    ticker: string;
    signalType: "POSSIBLE_HALT_UP" | "POSSIBLE_HALT_DOWN";
    shortWindowMove: number;
    volumeRatio: number | null;
    freezeSeconds: number;
  }) => void;
  config: SignalRuntimeConfig;
};

export type DisruptionDetectionResult = {
  signalType: DisruptionSignalType;
  confidence: DisruptionConfidence;
  confidenceScore: number;
  severityScore: number;
  reason: string;
  reasons: string[];
  sourceData: string[];
  riskFlags: string[];
  priceMovePercent: number;
  volumeRatio: number | null;
  freezeSeconds: number;
};

function roundMetric(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function computeShortWindowMove(history: SignalObservationPoint[], observedAtMs: number, momentumWindowMs: number, fallbackPrice: number) {
  const filtered = history
    .filter((point) => observedAtMs - new Date(point.timestamp).getTime() <= momentumWindowMs)
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
  const baselinePrice = filtered[0]?.price ?? fallbackPrice;
  if (baselinePrice <= 0) {
    return 0;
  }

  return ((fallbackPrice - baselinePrice) / baselinePrice) * 100;
}

function computeVolumeRatio(input: DisruptionDetectionInput) {
  if (input.relativeVolume !== null && Number.isFinite(input.relativeVolume)) {
    return input.relativeVolume;
  }

  if (input.currentVolume !== null && input.averageVolume && input.averageVolume > 0) {
    return input.currentVolume / input.averageVolume;
  }

  return null;
}

function computeBaselineVolume(history: SignalObservationPoint[], observedAtMs: number, windowSize: number) {
  const points = history
    .filter((point) => observedAtMs - new Date(point.timestamp).getTime() <= 20 * 60_000)
    .filter((point) => typeof point.currentVolume === "number" && Number.isFinite(point.currentVolume))
    .slice(-windowSize);
  if (!points.length) {
    return null;
  }

  const average = points.reduce((sum, point) => sum + (point.currentVolume ?? 0), 0) / points.length;
  return average > 0 ? average : null;
}

function confidenceFromScore(score: number): DisruptionConfidence {
  if (score >= 82) return "HIGH";
  if (score >= 66) return "MEDIUM";
  return "LOW";
}

export function detectDisruptionSignal(input: DisruptionDetectionInput): DisruptionDetectionResult | null {
  const config = input.config;
  const volumeRatio = computeVolumeRatio(input);
  const shortWindowMove = computeShortWindowMove(input.history, input.observedAtMs, config.momentumWindowMs, input.price);
  const acceleration = input.previousChangePercent === null ? 0 : input.changePercent - input.previousChangePercent;
  const baselineVolume = computeBaselineVolume(input.history, input.observedAtMs, config.volumeBaselineWindow);
  const activitySpike =
    baselineVolume && input.currentVolume && baselineVolume > 0
      ? input.currentVolume / baselineVolume
      : null;
  const quoteAgeMs = Math.max(0, input.observedAtMs - new Date(input.currentQuoteTimestamp).getTime());
  const freezeSeconds = Math.round(quoteAgeMs / 1000);
  const sessionAllowsHalt =
    input.sessionStatus === "regular" ||
    (config.allowExtendedHoursHalt &&
      (input.sessionStatus === "premarket" || input.sessionStatus === "after-hours"));
  const haltSuppressionReasons: HaltSuppressionReason[] = [];
  if (!sessionAllowsHalt) {
    if (
      (input.sessionStatus === "premarket" || input.sessionStatus === "after-hours") &&
      !config.allowExtendedHoursHalt
    ) {
      haltSuppressionReasons.push("extended_hours_disabled");
    } else {
      haltSuppressionReasons.push("session_closed");
    }
  }
  if (input.isStreamReconnecting) {
    haltSuppressionReasons.push("stream_reconnecting");
  }
  if (input.isRateLimited) {
    haltSuppressionReasons.push("rate_limited");
  }
  if (input.isNewlyBootstrapped) {
    haltSuppressionReasons.push("newly_bootstrapped");
  }
  if (!input.hasLiquidity) {
    haltSuppressionReasons.push("low_liquidity");
  }
  const haltSuppressed = haltSuppressionReasons.length > 0;
  const isResumeFromFreeze = Boolean(
    input.lastSignalType &&
    (input.lastSignalType === "POSSIBLE_HALT_UP" || input.lastSignalType === "POSSIBLE_HALT_DOWN") &&
    input.previousQuoteTimestamp &&
    input.previousQuoteTimestamp !== input.currentQuoteTimestamp &&
    quoteAgeMs <= config.staleTickThresholdMs / 2,
  );

  const minMove = config.minPriceMovePercent;
  const minVolume = config.minVolumeRatioThreshold;
  const strongUpMove = shortWindowMove >= Math.max(minMove * 2.2, 8);
  const strongDownMove = shortWindowMove <= -Math.max(minMove * 2.2, 8);
  const strongVolume = (volumeRatio ?? 0) >= Math.max(minVolume * 1.9, 3.2) || (activitySpike ?? 0) >= 2.4;

  const sourceData = ["price", "change_percent", "quote_timestamp"];
  if (volumeRatio !== null) sourceData.push("relative_volume");
  if (activitySpike !== null) sourceData.push("activity_spike");
  if (input.breakoutPercent > 0) sourceData.push("breakout_pct");

  if (isResumeFromFreeze) {
    const direction = input.changePercent >= 0 ? "upward" : "downward";
    const confidenceScore = clamp(
      62 + Math.abs(shortWindowMove) * 1.1 + (volumeRatio ?? 0) * 6 + Math.max(0, Math.abs(acceleration)) * 3,
      50,
      96,
    );
    return {
      signalType: "RESUMPTION_WATCH",
      confidence: confidenceFromScore(confidenceScore),
      confidenceScore: Math.round(confidenceScore),
      severityScore: Math.round(clamp(confidenceScore - 4, 40, 98)),
      reason: `RESUMPTION_WATCH: updates resumed after freeze with ${direction} continuation (${shortWindowMove >= 0 ? "+" : ""}${roundMetric(shortWindowMove, 2)}% in window).`,
      reasons: [
        "Prior possible-halt pattern was active and quote flow resumed.",
        `Latest move is ${shortWindowMove >= 0 ? "+" : ""}${roundMetric(shortWindowMove, 2)}% in momentum window.`,
      ],
      sourceData,
      riskFlags: ["RESUMPTION_WATCH"],
      priceMovePercent: roundMetric(shortWindowMove, 2),
      volumeRatio: volumeRatio !== null ? roundMetric(volumeRatio, 2) : null,
      freezeSeconds,
    };
  }

  const hasFreshGap = !input.hasNewQuoteTick && quoteAgeMs >= config.haltFreezeThresholdMs && input.quoteFreshness !== "fresh";
  const hasPotentialHaltPattern = hasFreshGap && strongVolume && (strongUpMove || strongDownMove);

  if (hasPotentialHaltPattern && haltSuppressed && input.onPossibleHaltSuppressed) {
    input.onPossibleHaltSuppressed({
      ticker: input.ticker,
      sessionStatus: input.sessionStatus,
      reasons: haltSuppressionReasons,
      shortWindowMove,
      volumeRatio,
      freezeSeconds,
    });
  }

  if (!haltSuppressed && hasPotentialHaltPattern) {
    const signalType: DisruptionSignalType = strongUpMove ? "POSSIBLE_HALT_UP" : "POSSIBLE_HALT_DOWN";
    const confidenceScore = clamp(
      68 +
        Math.min(22, Math.abs(shortWindowMove) * 1.3) +
        Math.min(16, (volumeRatio ?? 0) * 3) +
        Math.min(10, freezeSeconds / 12),
      62,
      99,
    );
    const directionText = strongUpMove ? "upward" : "downward";
    const volumeText = volumeRatio !== null ? `${roundMetric(volumeRatio, 1)}x` : "n/a";
    input.onPossibleHaltEmitted?.({
      ticker: input.ticker,
      signalType,
      shortWindowMove,
      volumeRatio,
      freezeSeconds,
    });
    return {
      signalType,
      confidence: confidenceFromScore(confidenceScore),
      confidenceScore: Math.round(confidenceScore),
      severityScore: Math.round(clamp(confidenceScore + 4, 70, 100)),
      reason: `${signalType}: price moved ${shortWindowMove >= 0 ? "+" : ""}${roundMetric(shortWindowMove, 2)}% in momentum window, volume ${volumeText}, then no updates for ${freezeSeconds}s.`,
      reasons: [
        `Abnormal ${directionText} move preceded the update freeze.`,
        `Quote update age is ${freezeSeconds}s while session halt-mode is active.`,
      ],
      sourceData,
      riskFlags: [signalType],
      priceMovePercent: roundMetric(shortWindowMove, 2),
      volumeRatio: volumeRatio !== null ? roundMetric(volumeRatio, 2) : null,
      freezeSeconds,
    };
  }

  const momentumUp =
    shortWindowMove >= minMove &&
    acceleration >= 0.3 &&
    (volumeRatio ?? 0) >= minVolume &&
    (input.streakCount >= 2 || input.breakoutPercent >= 0.25 || input.changePercent >= minMove + 0.8);
  const momentumDown =
    shortWindowMove <= -minMove &&
    acceleration <= -0.3 &&
    (volumeRatio ?? 0) >= minVolume &&
    (Math.abs(input.changePercent) >= minMove + 0.8 || input.streakCount >= 2);
  const breakoutContinuation =
    shortWindowMove >= minMove * 0.85 &&
    input.breakoutPercent >= 0.35 &&
    (volumeRatio ?? 0) >= minVolume &&
    input.streakCount >= 2;
  const breakdownContinuation =
    shortWindowMove <= -minMove * 0.85 &&
    acceleration <= -0.25 &&
    (volumeRatio ?? 0) >= minVolume &&
    input.streakCount >= 2;
  const volumeSurge =
    (volumeRatio ?? 0) >= Math.max(minVolume * 2.2, 3.2) &&
    Math.abs(shortWindowMove) < minMove * 1.1 &&
    (activitySpike ?? 0) >= 1.25;

  let signalType: DisruptionSignalType | null = null;
  if (breakoutContinuation) signalType = "BREAKOUT_CONTINUATION";
  if (breakdownContinuation) signalType = "BREAKDOWN_CONTINUATION";
  if (momentumUp) signalType = "MOMENTUM_UP";
  if (momentumDown) signalType = "MOMENTUM_DOWN";
  if (!signalType && volumeSurge) signalType = "VOLUME_SURGE";

  if (!signalType) {
    return null;
  }

  const confidenceScore = clamp(
    52 +
      Math.min(22, Math.abs(shortWindowMove) * 1.4) +
      Math.min(14, (volumeRatio ?? 0) * 3.8) +
      Math.min(8, Math.abs(acceleration) * 6) +
      (input.streakCount >= 2 ? 5 : 0) +
      (input.breakoutPercent >= 0.35 ? 5 : 0),
    48,
    98,
  );
  const severityScore = clamp(
    confidenceScore +
      Math.min(8, Math.max(0, Math.abs(shortWindowMove) - minMove) * 1.6),
    40,
    99,
  );

  const reasons = [
    `Move ${shortWindowMove >= 0 ? "+" : ""}${roundMetric(shortWindowMove, 2)}% in ${Math.round(config.momentumWindowMs / 60_000)}m window.`,
    `Volume ratio ${volumeRatio !== null ? `${roundMetric(volumeRatio, 2)}x` : "n/a"} with acceleration ${roundMetric(acceleration, 2)}.`,
  ];
  if (input.breakoutPercent >= 0.35) {
    reasons.push(`Breakout confirmation ${roundMetric(input.breakoutPercent, 2)}%.`);
  }

  return {
    signalType,
    confidence: confidenceFromScore(confidenceScore),
    confidenceScore: Math.round(confidenceScore),
    severityScore: Math.round(severityScore),
    reason: `${signalType}: ${reasons.join(" ")}`,
    reasons,
    sourceData,
    riskFlags: [],
    priceMovePercent: roundMetric(shortWindowMove, 2),
    volumeRatio: volumeRatio !== null ? roundMetric(volumeRatio, 2) : null,
    freezeSeconds,
  };
}
