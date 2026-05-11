import type { MomentumAlert } from "./active-now";
import { formatCompactNumber, toCountryFlag } from "./alert-reasoning";

function roundMetric(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function compactWithSuffix(value: number | null | undefined) {
  const compact = formatCompactNumber(value);
  if (!compact) {
    return null;
  }

  return compact.replace(/([KMB])$/, " $1");
}

function formatRelativeVolume(value: number | null) {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  if (value >= 1000) {
    return `${Math.round(value).toLocaleString("en-US")}x`;
  }

  if (value >= 100) {
    return `${Math.round(value)}x`;
  }

  return `${roundMetric(value, 1)}x`;
}

function formatMovePercent(value: number) {
  const abs = Math.abs(value);
  if (abs >= 100 || Math.abs(abs - Math.round(abs)) < 0.05) {
    return `${Math.round(value)}%`;
  }

  return `${roundMetric(value, 1)}%`;
}

function formatClock(timestamp: string, withSeconds = false) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    hour12: false,
  }).format(new Date(timestamp));
}

function compactHeadline(headline: string | null, maxLength = 58) {
  if (!headline) {
    return null;
  }

  const normalized = headline.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function getVisibleLabel(label: MomentumAlert["alertLabel"]) {
  if (label === "NHOD" || label === "NSH" || label === "Reappearing" || label === "top-gainer") {
    return label;
  }

  if (
    label === "Spike" ||
    label === "Volume Spike" ||
    label === "Breakout Spike" ||
    label === "Reclaim Spike"
  ) {
    return "Spike";
  }

  if (label === "Halted Up") {
    return "Halted UP";
  }

  if (label === "Halted Down") {
    return "Halted DOWN";
  }

  if (label === "Possible Halt Up") {
    return "Possible Halt UP";
  }

  if (label === "Possible Halt Down") {
    return "Possible Halt DOWN";
  }

  if (label === "Resumption Watch") {
    return "Resumption Watch";
  }

  if (label === "News Pending") {
    return "PR Pending";
  }

  if (label === "News Spike") {
    return "PR";
  }

  return "";
}

export type BotAlertRow = {
  kind: "momentum" | "top_gainer" | "halt" | "news";
  time: string;
  arrow?: string;
  ticker: string;
  priceBucket?: string;
  moveText?: string;
  countText?: string;
  labelText?: string;
  headlineText?: string;
  haltPriceText?: string;
  metadataText?: string;
  followTickerOnly?: string;
  followDetailLine?: string;
};

export function buildBotMetadata(alert: MomentumAlert) {
  const parts: string[] = [];
  const flag = toCountryFlag(alert.countryCode);
  const floatLabel = compactWithSuffix(alert.floatShares);
  const volumeLabel = compactWithSuffix(alert.volume);
  const rvolLabel = formatRelativeVolume(alert.relativeVolume);

  if (flag) {
    parts.push(flag);
  }

  if (floatLabel) {
    parts.push(`Float: ${floatLabel}`);
  }

  if (rvolLabel) {
    parts.push(`RVol: ${rvolLabel}`);
  }

  if (volumeLabel) {
    parts.push(`Vol: ${volumeLabel}`);
  }

  if (alert.theme) {
    parts.push(`Theme: ${alert.theme}`);
  }

  if (alert.riskFlags.includes("HIGH_SHORT_INTEREST")) {
    parts.push("Reg SHO");
  }

  if (alert.riskFlags.includes("HIGH_CTB")) {
    parts.push("High CTB");
  }

  if (alert.newsHeadline) {
    parts.push("PR⬏");
  }

  return parts.join(" | ");
}

export function buildBotAlertRow(alert: MomentumAlert): BotAlertRow {
  const metadataText = buildBotMetadata(alert);
  const moveText = formatMovePercent(alert.changePercent);
  const labelText = getVisibleLabel(alert.alertLabel);
  const volumeLabel = compactWithSuffix(alert.volume);

  if (alert.alertLabel === "top-gainer") {
    return {
      kind: "top_gainer",
      time: "",
      ticker: alert.symbol,
      countText: `#${alert.occurrenceCount}`,
      labelText: "top-gainer",
      moveText: `${alert.changePercent >= 0 ? "+" : ""}${moveText}`,
      metadataText: volumeLabel ? `${Math.round(alert.volume ?? 0).toLocaleString("en-US")} vol${alert.newsHeadline ? "  ~  PR⬏" : ""}` : metadataText,
    };
  }

  if (
    alert.alertLabel === "Halted Up" ||
    alert.alertLabel === "Halted Down" ||
    alert.alertLabel === "Possible Halt Up" ||
    alert.alertLabel === "Possible Halt Down" ||
    alert.alertLabel === "Resumption Watch"
  ) {
    return {
      kind: "halt",
      time: formatClock(alert.detectedAt, true),
      ticker: alert.symbol,
      labelText,
      haltPriceText: `$${roundMetric(alert.price, alert.price >= 10 ? 2 : 3)}`,
      metadataText: volumeLabel ? `${volumeLabel} vol` : metadataText,
    };
  }

  if ((alert.alertLabel === "News Spike" || alert.alertLabel === "News Pending") && alert.newsHeadline) {
    return {
      kind: "news",
      time: "",
      ticker: alert.symbol,
      priceBucket: alert.priceBucketLabel,
      headlineText: compactHeadline(alert.newsHeadline) ?? undefined,
      metadataText,
      followTickerOnly: alert.symbol,
      followDetailLine: `${formatClock(alert.detectedAt)}  ${moveText}  ${volumeLabel ?? "n/a"} vol`,
    };
  }

  return {
    kind: "momentum",
    time: formatClock(alert.detectedAt),
    arrow: alert.changePercent >= 0 ? "\u2191" : "\u2193",
    ticker: alert.symbol,
    priceBucket: alert.priceBucketLabel,
    moveText,
    countText: `\u00b7 ${alert.occurrenceCount}`,
    labelText,
    metadataText,
  };
}
