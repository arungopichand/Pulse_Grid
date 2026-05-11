"use client";

import type { FeedFollowupItem, FeedFilingItem, FeedHaltItem } from "@/lib/feed/types";
import { formatMarketTimestamp } from "@/lib/feed/day-boundary";

type SupportedFollowupItem = FeedFollowupItem | FeedFilingItem | FeedHaltItem;

type FeedRowFollowupProps = {
  item: SupportedFollowupItem;
  onSelectSymbol: (symbol: string) => void;
};

function toneClass(item: SupportedFollowupItem) {
  if (item.type === "halt") return "text-rose-100";
  if (item.type === "filing") return "text-amber-100";
  return "text-cyan-100";
}

export function FeedRowFollowup({ item, onSelectSymbol }: FeedRowFollowupProps) {
  const label = item.type === "signal_followup"
    ? item.metadata.eventType.replaceAll("_", " ")
    : item.type === "filing"
      ? item.metadata.filingType.replaceAll("_", " ")
      : item.metadata.haltCode;

  return (
    <button
      type="button"
      onClick={() => item.ticker && onSelectSymbol(item.ticker)}
      className="w-full pl-14 pr-0.5 py-1 text-left transition hover:bg-white/[0.02]"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm leading-5 text-slate-500">
        <span className="w-14 shrink-0 font-mono tabular-nums text-sm text-slate-700">{formatMarketTimestamp(item.timestamp)}</span>
        <span className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${toneClass(item)}`}>
          {label}
        </span>
        {item.headline ? <span className="text-slate-400">{item.headline}</span> : null}
      </div>
      {item.text && item.text !== item.headline ? <p className="mt-0.5 pl-14 text-sm leading-5 text-slate-600">{item.text}</p> : null}
    </button>
  );
}
