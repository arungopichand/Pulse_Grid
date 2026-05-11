"use client";

import type { MomentumAlert } from "@/lib/active-now";
import { buildBotAlertRow } from "@/lib/alert-formatting";

type LiveAlertNowRowProps = {
  alert: MomentumAlert;
  nowMs: number;
  onClick: () => void;
};

function moveTone(changePercent: number) {
  return changePercent >= 0 ? "text-emerald-300" : "text-rose-300";
}

function labelTone(label: string) {
  if (
    label === "Halted UP" ||
    label === "Halted DOWN" ||
    label === "Possible Halt UP" ||
    label === "Possible Halt DOWN" ||
    label === "Resumption Watch" ||
    label === "PR Pending"
  ) {
    return "text-amber-100";
  }

  if (label === "PR") {
    return "text-sky-100";
  }

  if (label === "Reappearing" || label === "NHOD" || label === "NSH") {
    return "text-cyan-100";
  }

  return "text-white";
}

export function LiveAlertNowRow({ alert, nowMs, onClick }: LiveAlertNowRowProps) {
  const isFresh = nowMs <= new Date(alert.highlightUntil).getTime();
  const isFading = alert.lifecycle === "fading";
  const row = buildBotAlertRow(alert);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full px-1 py-0.5 text-left font-mono text-[13px] leading-[1.35] tracking-[0.01em] tabular-nums transition sm:px-2 ${
        isFresh ? "bg-white/[0.035]" : ""
      } ${isFading ? "opacity-60" : "opacity-100"}`}
    >
      {row.kind === "top_gainer" ? (
        <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap text-slate-300">
          <span className="shrink-0 font-semibold text-white">{row.ticker}</span>
          {row.countText ? <span className="shrink-0 text-slate-500">{row.countText}</span> : null}
          <span className="shrink-0 text-white">{row.labelText}</span>
          {row.moveText ? <span className={`shrink-0 ${moveTone(alert.changePercent)}`}>{row.moveText}</span> : null}
          {row.metadataText ? <span className="truncate text-slate-500">- {row.metadataText}</span> : null}
        </div>
      ) : row.kind === "halt" ? (
        <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap text-slate-300">
          <span className="shrink-0 text-slate-500">{row.time}</span>
          <span className="shrink-0 font-semibold text-white">{row.ticker}</span>
          {row.labelText ? <span className={`shrink-0 ${labelTone(row.labelText)}`}>{row.labelText}</span> : null}
          <span className="shrink-0 text-slate-500">|</span>
          <span className="shrink-0 text-slate-400">Volatility</span>
          <span className="shrink-0 text-slate-500">\u2192</span>
          {row.haltPriceText ? <span className="shrink-0 text-slate-300">{row.haltPriceText}</span> : null}
          {row.metadataText ? <span className="truncate text-slate-500">~ {row.metadataText}</span> : null}
        </div>
      ) : row.kind === "news" ? (
        <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap text-slate-300">
          <span className="shrink-0 font-semibold text-white">{row.ticker}</span>
          {row.priceBucket ? <span className="shrink-0 text-slate-500">{row.priceBucket}</span> : null}
          {row.headlineText ? <span className="truncate text-slate-300">- {row.headlineText}</span> : null}
          {row.metadataText ? <span className="truncate text-slate-500">~ {row.metadataText}</span> : null}
        </div>
      ) : (
        <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap">
          <span className="shrink-0 text-slate-500">{row.time}</span>
          {row.arrow ? <span className={`shrink-0 ${moveTone(alert.changePercent)}`}>{row.arrow}</span> : null}
          <span className="shrink-0 font-semibold tracking-[0.06em] text-white">{row.ticker}</span>
          {row.priceBucket ? <span className="shrink-0 text-slate-500">{row.priceBucket}</span> : null}
          {row.moveText ? <span className={`shrink-0 ${moveTone(alert.changePercent)}`}>{row.moveText}</span> : null}
          {row.countText ? <span className="shrink-0 text-slate-500">{row.countText}</span> : null}
          {row.labelText ? <span className={`shrink-0 ${labelTone(row.labelText)}`}>{row.labelText}</span> : null}
          {row.metadataText ? <span className="truncate text-slate-500">~ {row.metadataText}</span> : null}
        </div>
      )}
    </button>
  );
}
