"use client";

import type { FeedMarketMarkerItem } from "@/lib/feed/types";
import { formatMarketTimestamp } from "@/lib/feed/day-boundary";

type FeedCardMarketMarkerProps = {
  item: FeedMarketMarkerItem;
};

function toneClass(phase: FeedMarketMarkerItem["metadata"]["phase"]) {
  if (phase === "regular") return "border-emerald-300/25 bg-emerald-300/10 text-emerald-100";
  if (phase === "premarket") return "border-cyan-300/25 bg-cyan-300/10 text-cyan-100";
  if (phase === "after-hours") return "border-amber-300/25 bg-amber-300/10 text-amber-100";
  return "border-white/10 bg-white/[0.04] text-slate-200";
}

export function FeedCardMarketMarker({ item }: FeedCardMarketMarkerProps) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="h-px flex-1 bg-white/10" />
      <div className={`rounded-full border px-4 py-2 text-center ${toneClass(item.metadata.phase)}`}>
        <p className="text-[10px] uppercase tracking-[0.18em]">{item.metadata.label}</p>
        <p className="mt-1 text-xs">{item.metadata.detail}</p>
        <p className="mt-1 font-mono text-[10px] opacity-80">{formatMarketTimestamp(item.timestamp)}</p>
      </div>
      <div className="h-px flex-1 bg-white/10" />
    </div>
  );
}
