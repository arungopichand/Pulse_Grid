"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LiveEventFeed } from "@/components/live-event-feed";
import { SignalCard } from "@/components/signal-card";
import { ToastStack } from "@/components/toast-stack";
import { TickerDetail } from "@/components/ticker-detail";
import type { LiveEvent } from "@/lib/live-events";
import type { Signal } from "@/lib/live-signal-engine";
import { fetchLiveSessionSnapshot } from "@/lib/market-data";
import type { RankMovement, SignalAnalysis } from "@/lib/signal-analysis";
import { buildSignalAnalysisFeatures, createSignalAnalysisFingerprint } from "@/lib/signal-analysis";
import { requestSignalAnalysis } from "@/lib/signal-analysis-client";
import { formatQuoteFreshness, getSignalStageLabel } from "@/lib/utils";

type LiveCue = "New" | "Rising" | "Cooling" | "Moved up" | "Moved down" | "Back again" | "Reappearing" | "Building";
type SignalUiMeta = {
  liveCue: LiveCue | null;
  changedAt: number;
  rank: number;
  score: number;
};

type UiToast = {
  id: string;
  title: string;
  body: string;
  symbol: string;
};

function getFreshnessPhrase(lastUpdated: string | null, degraded: boolean, nowMs: number) {
  if (degraded) {
    return "Limited this cycle";
  }

  if (!lastUpdated) {
    return "Connecting";
  }

  const ageMs = Math.max(0, nowMs - new Date(lastUpdated).getTime());
  if (ageMs <= 7_000) {
    return "Just now";
  }

  if (ageMs <= 30_000) {
    return "Moments ago";
  }

  if (ageMs <= 75_000) {
    return "Waiting for fresh prints";
  }

  return "Aging";
}

function formatToastCopy(event: LiveEvent) {
  if (event.eventType === "TOP_SETUP") {
    return {
      title: `${event.symbol} now Top Setup`,
      body: "High-conviction setup moved to the top spot.",
    };
  }

  if (event.eventType === "BULLISH_SIGNAL") {
    return {
      title: `${event.symbol} bullish signal`,
      body: "Bullish setup is supported by fresh structured news.",
    };
  }

  if (event.eventType === "BEARISH_SIGNAL") {
    return {
      title: `${event.symbol} bearish signal`,
      body: "Bearish setup is supported by fresh structured news.",
    };
  }

  if (event.eventType === "REAPPEAR") {
    return {
      title: `${event.symbol} back in play`,
      body: "Reappeared with stronger momentum.",
    };
  }

  return {
    title: event.title,
    body: event.summary,
  };
}

