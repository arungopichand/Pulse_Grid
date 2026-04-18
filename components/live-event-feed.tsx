"use client";

import type { LiveEvent } from "@/lib/live-events";

type LiveEventFeedProps = {
  events: LiveEvent[];
  onSelectSymbol: (symbol: string) => void;
};

function priorityTone(priority: LiveEvent["priority"]) {
  if (priority === "high") {
    return "border-rose-300/30 bg-rose-300/10 text-rose-100";
  }

  if (priority === "medium") {
    return "border-cyan-300/25 bg-cyan-300/10 text-cyan-100";
  }

  return "border-white/10 bg-white/[0.04] text-slate-300";
}

function formatEventTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function LiveEventFeed({ events, onSelectSymbol }: LiveEventFeedProps) {
  return (
    <section className="mt-8 pb-10">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Live Tape</p>
        <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">{events.length}</span>
      </div>
      <div className="mt-4 space-y-2">
        {events.length ? events.map((event) => (
          <button
            key={event.id}
            type="button"
            onClick={() => onSelectSymbol(event.symbol)}
            className="glass-panel flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition hover:border-white/20 hover:bg-white/[0.05]"
          >
            <span className="min-w-[44px] text-[11px] font-medium text-slate-400">{formatEventTime(event.detectedAt)}</span>
            <span className="min-w-[58px] text-sm font-semibold text-white">{event.symbol}</span>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${priorityTone(event.priority)}`}>
              {event.eventType.replace("_", " ")}
            </span>
            <p className="line-clamp-1 text-sm text-slate-300">{event.summary}</p>
          </button>
        )) : (
          <p className="text-sm text-slate-400">No notable live events yet.</p>
        )}
      </div>
    </section>
  );
}
