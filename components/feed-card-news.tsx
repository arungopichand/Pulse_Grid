"use client";

import type { FeedNewsItem } from "@/lib/feed/types";
import { formatMarketTimestamp } from "@/lib/feed/day-boundary";

type FeedCardNewsProps = {
  item: FeedNewsItem;
  onSelectSymbol: (symbol: string) => void;
};

function toneClass(item: FeedNewsItem) {
  if (item.metadata.sentiment === "bullish") return "border-emerald-300/25 bg-emerald-300/10";
  if (item.metadata.sentiment === "bearish") return "border-rose-300/25 bg-rose-300/10";
  return "border-cyan-300/20 bg-cyan-300/10";
}

export function FeedCardNews({ item, onSelectSymbol }: FeedCardNewsProps) {
  return (
    <button
      type="button"
      onClick={() => item.ticker && onSelectSymbol(item.ticker)}
      className={`w-full rounded-3xl border px-4 py-4 text-left transition hover:border-white/20 hover:bg-white/[0.06] ${toneClass(item)}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
        <span className="font-mono text-slate-400">{formatMarketTimestamp(item.timestamp)}</span>
        {item.ticker ? <span className="font-semibold text-white">{item.ticker}</span> : null}
        <span className="rounded border border-white/15 px-1.5 py-0.5 uppercase tracking-[0.14em] text-[10px] text-slate-100">
          {item.metadata.eventType.replaceAll("_", " ")}
        </span>
        <span className="text-slate-400">{item.metadata.sourceLabel}</span>
      </div>
      {item.headline ? <p className="mt-2 text-base font-semibold text-white">{item.headline}</p> : null}
      {item.text ? <p className="mt-2 text-sm leading-6 text-slate-200">{item.text}</p> : null}
      {item.body ? <p className="mt-2 text-xs leading-5 text-slate-300">{item.body}</p> : null}
    </button>
  );
}
