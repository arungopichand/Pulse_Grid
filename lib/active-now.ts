import type { Signal } from "./live-signal-engine";
import {
  buildAlertMetadataLine,
  buildAlertMetadataParts,
  buildWhyNowLine,
  computeAlertConfidence,
  getNotificationPriority,
  getSensitivityThresholds,
  getSeverityTier,
  type AlertLifecycleState,
  type AlertPhase,
  type AlertReasonLabel,
  type ConfidenceLabel,
  type AlertSeverityTier,
  type NotificationPriority,
  type SensitivityThresholds,
} from "./alert-reasoning";

export type MomentumAlertKind = "Momentum Alert";
export type MomentumAlertTransition =
  | "entry"
  | "continuation"
  | "halt_change"
  | "news_change";

export type MomentumAlert = {
  symbol: string;
  signalId: string;
  company: string;
  price: number;
  priceBucketLabel: string;
  changePercent: number;
  occurrenceCount: number;
  alertKind: MomentumAlertKind;
  alertLabel: AlertReasonLabel;
  phase: AlertPhase;
  severity: AlertSeverityTier;
  whyNow: string;
  metadataLine: string;
  metadataParts: string[];
  confidenceScore: number;
  confidenceLabel: ConfidenceLabel;
  detectedAt: string;
  highlightUntil: string;
  activeNowScore: number;
  relativeVolume: number | null;
  volumeBurstRatio: number;
  volume: number | null;
  dollarLiquidity: number;
  lifecycle: AlertLifecycleState;
  lastMeaningfulPushAt: string;
  transitionType: MomentumAlertTransition | null;
  notificationPriority: NotificationPriority;
  newsHeadline: string | null;
  countryCode: string;
  floatShares: number | null;
  theme: string | null;
  riskFlags: string[];
  isActiveNow: boolean;
};

export type PersistedActiveNowSymbolState = {
  lastSeenAt: string;
  lastAlertAt: string | null;
  lastAlertPrice: number | null;
  lastAlertMovePct: number | null;
  lastAlertVolume: number | null;
  lastAlertBurstRatio: number | null;
  lastAlertLiquidity: number | null;
  occurrenceCount: number;
  lastHighOfDay: number | null;
  lastLabel: AlertReasonLabel | null;
  lastPhase: AlertPhase | null;
  cooldownUntil: string | null;
  isActiveNow: boolean;
  lastMeaningfulPushAt: string | null;
  lastChangePercent: number | null;
  lastRelativeVolume: number | null;
  lastVolume: number | null;
  lastDetectedAt: string | null;
  lastNewsHeadline: string | null;
  lastHaltLabel: AlertReasonLabel | null;
};

export type PersistedActiveNowState = {
  symbols: Record<string, PersistedActiveNowSymbolState>;
};

const ENTRY_COOLDOWN_MS = 6 * 60_000;
const CONTINUATION_COOLDOWN_MS = 60 * 1000;
const REAPPEAR_WINDOW_MS = 6 * 60_000;
const STALE_WINDOW_MS = 7 * 60_000;
const FADING_WINDOW_MS = 5 * 60_000;
const ACTIVE_ALERT_MIN_ITEMS = 3;
const ACTIVE_ALERT_MAX_ITEMS = 8;
const MIN_ACCELERATION_DELTA = 0.8;
const MAX_ALERT_HIGHLIGHT_MS = 12 * 1000;
const EXPECTED_BURST_WINDOW_SHARE = 0.018;
const BREAKOUT_CONFIRMATION_PCT = 0.3;
const ENTRY_ACTIVE_MIN_MOVE = 3.5;
const ENTRY_ACTIVE_MIN_RVOL = 1.6;
const ENTRY_ACTIVE_MIN_BURST = 1.3;

