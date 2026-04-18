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
          <DetailMetric label="Score" value={String(signal.finalScore)} />
          <DetailMetric label="Confidence" value={`${signal.confidence} (${signal.confidenceScore})`} />
          <DetailMetric label="Move" value={`${signal.changePercent >= 0 ? "+" : ""}${signal.changePercent.toFixed(2)}%`} />
          <DetailMetric label="RVOL" value={signal.relativeVolume !== null ? `${signal.relativeVolume.toFixed(2)}x` : "n/a"} />
          <DetailMetric label="Alert Time" value={formatTime(signal.timestamp)} />
          <DetailMetric label="Quote State" value={formatQuoteFreshness(signal.quoteFreshness)} toneClass={quoteFreshnessTone(signal.quoteFreshness)} />
          {signal.reappearance.label ? <DetailMetric label="Reappearance" value={signal.reappearance.label} /> : null}
        </div>

        <div className="mt-6 rounded-3xl border border-white/8 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Why It Is Here</p>
          <p className="mt-3 text-base leading-7 text-slate-200">{signal.reason}</p>
          {signal.reasons.length > 0 ? (
            <div className="mt-3 space-y-2">
              {signal.reasons.slice(0, 3).map((line) => (
                <p key={line} className="text-xs leading-5 text-slate-300/90">{line}</p>
              ))}
            </div>
          ) : null}
        </div>

        {signal.news.hasNews || signal.news.availability === "unavailable" ? (
          <div className="mt-6 rounded-3xl border border-white/8 bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">News Context</p>
            {signal.news.hasNews ? (
              <>
                <p className="mt-3 text-sm leading-6 text-slate-200">
                  {signal.news.bullishNews ? "Structured bullish news detected." : signal.news.bearishNews ? "Structured bearish news detected." : "Structured news exists without directional edge."}
                </p>
                {signal.news.headline ? <p className="mt-2 text-xs leading-5 text-slate-300">{signal.news.headline}</p> : null}
                <p className="mt-2 text-xs text-slate-400">
                  {signal.news.source ? `${signal.news.source}` : "News feed"}{signal.news.publishedAt ? ` | ${formatTime(signal.news.publishedAt)}` : ""}
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-300">Structured news is unavailable this cycle. News score remains neutral.</p>
            )}
          </div>
        ) : null}

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
            <p className="mt-4 text-xs text-slate-400">Grounded interpretation only. Not financial advice.</p>
          </div>
        ) : null}

        <div className="mt-6 rounded-3xl border border-accent-blue/15 bg-gradient-to-br from-accent-blue/10 to-transparent p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Score Breakdown</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            <DetailMetric label="Momentum" value={String(signal.scoreBreakdown.momentumScore)} />
            <DetailMetric label="Volume" value={String(signal.scoreBreakdown.volumeScore)} />
            <DetailMetric label="News" value={String(signal.scoreBreakdown.newsScore)} />
            <DetailMetric label="Trending" value={String(signal.scoreBreakdown.trendScore)} />
            <DetailMetric label="Final" value={String(signal.scoreBreakdown.finalScore)} />
            <DetailMetric label="Factors" value={String(signal.factorCount)} />
            {signal.reappearance.scoreBoost > 0 ? <DetailMetric label="Reappear Boost" value={`+${signal.reappearance.scoreBoost}`} /> : null}
          </div>
          <p className="mt-4 text-xs text-slate-400">
            Freshness: {formatQuoteFreshness(signal.quoteFreshness)} | {signal.degraded ? "Limited this cycle" : "Live"}
          </p>
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
