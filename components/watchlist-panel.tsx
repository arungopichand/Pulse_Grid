"use client";

import type { WatchlistQuote } from "@/lib/live-signal-engine";
import { formatCurrency, formatQuoteFreshness, quoteFreshnessTone, signalTone } from "@/lib/utils";

type WatchlistPanelProps = {
  items: WatchlistQuote[];
  selectedTicker?: string;
  onSelect: (ticker: string) => void;
};

export function WatchlistPanel({ items, selectedTicker, onSelect }: WatchlistPanelProps) {
  return (
    <aside className="glass-panel h-fit p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Bench</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Watching</h2>
        </div>
        <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">{items.length}</span>
      </div>

      <div className="space-y-3">
        {items.map((item) => {
          const selected = selectedTicker === item.ticker;
          return (
            <button
              key={item.ticker}
              type="button"
              onClick={() => onSelect(item.ticker)}
              className={`w-full rounded-2xl border p-3 text-left transition ${
                selected
                  ? "border-accent-cyan/30 bg-accent-cyan/10"
                  : "border-white/8 bg-black/20 hover:border-white/15 hover:bg-white/5"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-white">{item.ticker}</p>
                  <p className="text-xs text-slate-400">{item.company}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-100">{item.price === null ? "--" : formatCurrency(item.price)}</p>
                  <span className={`block text-xs ${item.changePercent !== null && item.changePercent >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                    {item.changePercent === null
                      ? "No quote"
                      : `${item.changePercent >= 0 ? "+" : ""}${item.changePercent.toFixed(2)}%`}
                  </span>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${quoteFreshnessTone(item.freshness)}`}>
                    {formatQuoteFreshness(item.freshness)}
                  </span>
                  {item.activeSignalType ? (
                    <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${signalTone(item.activeSignalType)}`}>
                      {item.activeSignalType}
                    </span>
                  ) : null}
                </div>
                {item.scannerScore ? <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{item.scannerScore}</span> : null}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
