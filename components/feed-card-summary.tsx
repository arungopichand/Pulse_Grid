"use client";

import type { FeedSummaryLineItem, FeedSummaryTableItem } from "@/lib/feed/types";
import { formatMarketTimestamp } from "@/lib/feed/day-boundary";

type FeedCardSummaryProps = {
  item: FeedSummaryLineItem | FeedSummaryTableItem;
  onSelectSymbol: (symbol: string) => void;
};

export function FeedCardSummary({ item, onSelectSymbol }: FeedCardSummaryProps) {
  if (item.type === "summary_line") {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          <span className="font-mono">{formatMarketTimestamp(item.timestamp)}</span>
          <span className="rounded border border-white/10 px-1.5 py-0.5 uppercase tracking-[0.14em] text-[10px] text-slate-300">Summary</span>
        </div>
        {item.headline ? <p className="mt-2 text-sm font-semibold text-white">{item.headline}</p> : null}
        {item.text ? <p className="mt-1 text-xs text-slate-300">{item.text}</p> : null}
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] px-4 py-4">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
        <span className="font-mono">{formatMarketTimestamp(item.timestamp)}</span>
        <span className="rounded border border-white/10 px-1.5 py-0.5 uppercase tracking-[0.14em] text-[10px] text-slate-300">Table</span>
      </div>
      {item.headline ? <p className="mt-2 text-base font-semibold text-white">{item.headline}</p> : null}
      <div className="mt-3 overflow-hidden rounded-2xl border border-white/10">
        <div className="grid grid-cols-[80px_repeat(4,minmax(0,1fr))] gap-px bg-white/10 text-[10px] uppercase tracking-[0.14em] text-slate-400">
          <div className="bg-slate-950/80 px-3 py-2">Ticker</div>
          {item.metadata.columns.map((column) => (
            <div key={column} className="bg-slate-950/80 px-3 py-2">{column}</div>
          ))}
        </div>
        {item.metadata.rows.map((row) => (
          <button
            key={row.symbol}
            type="button"
            onClick={() => onSelectSymbol(row.symbol)}
            className="grid w-full grid-cols-[80px_repeat(4,minmax(0,1fr))] gap-px bg-white/10 text-left text-xs text-slate-200 transition hover:bg-cyan-300/10"
          >
            <span className="bg-slate-950/70 px-3 py-2 font-semibold text-white">{row.symbol}</span>
            {row.values.map((value, index) => (
              <span key={`${row.symbol}-${index}`} className="bg-slate-950/70 px-3 py-2">{value}</span>
            ))}
          </button>
        ))}
      </div>
    </div>
  );
}
