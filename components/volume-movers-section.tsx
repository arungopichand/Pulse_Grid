"use client";

import type { VolumeMover } from "@/lib/volume-movers";
import { formatCurrency, formatQuoteFreshness, quoteFreshnessTone } from "@/lib/utils";

type VolumeMoversSectionProps = {
  items: VolumeMover[];
  message: string | null;
};

function labelTone(label: VolumeMover["label"]) {
  switch (label) {
    case "Momentum + Volume":
      return "border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
    case "Volume Surge":
      return "border-cyan-400/20 bg-cyan-400/10 text-cyan-100";
    default:
      return "border-amber-400/25 bg-amber-400/10 text-amber-100";
  }
}

export function VolumeMoversSection({ items, message }: VolumeMoversSectionProps) {
  return (
    <section>
      <div className="glass-panel p-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Volume</p>
            <h2 className="mt-1 text-lg font-semibold text-white">Confirmations</h2>
          </div>
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">{items.length}</span>
        </div>

        {items.length ? (
          <div className="mt-4 space-y-3">
            {items.map((item) => (
              <article key={item.ticker} className="rounded-3xl border border-white/10 bg-black/20 p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-white">{item.ticker}</h3>
                      <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${labelTone(item.label)}`}>{item.label}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{item.company}</p>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${quoteFreshnessTone(item.freshness)}`}>
                    {formatQuoteFreshness(item.freshness)}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <Metric label="Price" value={formatCurrency(item.price)} />
                  <Metric label="Move" value={`${item.changePercent >= 0 ? "+" : ""}${item.changePercent.toFixed(2)}%`} accent />
                  <Metric label="RVOL" value={`${item.relativeVolume.toFixed(1)}x`} />
                  <Metric label="Trend" value={item.volumeTrend} />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-3xl border border-white/8 bg-black/20 p-5 text-center">
            <p className="text-sm text-slate-300">{message ?? "No names have enough clean volume confirmation right now."}</p>
          </div>
        )}
      </div>
    </section>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${accent ? "text-emerald-300" : "text-slate-100"}`}>{value}</p>
    </div>
  );
}
