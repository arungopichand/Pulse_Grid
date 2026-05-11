export type AlertReasonLabel =
  | "Spike"
  | "Volume Spike"
  | "Breakout Spike"
  | "Reclaim Spike"
  | "Reappearing"
  | "NSH"
  | "NHOD"
  | "top-gainer"
  | "Halted Up"
  | "Halted Down"
  | "Possible Halt Up"
  | "Possible Halt Down"
  | "Resumption Watch"
  | "News Pending"
  | "News Spike";

export type ConfidenceLabel = "High" | "Medium" | "Low";
export type AlertSeverityTier = "Spike" | "Strong Spike" | "Extreme Spike";
export type AlertLifecycleState = "fresh" | "active" | "fading" | "removed";
export type AlertPhase = "entry" | "continuation";
export type SensitivityMode = "tight" | "balanced" | "early";
export type NotificationPriority = "high" | "medium" | "low";
export type SoundMode = "off" | "important" | "all";

export type SensitivityThresholds = {
  minMovePercent: number;
  minRelativeVolume: number;
  minVolumeBurstRatio: number;
  minDollarLiquidity: number;
  minScore: number;
};

export type AlertClientSettings = {
  sensitivityMode: SensitivityMode;
  soundMode: SoundMode;
  browserNotifications: boolean;
  toastNotifications: boolean;
  minMovePercent: number;
  minRelativeVolume: number;
  onlySubFive: boolean;
  onlyHaltNews: boolean;
  onlyHighPriority: boolean;
};

export type MomentumAlertForFiltering = {
  changePercent: number;
  relativeVolume: number | null;
  volumeBurstRatio: number;
  dollarLiquidity: number;
  activeNowScore: number;
  price: number;
  alertLabel: AlertReasonLabel;
  notificationPriority: NotificationPriority;
};

export type AlertMetadataInput = {
  countryCode?: string | null;
  relativeVolume?: number | null;
  volume?: number | null;
  theme?: string | null;
  floatShares?: number | null;
  riskFlags?: string[];
  headline?: string | null;
  hasSecMarker?: boolean;
  hasNewsMarker?: boolean;
};

export type AlertConfidenceInput = {
  changePercent: number;
  relativeVolume: number | null;
  volumeBurstRatio: number;
  dollarLiquidity: number;
  breakout: boolean;
  reclaimedHod: boolean;
  newsBacked: boolean;
  continuationQuality: boolean;
};

const THRESHOLDS: Record<SensitivityMode, SensitivityThresholds> = {
  tight: {
    minMovePercent: 5.5,
    minRelativeVolume: 2.8,
    minVolumeBurstRatio: 2.8,
    minDollarLiquidity: 800_000,
    minScore: 78,
  },
  balanced: {
    minMovePercent: 4.5,
    minRelativeVolume: 2.2,
    minVolumeBurstRatio: 2.4,
    minDollarLiquidity: 500_000,
    minScore: 68,
  },
  early: {
    minMovePercent: 4,
    minRelativeVolume: 1.9,
    minVolumeBurstRatio: 2.1,
    minDollarLiquidity: 400_000,
    minScore: 60,
  },
};

