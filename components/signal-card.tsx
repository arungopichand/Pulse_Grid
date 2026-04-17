"use client";

import type { Signal } from "@/lib/live-signal-engine";
import { formatCurrency, formatQuoteFreshness, formatTime, quoteFreshnessTone, relativeTime, signalTone } from "@/lib/utils";

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
  const primaryReasons = signal.reasonBadges.slice(0, 2);
  const toneClass =
    signal.changePercent >= 0
      ? "text-emerald-300"
      : "text-rose-300";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`glass-panel grid w-full gap-4 p-4 text-left transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.07] ${
        compact ? "md:grid-cols-[1.15fr_auto]" : "md:grid-cols-[1.1fr_0.9fr_auto]"
      } ${featured ? "border-accent-cyan/20 bg-accent-cyan/[0.06]" : ""} ${recentlyChanged ? "ring-1 ring-cyan-300/20 transition-shadow duration-700" : ""}`}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold text-white">{signal.ticker}</h3>
            {!compact ? <p className="mt-1 text-sm text-slate-400">{signal.company}</p> : null}
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${quoteFreshnessTone(signal.quoteFreshness)}`}>
            {formatQuoteFreshness(signal.quoteFreshness)}
          </span>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="space-y-2">
            <p className={`text-lg font-semibold text-slate-100 transition-colors ${recentlyChanged ? "text-cyan-100" : ""}`}>
              {formatCurrency(signal.price)}
            </p>
            <p className={`text-sm font-medium ${toneClass}`}>
              {signal.changePercent >= 0 ? "+" : ""}
              {signal.changePercent.toFixed(2)}%
            </p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${signalTone(signal.signalType)}`}>
            {signal.signalType}
          </span>
        </div>
        {primaryReasons.length ? (
          <div className="flex flex-wrap gap-2">
            {primaryReasons.map((badge) => (
              <span key={badge} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-slate-200">
                {badge}
              </span>
            ))}
            {liveCue ? (
              <span className={`rounded-full border px-3 py-1 text-[11px] font-medium ${liveCueTone(liveCue)}`}>
                {liveCue}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-2">
        <Metric label="Quality" value={`${signal.confidence}`} />
        <Metric label="Time" value={relativeTime(signal.timestamp)} />
        {!compact ? <Metric label="RVOL" value={signal.relativeVolume !== null ? `${signal.relativeVolume.toFixed(1)}x` : "n/a"} /> : null}
        {!compact ? <Metric label="Float" value={signal.floatShares ? `${Math.round(signal.floatShares / 1_000_000)}M` : "n/a"} /> : null}
      </div>

      <div className="flex items-end justify-between md:flex-col md:items-end">
        <span className="text-xs uppercase tracking-[0.2em] text-slate-500">{!compact ? formatTime(signal.timestamp) : relativeTime(signal.timestamp)}</span>
        <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">Details</span>
      </div>
    </button>
  );
}

function Metric({
  label,
  value,
  toneClass,
}: {
  label: string;
  value: string;
  toneClass?: string;
}) {
  return (
    <div className={`rounded-2xl border bg-black/20 px-3 py-2 ${toneClass ?? "border-white/8"}`}>
      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-100">{value}</p>
    </div>
  );
}