function roundMetric(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function createEmptySymbolState(): PersistedActiveNowSymbolState {
  return {
    lastSeenAt: "",
    lastAlertAt: null,
    lastAlertPrice: null,
    lastAlertMovePct: null,
    lastAlertVolume: null,
    lastAlertBurstRatio: null,
    lastAlertLiquidity: null,
    occurrenceCount: 0,
    lastHighOfDay: null,
    lastLabel: null,
    lastPhase: null,
    cooldownUntil: null,
    isActiveNow: false,
    lastMeaningfulPushAt: null,
    lastChangePercent: null,
    lastRelativeVolume: null,
    lastVolume: null,
    lastDetectedAt: null,
    lastNewsHeadline: null,
    lastHaltLabel: null,
  };
}

function getPriceBucketDisplay(label: string) {
  switch (label) {
    case "Sub-$1":
      return "< $1";
    case "$1-$2":
      return "< $2";
    case "$2-$5":
      return "< $5";
    case "$5-$10":
      return "< $10";
    default:
      return label.replace("$", "$ ");
  }
}

function getDirectionalArrow(changePercent: number) {
  return changePercent >= 0 ? "\u2191" : "\u2193";
}

function getHaltLabel(signal: Signal): AlertReasonLabel | null {
  if (signal.signalType === "RESUMPTION_WATCH") return "Resumption Watch";
  if (signal.riskFlags.includes("POSSIBLE_HALT_UP")) return "Possible Halt Up";
  if (signal.riskFlags.includes("POSSIBLE_HALT_DOWN")) return "Possible Halt Down";
  if (signal.riskFlags.includes("HALTED_UP")) return "Halted Up";
  if (signal.riskFlags.includes("HALTED_DOWN")) return "Halted Down";
  if (signal.riskFlags.includes("NEWS_PENDING")) return "News Pending";
  return null;
}

function getVolumeBurstRatio(signal: Signal, previous: PersistedActiveNowSymbolState, observedAtMs: number) {
  const currentVolume = signal.currentVolume ?? signal.volume ?? 0;
  const previousVolume = previous.lastVolume ?? 0;
  const deltaVolume = Math.max(0, currentVolume - previousVolume);
  const elapsedMs = previous.lastSeenAt ? Math.max(1, observedAtMs - new Date(previous.lastSeenAt).getTime()) : 60_000;
  const expectedWindowShare = EXPECTED_BURST_WINDOW_SHARE * clamp(elapsedMs / STALE_WINDOW_MS, 0.35, 1.2);
  const expectedBurstVolume = Math.max(15_000, (signal.averageVolume ?? 0) * expectedWindowShare);

  return expectedBurstVolume > 0 ? deltaVolume / expectedBurstVolume : 0;
}

function determineEntryLabel(params: {
  haltLabel: AlertReasonLabel | null;
  newsBacked: boolean;
  reclaimedHod: boolean;
  breakoutTriggered: boolean;
  volumeBurstRatio: number;
}) {
  if (params.haltLabel) {
    return params.haltLabel;
  }

  if (params.newsBacked) {
    return "News Spike" as const;
  }

  if (params.reclaimedHod) {
    return "Reclaim Spike" as const;
  }

  if (params.breakoutTriggered) {
    return "Breakout Spike" as const;
  }

  if (params.volumeBurstRatio >= 3.2) {
    return "Volume Spike" as const;
  }

  return "Spike" as const;
}

function determineContinuationLabel(params: {
  haltLabel: AlertReasonLabel | null;
  newsBacked: boolean;
  reappearing: boolean;
  reclaimedHod: boolean;
  breakoutTriggered: boolean;
  sessionStatus: "premarket" | "regular" | "after-hours" | "closed";
  volumeBurstRatio: number;
}) {
  if (params.haltLabel) {
    return params.haltLabel;
  }

  if (params.newsBacked) {
    return "News Spike" as const;
  }

  if (params.reappearing) {
    return "Reappearing" as const;
  }

  if (params.reclaimedHod) {
    return "Reclaim Spike" as const;
  }

  if (params.breakoutTriggered) {
    return params.sessionStatus === "regular" ? ("NHOD" as const) : ("NSH" as const);
  }

  if (params.volumeBurstRatio >= 3.2) {
    return "Volume Spike" as const;
  }

  return "Spike" as const;
}

function isEntryQualified(params: {
  signal: Signal;
  entryThresholds: SensitivityThresholds;
  volumeBurstRatio: number;
  dollarLiquidity: number;
  acceleration: boolean;
  breakoutTriggered: boolean;
  newsBacked: boolean;
}) {
  return (
    Math.abs(params.signal.changePercent) >= params.entryThresholds.minMovePercent &&
    (params.signal.relativeVolume ?? 0) >= params.entryThresholds.minRelativeVolume &&
    params.volumeBurstRatio >= params.entryThresholds.minVolumeBurstRatio &&
    params.dollarLiquidity >= params.entryThresholds.minDollarLiquidity &&
    (params.breakoutTriggered || params.acceleration || params.newsBacked)
  );
}

function buildAlertRow(params: {
  signal: Signal;
  detectedAt: string;
  label: AlertReasonLabel;
  phase: AlertPhase;
  occurrenceCount: number;
  activeNowScore: number;
  volumeBurstRatio: number;
  dollarLiquidity: number;
  lifecycle: AlertLifecycleState;
  transitionType: MomentumAlertTransition | null;
  lastMeaningfulPushAt: string;
  moveDeltaPct: number;
  breakoutStrengthPct: number;
  reappearing: boolean;
  breakoutTriggered: boolean;
  reclaimedHod: boolean;
  acceleration: boolean;
  newsBacked: boolean;
}) {
  const severity = getSeverityTier({
    changePercent: params.signal.changePercent,
    relativeVolume: params.signal.relativeVolume,
    volumeBurstRatio: params.volumeBurstRatio,
    dollarLiquidity: params.dollarLiquidity,
    hasCatalyst: params.newsBacked,
  });
  const { confidenceScore, confidenceLabel } = computeAlertConfidence({
    changePercent: params.signal.changePercent,
    relativeVolume: params.signal.relativeVolume,
    volumeBurstRatio: params.volumeBurstRatio,
    dollarLiquidity: params.dollarLiquidity,
    breakout: params.breakoutTriggered,
    reclaimedHod: params.reclaimedHod,
    newsBacked: params.newsBacked,
    continuationQuality: params.moveDeltaPct >= 2 || params.reappearing,
  });
  const whyNow = buildWhyNowLine({
    volumeBurstRatio: params.volumeBurstRatio,
    relativeVolume: params.signal.relativeVolume,
    breakout: params.breakoutTriggered,
    reclaimedHod: params.reclaimedHod,
    acceleration: params.acceleration,
    volume: params.signal.currentVolume ?? params.signal.volume ?? null,
    label: params.label,
    reappearing: params.reappearing,
    newsBacked: params.newsBacked,
    moveDeltaPct: params.moveDeltaPct,
  });
  const metadataParts = buildAlertMetadataParts({
    countryCode: params.signal.countryCode,
    relativeVolume: params.signal.relativeVolume,
    volume: params.signal.currentVolume ?? params.signal.volume ?? null,
    theme: params.signal.themeTags[0] ?? null,
    floatShares: params.signal.floatShares,
    riskFlags: params.signal.riskFlags,
    headline: params.signal.news.headline,
    hasNewsMarker: params.newsBacked,
  });
  metadataParts.push(`${confidenceLabel} confidence`);
  const metadataLine = [...metadataParts, whyNow].filter(Boolean).join(" | ");
  const notificationPriority = getNotificationPriority({
    label: params.label,
    phase: params.phase,
    moveDeltaPct: roundMetric(Math.max(0, params.moveDeltaPct), 1),
    breakoutStrengthPct: roundMetric(Math.max(0, params.breakoutStrengthPct), 2),
    confidenceLabel,
  });

  return {
    symbol: params.signal.ticker,
    signalId: params.signal.id,
    company: params.signal.company,
    price: params.signal.price,
    priceBucketLabel: getPriceBucketDisplay(params.signal.priceBucketLabel),
    changePercent: params.signal.changePercent,
    occurrenceCount: params.occurrenceCount,
    alertKind: "Momentum Alert" as const,
    alertLabel: params.label,
    phase: params.phase,
    severity,
    whyNow,
    metadataLine,
    metadataParts,
    confidenceScore,
    confidenceLabel,
    detectedAt: params.detectedAt,
    highlightUntil: new Date(new Date(params.detectedAt).getTime() + MAX_ALERT_HIGHLIGHT_MS).toISOString(),
    activeNowScore: Math.round((params.activeNowScore + confidenceScore) / 2),
    relativeVolume: params.signal.relativeVolume,
    volumeBurstRatio: roundMetric(params.volumeBurstRatio, 1),
    volume: params.signal.currentVolume ?? params.signal.volume ?? null,
    dollarLiquidity: roundMetric(params.dollarLiquidity, 0),
    lifecycle: params.lifecycle,
    lastMeaningfulPushAt: params.lastMeaningfulPushAt,
    transitionType: params.transitionType,
    notificationPriority,
    newsHeadline: params.signal.news.headline,
    countryCode: params.signal.countryCode,
    floatShares: params.signal.floatShares,
    theme: params.signal.themeTags[0] ?? null,
    riskFlags: params.signal.riskFlags,
    isActiveNow: params.lifecycle !== "removed",
  } satisfies MomentumAlert;
}

export function createEmptyActiveNowState(): PersistedActiveNowState {
  return {
    symbols: {},
  };
}

export function buildLiveAlertsNow(params: {
  signals: Signal[];
  previousState: PersistedActiveNowState | undefined;
  observedAt: string;
  sessionStatus: "premarket" | "regular" | "after-hours" | "closed";
  sensitivityMode?: "conservative" | "balanced" | "active";
}) {
  const entrySensitivityMode = params.sensitivityMode === "active"
    ? "early"
    : params.sensitivityMode === "conservative"
      ? "tight"
      : "balanced";
  const entryThresholds = getSensitivityThresholds(entrySensitivityMode);
  const previousState = params.previousState ?? createEmptyActiveNowState();
  const observedAtMs = new Date(params.observedAt).getTime();
  const nextSymbols: PersistedActiveNowState["symbols"] = {};
  const alerts: MomentumAlert[] = [];

  for (const signal of params.signals) {
    const previous = previousState.symbols[signal.ticker] ?? createEmptySymbolState();
    const previousHigh = previous.lastHighOfDay ?? signal.price;
    const volumeBurstRatio = getVolumeBurstRatio(signal, previous, observedAtMs);
    const dollarLiquidity = (signal.currentVolume ?? signal.volume ?? 0) * signal.price;
    const moveDelta = signal.changePercent - (previous.lastChangePercent ?? signal.changePercent);
    const lastAlertMovePct = previous.lastAlertMovePct ?? 0;
    const moveDeltaSinceLastAlert = signal.changePercent - lastAlertMovePct;
    const reclaimedHod = signal.secondaryReasonLabel === "Reclaimed HOD";
    const acceleration = moveDelta >= MIN_ACCELERATION_DELTA;
    const breakoutStrengthPct =
      previousHigh > 0 && signal.price > previousHigh
        ? ((signal.price - previousHigh) / previousHigh) * 100
        : 0;
    const breakoutTriggered = breakoutStrengthPct >= BREAKOUT_CONFIRMATION_PCT || reclaimedHod;
    const newsBacked = Boolean(signal.news.hasNews || signal.riskFlags.includes("NEWS_PENDING"));
    const newsChanged = Boolean(signal.news.headline && signal.news.headline !== previous.lastNewsHeadline);
    const haltLabel = getHaltLabel(signal);
    const haltChanged = haltLabel !== previous.lastHaltLabel && Boolean(haltLabel || previous.lastHaltLabel);
    const timeSinceLastAlertMs = previous.lastAlertAt ? observedAtMs - new Date(previous.lastAlertAt).getTime() : Number.POSITIVE_INFINITY;
    const fastRunnerMode = Math.abs(signal.changePercent) >= 20;
    const minContinuationDelta = fastRunnerMode ? 1 : 2;
    const moveExpansion = Math.abs(moveDeltaSinceLastAlert) >= minContinuationDelta;
    const relativeVolumeExpansion = (signal.relativeVolume ?? 0) >= ((previous.lastRelativeVolume ?? 0) + 0.6);
    const volumeExpansion =
      (signal.currentVolume ?? signal.volume ?? 0) >= ((previous.lastAlertVolume ?? signal.currentVolume ?? signal.volume ?? 0) * 1.25);
    const burstExpansion = volumeBurstRatio >= ((previous.lastAlertBurstRatio ?? 0) + 0.5);
    const liquidityExpansion = dollarLiquidity >= ((previous.lastAlertLiquidity ?? 0) * 1.2);
    const volumeReacceleration = burstExpansion || relativeVolumeExpansion || volumeExpansion || liquidityExpansion;
    const reappearing = Boolean(
      previous.lastAlertAt &&
      timeSinceLastAlertMs >= REAPPEAR_WINDOW_MS &&
      Math.abs(signal.changePercent) >= Math.max(Math.abs(lastAlertMovePct) - 0.5, 4.5) &&
      ((signal.relativeVolume ?? 0) >= 2.2 || volumeBurstRatio >= 2.4) &&
      (moveExpansion || breakoutTriggered || volumeReacceleration || newsChanged)
    );
    const entryQualified = isEntryQualified({
      signal,
      entryThresholds,
      volumeBurstRatio,
      dollarLiquidity,
      acceleration,
      breakoutTriggered,
      newsBacked,
    });
    const meaningfulPushNow =
      entryQualified ||
      moveExpansion ||
      breakoutTriggered ||
      volumeReacceleration ||
      reappearing ||
      newsChanged ||
      haltChanged;
    const lastMeaningfulPushAt = meaningfulPushNow ? params.observedAt : previous.lastMeaningfulPushAt;
    const pushAgeMs = lastMeaningfulPushAt ? Math.max(0, observedAtMs - new Date(lastMeaningfulPushAt).getTime()) : Number.POSITIVE_INFINITY;
    const keepsLiveSurface =
      Math.abs(signal.changePercent) >= ENTRY_ACTIVE_MIN_MOVE &&
      ((signal.relativeVolume ?? 0) >= ENTRY_ACTIVE_MIN_RVOL || newsBacked || Boolean(haltLabel)) &&
      (volumeBurstRatio >= ENTRY_ACTIVE_MIN_BURST || breakoutTriggered || moveExpansion || newsChanged);
    const isActiveNow = pushAgeMs <= STALE_WINDOW_MS && (entryQualified || previous.isActiveNow || meaningfulPushNow) && keepsLiveSurface;
    const lifecycle: AlertLifecycleState =
      !isActiveNow
        ? "removed"
        : pushAgeMs <= 75_000
          ? "fresh"
          : pushAgeMs >= FADING_WINDOW_MS
            ? "fading"
            : "active";
    const entryCooldownExpired = !previous.lastAlertAt || timeSinceLastAlertMs >= ENTRY_COOLDOWN_MS;
    const continuationCooldownExpired = !previous.lastAlertAt || timeSinceLastAlertMs >= CONTINUATION_COOLDOWN_MS;
    const canEntryAlert =
      entryQualified &&
      entryCooldownExpired &&
      (!previous.lastAlertAt || !previous.isActiveNow || timeSinceLastAlertMs >= ENTRY_COOLDOWN_MS);
    const canContinuationAlert =
      isActiveNow &&
      previous.lastAlertAt !== null &&
      continuationCooldownExpired &&
      (moveExpansion || breakoutTriggered || volumeReacceleration || reappearing || newsChanged || haltChanged);

    let transitionType: MomentumAlertTransition | null = null;
    let phase: AlertPhase = previous.lastPhase ?? "entry";
    let occurrenceCount = previous.occurrenceCount;
    let label = previous.lastLabel ?? determineEntryLabel({
      haltLabel,
      newsBacked,
      reclaimedHod,
      breakoutTriggered,
      volumeBurstRatio,
    });
    let cooldownUntil = previous.cooldownUntil;

    if (canEntryAlert) {
      transitionType = "entry";
      phase = "entry";
      occurrenceCount += 1;
      label = determineEntryLabel({
        haltLabel,
        newsBacked,
        reclaimedHod,
        breakoutTriggered,
        volumeBurstRatio,
      });
      cooldownUntil = new Date(observedAtMs + ENTRY_COOLDOWN_MS).toISOString();
    } else if (canContinuationAlert) {
      transitionType = haltChanged
        ? "halt_change"
        : newsChanged
          ? "news_change"
          : "continuation";
      phase = "continuation";
      occurrenceCount += 1;
      label = determineContinuationLabel({
        haltLabel,
        newsBacked,
        reappearing,
        reclaimedHod,
        breakoutTriggered,
        sessionStatus: params.sessionStatus,
        volumeBurstRatio,
      });
      cooldownUntil = new Date(observedAtMs + CONTINUATION_COOLDOWN_MS).toISOString();
    }

    const nextState: PersistedActiveNowSymbolState = {
      lastSeenAt: params.observedAt,
      lastAlertAt: transitionType ? params.observedAt : previous.lastAlertAt,
      lastAlertPrice: transitionType ? signal.price : previous.lastAlertPrice,
      lastAlertMovePct: transitionType ? signal.changePercent : previous.lastAlertMovePct,
      lastAlertVolume: transitionType ? (signal.currentVolume ?? signal.volume ?? null) : previous.lastAlertVolume,
      lastAlertBurstRatio: transitionType ? volumeBurstRatio : previous.lastAlertBurstRatio,
      lastAlertLiquidity: transitionType ? dollarLiquidity : previous.lastAlertLiquidity,
      occurrenceCount,
      lastHighOfDay: Math.max(previous.lastHighOfDay ?? signal.price, signal.price),
      lastLabel: label,
      lastPhase: phase,
      cooldownUntil,
      isActiveNow,
      lastMeaningfulPushAt,
      lastChangePercent: signal.changePercent,
      lastRelativeVolume: signal.relativeVolume,
      lastVolume: signal.currentVolume ?? signal.volume ?? null,
      lastDetectedAt: transitionType ? params.observedAt : previous.lastDetectedAt,
      lastNewsHeadline: signal.news.headline,
      lastHaltLabel: haltLabel,
    };
    nextSymbols[signal.ticker] = nextState;

    if (!isActiveNow || !nextState.lastDetectedAt) {
      continue;
    }

    const confidence = computeAlertConfidence({
      changePercent: signal.changePercent,
      relativeVolume: signal.relativeVolume,
      volumeBurstRatio,
      dollarLiquidity,
      breakout: breakoutTriggered,
      reclaimedHod,
      newsBacked,
      continuationQuality: moveExpansion || reappearing,
    });
    const activeNowScore = Math.round(
      clamp(
        confidence.confidenceScore +
          (moveExpansion ? 5 : 0) +
          (breakoutTriggered ? 8 : 0) +
          (newsChanged ? 7 : 0) +
          (haltChanged ? 8 : 0),
        0,
        100,
      ),
    );

    alerts.push(
      buildAlertRow({
        signal,
        detectedAt: nextState.lastDetectedAt,
        label,
        phase,
        occurrenceCount,
        activeNowScore,
        volumeBurstRatio,
        dollarLiquidity,
        lifecycle,
        transitionType,
        lastMeaningfulPushAt: lastMeaningfulPushAt ?? nextState.lastDetectedAt,
        moveDeltaPct: roundMetric(Math.max(0, moveDeltaSinceLastAlert), 1),
        breakoutStrengthPct: roundMetric(Math.max(0, breakoutStrengthPct), 2),
        reappearing,
        breakoutTriggered,
        reclaimedHod,
        acceleration,
        newsBacked,
      }),
    );
  }

  alerts.sort((left, right) => {
    if (new Date(right.detectedAt).getTime() !== new Date(left.detectedAt).getTime()) {
      return new Date(right.detectedAt).getTime() - new Date(left.detectedAt).getTime();
    }

    if (right.transitionType && !left.transitionType) {
      return 1;
    }

    if (!right.transitionType && left.transitionType) {
      return -1;
    }

    if (right.confidenceScore !== left.confidenceScore) {
      return right.confidenceScore - left.confidenceScore;
    }

    return right.activeNowScore - left.activeNowScore;
  });

  const limitedAlerts = alerts.slice(0, Math.max(ACTIVE_ALERT_MIN_ITEMS, ACTIVE_ALERT_MAX_ITEMS));

  return {
    alerts: limitedAlerts,
    nextState: {
      symbols: nextSymbols,
    } satisfies PersistedActiveNowState,
    rules: {
      entryThresholds,
      entryCooldownMs: ENTRY_COOLDOWN_MS,
      continuationCooldownMs: CONTINUATION_COOLDOWN_MS,
      reappearWindowMs: REAPPEAR_WINDOW_MS,
      stalenessWindowMs: STALE_WINDOW_MS,
      maxItems: ACTIVE_ALERT_MAX_ITEMS,
      rowPreview: `${new Date(params.observedAt).toISOString().slice(11, 16)} ${getDirectionalArrow(12.4)} TICK < $5 +12.4% Breakout Spike`,
      metadataPreview: `${buildAlertMetadataLine({
        countryCode: "US",
        floatShares: 19_900_000,
        relativeVolume: 5.2,
        volume: 691_000,
        theme: "AI",
      })} | High confidence`,
    },
  };
}