function roundMetric(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getSensitivityThresholds(mode: SensitivityMode) {
  return THRESHOLDS[mode];
}

export function getDefaultAlertClientSettings(): AlertClientSettings {
  return {
    sensitivityMode: "balanced",
    soundMode: "important",
    browserNotifications: false,
    toastNotifications: true,
    minMovePercent: 4.5,
    minRelativeVolume: 2.2,
    onlySubFive: false,
    onlyHaltNews: false,
    onlyHighPriority: false,
  };
}

export function passesClientAlertFilters(alert: MomentumAlertForFiltering, settings: AlertClientSettings) {
  const thresholds = getSensitivityThresholds(settings.sensitivityMode);
  const minMove = Math.max(settings.minMovePercent, thresholds.minMovePercent);
  const minRelativeVolume = Math.max(settings.minRelativeVolume, thresholds.minRelativeVolume);
  const isHaltNews =
    alert.alertLabel === "Halted Up" ||
    alert.alertLabel === "Halted Down" ||
    alert.alertLabel === "Possible Halt Up" ||
    alert.alertLabel === "Possible Halt Down" ||
    alert.alertLabel === "Resumption Watch" ||
    alert.alertLabel === "News Pending" ||
    alert.alertLabel === "News Spike";

  if (settings.onlySubFive && alert.price >= 5) {
    return false;
  }

  if (settings.onlyHaltNews && !isHaltNews) {
    return false;
  }

  if (settings.onlyHighPriority && alert.notificationPriority !== "high") {
    return false;
  }

  return Math.abs(alert.changePercent) >= minMove && (alert.relativeVolume ?? 0) >= minRelativeVolume;
}

export function getSeverityTier(params: {
  changePercent: number;
  relativeVolume: number | null;
  volumeBurstRatio: number;
  dollarLiquidity: number;
  hasCatalyst: boolean;
}) {
  const score =
    (params.changePercent >= 25 ? 3 : params.changePercent >= 12 ? 2 : params.changePercent >= 6 ? 1 : 0) +
    ((params.relativeVolume ?? 0) >= 8 ? 3 : (params.relativeVolume ?? 0) >= 4 ? 2 : (params.relativeVolume ?? 0) >= 2.2 ? 1 : 0) +
    (params.volumeBurstRatio >= 5 ? 3 : params.volumeBurstRatio >= 3.2 ? 2 : params.volumeBurstRatio >= 2.4 ? 1 : 0) +
    (params.dollarLiquidity >= 5_000_000 ? 2 : params.dollarLiquidity >= 1_500_000 ? 1 : 0) +
    (params.hasCatalyst ? 1 : 0);

  if (score >= 8) {
    return "Extreme Spike" as const;
  }

  if (score >= 5) {
    return "Strong Spike" as const;
  }

  return "Spike" as const;
}

export function computeAlertConfidence(input: AlertConfidenceInput) {
  const moveScore = clamp((input.changePercent - 4.5) * 2.2, 0, 24);
  const rvolScore = clamp(((input.relativeVolume ?? 0) - 2.2) * 7.5, 0, 18);
  const burstScore = clamp((input.volumeBurstRatio - 2.4) * 8, 0, 18);
  const liquidityScore = clamp((input.dollarLiquidity - 500_000) / 125_000, 0, 16);
  const structureScore = (input.breakout ? 10 : 0) + (input.reclaimedHod ? 8 : 0);
  const catalystScore = input.newsBacked ? 9 : 0;
  const progressionScore = input.continuationQuality ? 5 : 0;
  const confidenceScore = Math.round(clamp(moveScore + rvolScore + burstScore + liquidityScore + structureScore + catalystScore + progressionScore, 22, 99));
  const confidenceLabel: ConfidenceLabel = confidenceScore >= 78 ? "High" : confidenceScore >= 58 ? "Medium" : "Low";

  return {
    confidenceScore,
    confidenceLabel,
  };
}

export function getNotificationPriority(params: {
  label: AlertReasonLabel;
  phase: AlertPhase;
  moveDeltaPct: number;
  breakoutStrengthPct: number;
  confidenceLabel: ConfidenceLabel;
}) {
  if (
    params.label === "Halted Up" ||
    params.label === "Halted Down" ||
    params.label === "Possible Halt Up" ||
    params.label === "Possible Halt Down" ||
    params.label === "Resumption Watch" ||
    params.label === "News Pending" ||
    params.label === "News Spike" ||
    params.label === "NHOD" ||
    params.label === "NSH" ||
    params.label === "Breakout Spike" ||
    params.phase === "entry"
  ) {
    return "high" as const;
  }

  if (
    params.label === "Reappearing" ||
    params.label === "Reclaim Spike" ||
    params.confidenceLabel === "High" ||
    params.moveDeltaPct >= 2 ||
    params.breakoutStrengthPct >= 0.6
  ) {
    return "medium" as const;
  }

  return "low" as const;
}

export function formatCompactNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return `${roundMetric(value / 1_000_000_000, 1)}B`;
  }

  if (absolute >= 1_000_000) {
    return `${roundMetric(value / 1_000_000, absolute >= 10_000_000 ? 0 : 1)}M`;
  }

  if (absolute >= 1_000) {
    return `${roundMetric(value / 1_000, absolute >= 100_000 ? 0 : 1)}K`;
  }

  return `${Math.round(value)}`;
}

export function toCountryFlag(countryCode: string | null | undefined) {
  if (!countryCode || countryCode.length !== 2) return null;

  return countryCode
    .toUpperCase()
    .split("")
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join("");
}

