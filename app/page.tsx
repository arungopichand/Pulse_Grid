"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Signal } from "@/lib/live-signal-engine";
import { fetchLiveSessionSnapshot } from "@/lib/market-data";

function formatChangePercent(value: number) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatAge(timestamp: string, nowMs: number) {
  const ageMs = Math.max(0, nowMs - new Date(timestamp).getTime());
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function titleCaseSignalType(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function DashboardHeader() {
  return (
    <header className="border-b border-white/8 pb-6">
      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">PulseGrid Lite</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-100 sm:text-4xl">Live Signals</h1>
    </header>
  );
}

function StatusMessage({ text }: { text: string }) {
  return <p className="mt-4 text-sm text-slate-400">{text}</p>;
}

function TopOpportunitySection({ signal, nowMs }: { signal: Signal | null; nowMs: number }) {
  return (
    <section className="border-r-0 border-white/8 pr-0 pb-8 md:border-r md:pr-8 md:pb-0">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Top Opportunity</p>
      {!signal ? (
        <div className="mt-8 space-y-3">
          <p className="text-2xl font-medium text-slate-100">No active setup yet</p>
          <p className="text-sm text-slate-400">Waiting for cleaner confirmation from the live feed.</p>
        </div>
      ) : (
        <div className="mt-8">
          <p className="text-5xl font-semibold tracking-tight text-white">{signal.ticker}</p>
          <p className="mt-4 text-sm uppercase tracking-[0.14em] text-slate-300">
            {titleCaseSignalType(signal.signalType)} Signal · Score {Math.round(signal.finalScore)}
          </p>
          <div className="mt-8 space-y-3 text-sm">
            <p className="text-slate-200">{formatChangePercent(signal.changePercent)} today</p>
            <p className="text-slate-400">
              {formatAge(signal.timestamp, nowMs)} ago · {signal.quoteProvider === "finnhub" ? "Finnhub" : "Massive"}
            </p>
          </div>
          <div className="mt-8 border-t border-white/8 pt-4">
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Why</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              {signal.explanationLine || "Strong signal strength with fresh momentum confirmation."}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function LiveSignalsSection({ signals, nowMs }: { signals: Signal[]; nowMs: number }) {
  return (
    <section className="md:pl-8">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Live Signals</p>
      {!signals.length ? (
        <p className="mt-8 text-sm text-slate-400">No active signals yet.</p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/8 text-left text-[11px] uppercase tracking-[0.12em] text-slate-500">
                <th className="px-0 py-3 font-medium">Symbol</th>
                <th className="px-3 py-3 font-medium">Signal</th>
                <th className="px-3 py-3 font-medium">Score</th>
                <th className="px-3 py-3 font-medium">Change %</th>
                <th className="px-3 py-3 font-medium">Age</th>
                <th className="px-3 py-3 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((signal) => (
                <tr key={signal.id} className="border-b border-white/6 text-slate-300">
                  <td className="px-0 py-3.5 font-semibold text-slate-100">{signal.ticker}</td>
                  <td className="px-3 py-3.5">{titleCaseSignalType(signal.signalType)}</td>
                  <td className="px-3 py-3.5">{Math.round(signal.finalScore)}</td>
                  <td className={`px-3 py-3.5 ${signal.changePercent >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                    {formatChangePercent(signal.changePercent)}
                  </td>
                  <td className="px-3 py-3.5 text-slate-400">{formatAge(signal.timestamp, nowMs)} ago</td>
                  <td className="px-3 py-3.5 text-slate-400">{signal.quoteProvider === "finnhub" ? "Finnhub" : "Massive"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function HomePage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<"premarket" | "regular" | "after-hours" | "closed">("closed");
  const [nowTick, setNowTick] = useState(() => Date.now());

  const applySnapshot = useCallback((result: Awaited<ReturnType<typeof fetchLiveSessionSnapshot>>) => {
    setSignals(result.signals);
    setDegraded(result.degraded);
    setSessionStatus(result.sessionStatus);
  }, []);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = new AbortController();
    let eventSource: EventSource | null = null;

    const bootstrap = async () => {
      try {
        const result = await fetchLiveSessionSnapshot({ signal: controller?.signal });
        if (!active) return;
        applySnapshot(result);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        if (!active) return;
        setDegraded(true);
        setSignals([]);
      }

      if (!active) return;
      eventSource = new EventSource("/api/live-session/events");
      eventSource.addEventListener("snapshot", (event) => {
        if (!active) return;
        const result = JSON.parse((event as MessageEvent<string>).data) as Awaited<ReturnType<typeof fetchLiveSessionSnapshot>>;
        applySnapshot(result);
      });
    };

    void bootstrap();

    return () => {
      active = false;
      controller?.abort();
      controller = null;
      eventSource?.close();
    };
  }, [applySnapshot]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const rankedSignals = useMemo(() => {
    return [...signals].sort((left, right) => {
      if (right.finalScore !== left.finalScore) {
        return right.finalScore - left.finalScore;
      }
      return right.confidenceScore - left.confidenceScore;
    });
  }, [signals]);

  const topOpportunity = rankedSignals[0] ?? null;
  const statusLine =
    sessionStatus === "closed"
      ? "Scanner online - market closed. Waiting for pre-market activity."
      : sessionStatus === "premarket"
        ? topOpportunity
          ? `${topOpportunity.ticker} is leading with fresh momentum confirmation.`
          : "Pre-market monitoring - scanner online but waiting for activity."
        : sessionStatus === "after-hours"
          ? topOpportunity
            ? `${topOpportunity.ticker} is leading with fresh momentum confirmation.`
            : "After-hours monitoring - scanner online but waiting for activity."
          : degraded
            ? "Live signals are updating from a limited backend cycle."
            : topOpportunity
              ? `${topOpportunity.ticker} is leading with fresh momentum confirmation.`
              : "Monitoring active symbols for fresh momentum.";

  return (
    <main className="relative overflow-hidden">
      <div className="absolute inset-0 grid-overlay opacity-[0.08]" />
      <div className="relative mx-auto min-h-screen w-full max-w-7xl px-5 pt-10 pb-10 sm:px-8 lg:px-10">
        <DashboardHeader />
        <StatusMessage text={statusLine} />
        <div className="mt-10 grid grid-cols-1 gap-10 md:grid-cols-[minmax(0,38fr)_minmax(0,62fr)] md:gap-0">
          <TopOpportunitySection signal={topOpportunity} nowMs={nowTick} />
          <LiveSignalsSection signals={rankedSignals} nowMs={nowTick} />
        </div>
      </div>
    </main>
  );
}
