"use client";

import type { Signal } from "@/lib/live-signal-engine";
import {
  formatQuoteFreshness,
  getDisplayPriceBucketLabel,
  getScannerRuleLabel,
  priceBucketTone,
  quoteFreshnessTone,
  scannerRuleTone,
} from "@/lib/utils";

type LiveCue = "New" | "Rising" | "Cooling" | "Moved up" | "Moved down" | "Back again" | "Reappearing" | "Building";

type LiveAlertRowProps = {
  signal: Signal;
  rank: number;
  liveCue?: LiveCue | null;
  recentlyChanged?: boolean;
  onClick: () => void;
};

function formatRowTime(timestamp: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function formatCompactInt(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

function formatFloat(floatShares: number | null) {
  if (!floatShares || floatShares <= 0) return "n/a";
  if (floatShares >= 1_000_000_000) return `${(floatShares / 1_000_000_000).toFixed(1)}B`;
  return `${(floatShares / 1_000_000).toFixed(1)}M`;
}

function toCountryFlag(countryCode: string) {
  if (!countryCode || countryCode.length !== 2) return "";
  return countryCode
    .toUpperCase()
    .split("")
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join("");
}

function moveTone(changePercent: number) {
  if (changePercent >= 0) return "text-emerald-300";
  return "text-rose-300";
}

export function LiveAlertRow({ signal, rank, liveCue, recentlyChanged = false, onClick }: LiveAlertRowProps) {
  const direction = signal.changePercent >= 0 ? "\u25b2" : "\u25bc";
  const priceBucketLabel = getDisplayPriceBucketLabel(signal.price, signal.priceBucketLabel);
  const scannerRuleLabel = getScannerRuleLabel(signal.price);
  const cueChip = liveCue ? (
    <span className="rounded border border-cyan-300/20 bg-cyan-300/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan-100">
      {liveCue}
    </span>
  ) : null;
  const specialTags = signal.specialTags.slice(0, 3);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full border-b border-white/10 px-3 py-2 text-left transition hover:bg-white/[0.04] ${
        recentlyChanged ? "bg-cyan-400/[0.06]" : "bg-transparent"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-400">
            <span>{formatRowTime(signal.timestamp)}</span>
            <span className={moveTone(signal.changePercent)}>{direction}</span>
            <span className="font-semibold tracking-wide text-white">{signal.ticker}</span>
            <span className="text-slate-500">#{rank}</span>
            <span className={moveTone(signal.changePercent)}>
              {signal.changePercent >= 0 ? "+" : ""}
              {signal.changePercent.toFixed(2)}%
            </span>
            <span className="text-slate-300">${signal.price.toFixed(2)}</span>
            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${priceBucketTone(signal.price)}`}>
              {priceBucketLabel}
            </span>
            <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-300">
              S{signal.finalScore}
            </span>
            <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-300">
              {signal.confidence} {signal.confidenceScore}
            </span>
            {cueChip}
          </div>

          <p className="mt-1 line-clamp-1 text-xs text-slate-200">{signal.alertSummary || signal.reason}</p>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-300">
            <span className="rounded border border-white/10 px-1.5 py-0.5">{signal.exchange}</span>
            <span className="rounded border border-white/10 px-1.5 py-0.5">
              {toCountryFlag(signal.countryCode)} {signal.countryCode}
            </span>
            <span className="rounded border border-white/10 px-1.5 py-0.5">Float {formatFloat(signal.floatShares)}</span>
            <span className="rounded border border-white/10 px-1.5 py-0.5">
              RVOL {signal.relativeVolume ? `${signal.relativeVolume.toFixed(1)}x` : "n/a"}
            </span>
            <span className="rounded border border-white/10 px-1.5 py-0.5">Vol {formatCompactInt(signal.volume)}</span>
            <span className="rounded border border-white/10 px-1.5 py-0.5">{signal.signalType}</span>
            <span className={`rounded border px-1.5 py-0.5 font-medium ${scannerRuleTone(signal.price)}`}>
              {scannerRuleLabel}
            </span>
            <span className={`rounded border px-1.5 py-0.5 ${quoteFreshnessTone(signal.quoteFreshness)}`}>
              {formatQuoteFreshness(signal.quoteFreshness)}
            </span>
            {signal.themeTags.slice(0, 2).map((tag) => (
              <span key={tag} className="rounded border border-violet-300/25 bg-violet-300/10 px-1.5 py-0.5 text-violet-100">
                {tag}
              </span>
            ))}
            {specialTags.map((tag) => (
              <span key={tag} className="rounded border border-cyan-300/25 bg-cyan-300/10 px-1.5 py-0.5 text-cyan-100">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </button>
  );
}
