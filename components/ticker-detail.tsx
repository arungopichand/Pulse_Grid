"use client";

import type { Signal } from "@/lib/live-signal-engine";
import type { SignalAnalysis } from "@/lib/signal-analysis";
import { formatCurrency, formatQuoteFreshness, formatTime, quoteFreshnessTone, signalTone } from "@/lib/utils";

type TickerDetailProps = {
  signal: Signal | null;
  analysis: SignalAnalysis | null;
  open: boolean;
  onClose: () => void;
};

export function TickerDetail({ signal, analysis, open, onClose }: TickerDetailProps) {
  if (!signal) return null;

  return (
    <div
      className={`fixed inset-0 z-50 transition ${open ? "pointer-events-auto" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-slate-950/70 backdrop-blur-sm transition ${open ? "opacity-100" : "opacity-0"}`}
      />

      <div
        className={`absolute inset-x-0 bottom-0 max-h-[88vh] rounded-t-[28px] border border-white/10 bg-surface-900 p-5 shadow-2xl transition duration-300 md:inset-y-0 md:right-0 md:left-auto md:w-[460px] md:rounded-none md:rounded-l-[28px] ${
          open ? "translate-y-0 md:translate-x-0" : "translate-y-full md:translate-x-full"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Detail</p>
            <div className="mt-2 flex items-center gap-3">
              <h2 className="text-3xl font-semibold text-white">{signal.ticker}</h2>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${signalTone(signal.signalType)}`}>
                {signal.signalType}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-400">{signal.company}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/5"
          >
            Close
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <DetailMetric label="Price" value={formatCurrency(signal.price)} />
          <DetailMetric label="Score" value={String(signal.score)} />
          <DetailMetric label="Confidence" value={`${signal.confidence}`} />
          <DetailMetric label="Move" value={`${signal.changePercent >= 0 ? "+" : ""}${signal.changePercent.toFixed(2)}%`} />
          <DetailMetric label="RVOL" value={signal.relativeVolume !== null ? `${signal.relativeVolume.toFixed(2)}x` : "n/a"} />
          <DetailMetric label="Sector" value={signal.sector} />
          <DetailMetric label="Float" value={signal.floatShares ? `${Math.round(signal.floatShares / 1_000_000)}M` : "n/a"} />
          <DetailMetric label="Alert Time" value={formatTime(signal.timestamp)} />
          <DetailMetric label="Quote State" value={formatQuoteFreshness(signal.quoteFreshness)} toneClass={quoteFreshnessTone(signal.quoteFreshness)} />
          <DetailMetric label="Provider" value={signal.quoteProvider} />
        </div>

        <div className="mt-6 rounded-3xl border border-white/8 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Why It Is Here</p>
          <p className="mt-3 text-base leading-7 text-slate-200">{signal.reason}</p>
        </div>

        {analysis ? (
          <div className="mt-6 rounded-3xl border border-cyan-300/15 bg-gradient-to-br from-cyan-300/10 to-transparent p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">AI Interpretation</p>
            <p className="mt-3 text-sm leading-6 text-slate-100">{analysis.summary}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <DetailMetric label="Stage" value={analysis.stage} />
              <DetailMetric label="Confidence" value={analysis.confidence} />
              <DetailMetric label="Tone" value={analysis.tone} />
            </div>
            <div className="mt-4 space-y-2">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Bull Case</p>
              <p className="text-sm leading-6 text-slate-200">{analysis.bullCase}</p>
            </div>
            <div className="mt-3 space-y-2">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Risk</p>
              <p className="text-sm leading-6 text-slate-200">{analysis.risk}</p>
            </div>
            <p className="mt-4 text-xs text-slate-400">Grounded scanner interpretation only. Not financial advice.</p>
          </div>
        ) : null}

        <div className="mt-6 rounded-3xl border border-white/8 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Tags</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[...signal.reasonBadges, ...signal.tags, ...signal.riskFlags].map((tag) => (
              <span key={tag} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200">
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-6 rounded-3xl border border-accent-blue/15 bg-gradient-to-br from-accent-blue/10 to-transparent p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Score Breakdown</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <DetailMetric label="Momentum" value={String(signal.scoreBreakdown.momentum)} />
            <DetailMetric label="Volume" value={String(signal.scoreBreakdown.volume)} />
            <DetailMetric label="Catalyst" value={String(signal.scoreBreakdown.catalyst)} />
            <DetailMetric label="Trend" value={String(signal.scoreBreakdown.trend)} />
            <DetailMetric label="Freshness Penalty" value={`-${signal.scoreBreakdown.freshnessPenalty}`} />
            <DetailMetric label="Risk Penalty" value={`-${signal.scoreBreakdown.riskPenalty}`} />
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailMetric({ label, value, toneClass }: { label: string; value: string; toneClass?: string }) {
  return (
    <div className={`rounded-2xl border bg-black/20 p-4 ${toneClass ?? "border-white/8"}`}>
      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
