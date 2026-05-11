"use client";

import type { LiveEvent } from "@/lib/live-events";

type LiveNewsCardProps = {
  event: LiveEvent;
  onSelectSymbol: (symbol: string) => void;
};

function formatEventTime(timestamp: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function toneClass(priority: LiveEvent["priority"]) {
  if (priority === "high") return "border-rose-300/30 bg-rose-300/10";
  if (priority === "medium") return "border-cyan-300/25 bg-cyan-300/10";
  return "border-white/10 bg-white/[0.04]";
}

export function LiveNewsCard({ event, onSelectSymbol }: LiveNewsCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelectSymbol(event.symbol)}
      className={`mx-3 my-2 w-[calc(100%-1.5rem)] rounded-xl border p-3 text-left ${toneClass(event.priority)}`}
    >
      <div className="flex items-center gap-2 text-[11px] text-slate-300">
        <span className="font-mono text-slate-400">{formatEventTime(event.detectedAt)}</span>
        <span className="font-semibold text-white">{event.symbol}</span>
        <span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-200">
          {event.eventType.replace("_", " ")}
        </span>
      </div>
      <p className="mt-1 text-sm font-medium text-white">{event.title}</p>
      <p className="mt-1 line-clamp-2 text-xs text-slate-200">{event.headline ?? event.summary}</p>
    </button>
  );
}