export default function HomePage() {
  const previousSignalMetaRef = useRef<Record<string, { rank: number; score: number }>>({});
  const previousTopIdRef = useRef<string | null>(null);
  const signalUiMetaRef = useRef<Record<string, SignalUiMeta>>({});
  const analysisFingerprintBySignalIdRef = useRef<Record<string, string>>({});
  const seenNotificationIdsRef = useRef<Record<string, true>>({});

  const [signals, setSignals] = useState<Signal[]>([]);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [toasts, setToasts] = useState<UiToast[]>([]);
  const [signalUiMeta, setSignalUiMeta] = useState<Record<string, SignalUiMeta>>({});
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<"premarket" | "regular" | "after-hours" | "closed">("closed");
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [topSetupLiveNote, setTopSetupLiveNote] = useState<string | null>(null);
  const [signalAnalysisById, setSignalAnalysisById] = useState<Record<string, SignalAnalysis>>({});
  const [analysisLoadingId, setAnalysisLoadingId] = useState<string | null>(null);

  function mapLiveCueToRankMovement(liveCue: LiveCue | null): RankMovement {
    if (liveCue === "New") {
      return "new";
    }

    if (liveCue === "Rising" || liveCue === "Moved up" || liveCue === "Back again" || liveCue === "Building") {
      return "up";
    }

    if (liveCue === "Cooling" || liveCue === "Moved down") {
      return "down";
    }

    return "flat";
  }

  const buildSignalUiMeta = useCallback((nextSignals: Signal[]) => {
    const now = Date.now();
    const nextMeta: Record<string, SignalUiMeta> = {};
    const previousUiMeta = signalUiMetaRef.current;

    for (const [index, signal] of nextSignals.entries()) {
      const rank = index + 1;
      const previous = previousSignalMetaRef.current[signal.id];
      const rankDelta = previous ? previous.rank - rank : 0;
      const scoreDelta = previous ? signal.finalScore - previous.score : 0;

      let liveCue: LiveCue | null = null;
      let changedAt = previous ? (previousUiMeta[signal.id]?.changedAt ?? now) : now;

      if (signal.reappearance.label) {
        liveCue = signal.reappearance.label;
        changedAt = now;
      } else if (!previous) {
        liveCue = "New";
        changedAt = now;
      } else if (rankDelta >= 2 || scoreDelta >= 5) {
        liveCue = "Rising";
        changedAt = now;
      } else if (rankDelta <= -2 || scoreDelta <= -5) {
        liveCue = "Cooling";
        changedAt = now;
      } else if (rankDelta === 1) {
        liveCue = "Moved up";
        changedAt = now;
      } else if (rankDelta === -1) {
        liveCue = "Moved down";
        changedAt = now;
      }

      nextMeta[signal.id] = {
        liveCue,
        changedAt,
        rank,
        score: signal.finalScore,
      };
    }

    previousSignalMetaRef.current = Object.fromEntries(nextSignals.map((signal, index) => [
      signal.id,
      { rank: index + 1, score: signal.finalScore },
    ]));
    signalUiMetaRef.current = nextMeta;
    setSignalUiMeta(nextMeta);

    const nextTopId = nextSignals[0]?.id ?? null;
    if (nextTopId && previousTopIdRef.current && previousTopIdRef.current !== nextTopId) {
      setTopSetupLiveNote(`Top setup rotated to ${nextSignals[0].ticker}`);
    } else if (nextTopId) {
      setTopSetupLiveNote("Top setup is updating live");
    } else {
      setTopSetupLiveNote(null);
    }
    previousTopIdRef.current = nextTopId;
  }, []);

  const applySnapshot = useCallback((result: Awaited<ReturnType<typeof fetchLiveSessionSnapshot>>) => {
    startTransition(() => {
      buildSignalUiMeta(result.signals);
      setSignals(result.signals);
      setEvents(result.events ?? []);
      setSelectedSignal((selected) => {
        if (!selected) return selected;
        return result.signals.find((signal) => signal.id === selected.id) ?? null;
      });

      const incoming = (result.notifications ?? []).filter((event) => !seenNotificationIdsRef.current[event.id]);
      if (incoming.length) {
        for (const event of incoming) {
          seenNotificationIdsRef.current[event.id] = true;
        }

        const nextToasts = incoming.slice(0, 3).map((event) => ({
          id: event.id,
          ...formatToastCopy(event),
          symbol: event.symbol,
        }));
        setToasts((current) => [...nextToasts, ...current].slice(0, 4));
      }
    });

    setDegraded(result.degraded);
    setLastUpdated(result.lastUpdated);
    setSessionStatus(result.sessionStatus);
  }, [buildSignalUiMeta]);

  useEffect(() => {
    let active = true;
    let currentController: AbortController | null = new AbortController();
    let eventSource: EventSource | null = null;

    const bootstrap = async () => {
      try {
        const result = await fetchLiveSessionSnapshot({ signal: currentController?.signal });
        if (!active) return;
        applySnapshot(result);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
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
      currentController?.abort();
      currentController = null;
      eventSource?.close();
    };
  }, [applySnapshot]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!toasts.length) return;
    const timer = window.setTimeout(() => {
      setToasts((current) => current.slice(0, -1));
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  const rankedSignals = useMemo(() => {
    return [...signals].sort((left, right) => {
      if (right.finalScore !== left.finalScore) {
        return right.finalScore - left.finalScore;
      }
      return right.confidenceScore - left.confidenceScore;
    });
  }, [signals]);

  const topOpportunity = rankedSignals[0] ?? null;
  const liveSignals = rankedSignals.slice(1);
  const freshnessPhrase = getFreshnessPhrase(lastUpdated, degraded, nowTick);
  const topSetupAnalysis = topOpportunity ? signalAnalysisById[topOpportunity.id] ?? null : null;
  const selectedSignalAnalysis = selectedSignal ? signalAnalysisById[selectedSignal.id] ?? null : null;
  const topSetupStage = topOpportunity
    ? getSignalStageLabel({
        timestamp: topOpportunity.timestamp,
        quoteFreshness: topOpportunity.quoteFreshness,
        nowMs: nowTick,
      })
    : null;
  const selectSignalBySymbol = useCallback((symbol: string) => {
    const match = rankedSignals.find((signal) => signal.ticker === symbol) ?? null;
    setSelectedSignal(match);
  }, [rankedSignals]);

  useEffect(() => {
    const targetSignal = selectedSignal ?? topOpportunity;
    if (!targetSignal) {
      return;
    }

    const rank = Math.max(1, rankedSignals.findIndex((signal) => signal.id === targetSignal.id) + 1 || 1);
    const rankMovement = mapLiveCueToRankMovement(signalUiMeta[targetSignal.id]?.liveCue ?? null);
    const features = buildSignalAnalysisFeatures({
      signal: targetSignal,
      sessionStatus,
      degraded,
      rank,
      rankMovement,
    });

    const fingerprint = createSignalAnalysisFingerprint(features);
    const existingFingerprint = analysisFingerprintBySignalIdRef.current[targetSignal.id];
    if (existingFingerprint === fingerprint && signalAnalysisById[targetSignal.id]) {
      return;
    }

    const controller = new AbortController();
    setAnalysisLoadingId(targetSignal.id);

    void requestSignalAnalysis(features, { signal: controller.signal })
      .then((analysis) => {
        analysisFingerprintBySignalIdRef.current[targetSignal.id] = fingerprint;
        setSignalAnalysisById((current) => ({
          ...current,
          [targetSignal.id]: analysis,
        }));
      })
      .finally(() => {
        setAnalysisLoadingId((current) => (current === targetSignal.id ? null : current));
      });

    return () => controller.abort();
  }, [degraded, rankedSignals, selectedSignal, sessionStatus, signalAnalysisById, signalUiMeta, topOpportunity]);

  return (
    <main className="relative overflow-hidden">
      <div className="absolute inset-0 grid-overlay opacity-20" />
      <ToastStack toasts={toasts} onSelectSymbol={selectSignalBySymbol} />

      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between border-b border-white/10 pb-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">PulseGrid Lite</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Live Signals</h1>
          </div>
          <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
            degraded ? "border-amber-400/25 bg-amber-400/10 text-amber-100" : "border-cyan-400/20 bg-cyan-400/10 text-cyan-100"
          }`}>
            {freshnessPhrase}
          </span>
        </header>

        <section className="mt-6">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Top Setup</p>
          {topOpportunity ? (
            <button
              type="button"
              onClick={() => setSelectedSignal(topOpportunity)}
              className="glass-panel mt-3 w-full rounded-3xl border border-white/10 bg-white/[0.03] p-7 text-left transition duration-300 hover:border-white/20 hover:bg-white/[0.05]"
            >
              <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-5xl font-semibold tracking-tight text-white">{topOpportunity.ticker}</h2>
                  <p className="mt-1 text-sm text-slate-400">{topOpportunity.company}</p>
                  <p className="mt-3 text-sm leading-6 text-slate-200">
                    {topSetupAnalysis
                      ? topSetupAnalysis.summary
                      : analysisLoadingId === topOpportunity.id
                        ? "Preparing grounded interpretation."
                        : "Preparing grounded interpretation."}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <HeroStat label="Price" value={`$${topOpportunity.price.toFixed(2)}`} />
                  <HeroStat label="Move" value={`${topOpportunity.changePercent >= 0 ? "+" : ""}${topOpportunity.changePercent.toFixed(2)}%`} />
                  <HeroStat label="Type" value={topOpportunity.signalType} />
                  <HeroStat label="Confidence" value={topOpportunity.confidence} />
                  <HeroStat label="Stage" value={topSetupStage ?? "In play"} />
                  <HeroStat label="Freshness" value={formatQuoteFreshness(topOpportunity.quoteFreshness)} />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {topOpportunity.reasonBadges.slice(0, 3).map((reason) => (
                  <span key={reason} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-slate-300">
                    {reason}
                  </span>
                ))}
                {topSetupLiveNote ? <span className="text-xs text-cyan-200/90">{topSetupLiveNote}</span> : null}
              </div>
            </button>
          ) : (
            <div className="glass-panel mt-3 rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center">
              <h2 className="text-xl font-semibold text-white">Watching for fresh setups</h2>
              <p className="mt-2 text-sm text-slate-400">Signals appear here as soon as confluence clears.</p>
            </div>
          )}
        </section>

        <section className="mt-8 pb-8">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Live Signals</p>
            <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">{liveSignals.length}</span>
          </div>
          <div className="mt-4 space-y-4">
            {liveSignals.length ? (
              liveSignals.map((signal) => (
                <SignalCard
                  key={signal.id}
                  signal={signal}
                  onClick={() => setSelectedSignal(signal)}
                  liveCue={signalUiMeta[signal.id]?.liveCue}
                  recentlyChanged={nowTick - (signalUiMeta[signal.id]?.changedAt ?? 0) < 2400}
                  compact
                />
              ))
            ) : (
              <p className="text-sm text-slate-400">No additional live signals right now.</p>
            )}
          </div>
        </section>

        <LiveEventFeed events={events} onSelectSymbol={selectSignalBySymbol} />
      </div>

      <TickerDetail
        signal={selectedSignal}
        analysis={selectedSignalAnalysis}
        open={Boolean(selectedSignal)}
        onClose={() => setSelectedSignal(null)}
      />
    </main>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}
