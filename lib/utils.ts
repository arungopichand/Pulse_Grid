import type { QuoteFreshness } from "./market-data";
import type { SignalType } from "./live-signal-engine";

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

export function formatTime(timestamp: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

export function relativeTime(timestamp: string) {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffMins = Math.max(0, Math.round(diffMs / 60000));

  if (diffMins < 1) return "just now";
  if (diffMins === 1) return "1 min ago";
  return `${diffMins} mins ago`;
}

export function signalTone(signalType: SignalType) {
  switch (signalType) {
    case "Breakout":
      return "text-accent-cyan border-accent-cyan/25 bg-accent-cyan/10";
    case "Momentum Spike":
      return "text-accent-blue border-accent-blue/25 bg-accent-blue/10";
  }
}

export function quoteFreshnessTone(freshness: QuoteFreshness | "missing") {
  switch (freshness) {
    case "fresh":
      return "border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
    case "cached":
      return "border-amber-400/25 bg-amber-400/10 text-amber-100";
    case "stale":
      return "border-rose-400/25 bg-rose-400/10 text-rose-100";
    default:
      return "border-white/10 bg-white/5 text-slate-300";
  }
}

export function formatQuoteFreshness(freshness: QuoteFreshness | "missing") {
  switch (freshness) {
    case "fresh":
      return "Fresh";
    case "cached":
      return "Cached";
    case "stale":
      return "Stale";
    default:
      return "No Quote";
  }
}
