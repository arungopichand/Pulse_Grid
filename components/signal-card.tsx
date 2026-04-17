"use client";

import type { Signal } from "@/lib/live-signal-engine";
import { formatCurrency, formatQuoteFreshness, getSignalStageLabel, quoteFreshnessTone, signalTone } from "@/lib/utils";

type SignalCardProps = {
  signal: Signal;
  onClick: () => void;
  featured?: boolean;
  compact?: boolean;
  liveCue?: "New" | "Rising" | "Cooling" | "Moved up" | "Moved down" | null;
  recentlyChanged?: boolean;
};

function liveCueTone(liveCue: NonNullable<SignalCardProps["liveCue"]>) {
  if (liveCue === "New") {
    return "border-cyan-300/25 bg-cyan-300/10 text-cyan-100";
  }

  if (liveCue === "Rising" || liveCue === "Moved up") {
    return "border-emerald-300/25 bg-emerald-300/10 text-emerald-100";
  }

  return "border-amber-300/25 bg-amber-300/10 text-amber-100";
}

export function SignalCard({ signal, onClick, featured = false, compact = false, liveCue = null, recentlyChanged = false }: SignalCardProps) {
  const primaryReason = signal.reason;
  const stage = getSignalStageLabel({
    timestamp: signal.timestamp,
    quoteFreshness: signal.quoteFreshness,
  });
  const toneClass =
    signal.changePercent >= 0
      ? "text-emerald-300"
      : "text-rose-300";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`glass-panel w-full rounded-3xl p-5 text-left transition duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.06] ${
        featured ? "border-accent-cyan/20 bg-accent-cyan/[0.06]" : ""
      } ${recentlyChanged ? "ring-1 ring-cyan-300/20" : ""}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-2xl font-semibold tracking-tight text-white">{signal.ticker}</h3>
          {!compact ? <p className="mt-1 text-sm text-slate-400">{signal.company}</p> : null}
        </div>
        <div className="text-right">
          <p className="text-xl font-semibold text-white">{formatCurrency(signal.price)}</p>
          <p className={`mt-1 text-sm font-medium ${toneClass}`}>
            {signal.changePercent >= 0 ? "+" : ""}
            {signal.changePercent.toFixed(2)}%
          </p>
        </div>
      </div>

      <p className="mt-3 line-clamp-1 text-sm text-slate-300">{primaryReason}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${signalTone(signal.signalType)}`}>
          {signal.signalType}
        </span>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-200">
          {signal.confidence}
        </span>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-200">
          {stage}
        </span>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${quoteFreshnessTone(signal.quoteFreshness)}`}>
          {formatQuoteFreshness(signal.quoteFreshness)}
        </span>
        {liveCue ? (
          <span className={`rounded-full border px-3 py-1 text-xs font-medium ${liveCueTone(liveCue)}`}>
            {liveCue}
          </span>
        ) : null}
      </div>
    </button>
  );
}