function formatFloatLabel(floatShares: number | null | undefined) {
  if (!floatShares || !Number.isFinite(floatShares) || floatShares <= 0) {
    return null;
  }

  if (floatShares >= 1_000_000_000) {
    return `${roundMetric(floatShares / 1_000_000_000, 1)}B`;
  }

  return `${roundMetric(floatShares / 1_000_000, 1)}M`;
}

function sanitizeHeadline(headline: string | null | undefined) {
  if (!headline) {
    return null;
  }

  return headline.replace(/\s+/g, " ").trim();
}

export function buildAlertMetadataParts(input: AlertMetadataInput) {
  const parts: string[] = [];
  const flag = toCountryFlag(input.countryCode);
  const floatLabel = formatFloatLabel(input.floatShares);
  const headline = sanitizeHeadline(input.headline);
  const riskFlags = input.riskFlags ?? [];

  if (flag) {
    parts.push(flag);
  }

  if (floatLabel) {
    parts.push(`Float ${floatLabel}`);
  }

  if ((input.relativeVolume ?? 0) > 0) {
    parts.push(`RVol ${roundMetric(input.relativeVolume ?? 0, 1)}x`);
  }

  const volumeLabel = formatCompactNumber(input.volume);
  if (volumeLabel) {
    parts.push(`Vol ${volumeLabel}`);
  }

  if (input.theme) {
    parts.push(`Theme ${input.theme}`);
  }

  if (riskFlags.includes("HIGH_SHORT_INTEREST")) {
    parts.push("Reg SHO");
  }

  if (riskFlags.includes("HIGH_CTB")) {
    parts.push("High CTB");
  }

  if (input.hasNewsMarker || headline) {
    parts.push("PR");
  }

  if (input.hasSecMarker) {
    parts.push("SEC");
  }

  return parts;
}

export function buildAlertMetadataLine(input: AlertMetadataInput) {
  return buildAlertMetadataParts(input).join(" | ");
}

export function buildWhyNowLine(params: {
  volumeBurstRatio: number;
  relativeVolume: number | null;
  breakout: boolean;
  reclaimedHod: boolean;
  acceleration: boolean;
  volume: number | null;
  label: AlertReasonLabel;
  reappearing: boolean;
  newsBacked: boolean;
  moveDeltaPct: number;
}) {
  const parts: string[] = [];

  if (params.reappearing) {
    parts.push("Reappearing");
  }

  if (params.newsBacked) {
    parts.push("News-backed");
  }

  if (params.reclaimedHod) {
    parts.push("Reclaimed HOD");
  } else if (params.breakout || params.label === "NHOD" || params.label === "NSH") {
    parts.push("Breakout");
  }

  if (params.moveDeltaPct >= 1) {
    parts.push(`+${roundMetric(params.moveDeltaPct, 1)}% since last`);
  }

  if (params.volumeBurstRatio >= 2.4 || params.label === "Volume Spike") {
    parts.push(`Burst ${roundMetric(params.volumeBurstRatio, 1)}x`);
  }

  if ((params.relativeVolume ?? 0) >= 2.2) {
    parts.push(`RVol ${roundMetric(params.relativeVolume ?? 0, 1)}x`);
  }

  if (params.acceleration && !parts.includes("Breakout")) {
    parts.push("Acceleration");
  }

  const volumeLabel = formatCompactNumber(params.volume);
  if (volumeLabel && parts.length < 4) {
    parts.push(`Vol ${volumeLabel}`);
  }

  return parts.slice(0, 4).join(" | ");
}

export function compareLabelPriority(label: AlertReasonLabel) {
  switch (label) {
    case "Possible Halt Up":
      return 1;
    case "Possible Halt Down":
      return 2;
    case "Resumption Watch":
      return 3;
    case "Halted Up":
      return 4;
    case "Halted Down":
      return 5;
    case "News Pending":
      return 6;
    case "News Spike":
      return 7;
    case "NHOD":
      return 8;
    case "NSH":
      return 9;
    case "Breakout Spike":
      return 10;
    case "Reclaim Spike":
      return 11;
    case "Reappearing":
      return 12;
    case "Volume Spike":
      return 13;
    case "top-gainer":
      return 14;
    default:
      return 15;
  }
}
