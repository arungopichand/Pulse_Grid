"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FilterBar } from "@/components/filter-bar";
import { SignalCard } from "@/components/signal-card";
import { StatusBadge } from "@/components/status-badge";
import { TickerDetail } from "@/components/ticker-detail";
import { ToastStack } from "@/components/toast-stack";
import { VolumeMoversSection } from "@/components/volume-movers-section";
import { WatchlistPanel } from "@/components/watchlist-panel";
import type { Signal, SignalType, WatchlistQuote } from "@/lib/live-signal-engine";
import { fetchLiveSessionSnapshot, getMarketDataProviderStatus } from "@/lib/market-data";
import { requestSignalAnalysis } from "@/lib/signal-analysis-client";
import type { RankMovement, SignalAnalysis } from "@/lib/signal-analysis";
import { buildSignalAnalysisFeatures, createSignalAnalysisFingerprint } from "@/lib/signal-analysis";
import type { VolumeMover } from "@/lib/volume-movers";
import { watchlistUniverse } from "@/lib/watchlist";

const signalTypes: SignalType[] = ["Breakout", "Momentum Spike"];
type ScanPreset = "Penny Momentum" | "Low Float Catalysts" | "Clean Movers Only" | "High Risk / Fast Tape";

type Toast = {
  id: string;
  title: string;
  body: string;
};

type LiveCue = "New" | "Rising" | "Cooling" | "Moved up" | "Moved down";
type SignalUiMeta = {
  liveCue: LiveCue | null;
  changedAt: number;
  rank: number;
  score: number;
};

function createInitialWatchlistQuotes(): WatchlistQuote[] {
  return watchlistUniverse.map((ticker) => ({
    ...ticker,
    price: null,
    changePercent: null,
    timestamp: null,
    freshness: "missing",
    quoteProvider: null,
    hasActiveSignal: false,
  }));
}

function formatRefreshCadence(ms: number) {
  if (ms % 60000 === 0) {
    return `${ms / 60000}m`;
  }

  return `${Math.round(ms / 1000)}s`;
}

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

function getLiveMood(params: { degraded: boolean; providerLive: boolean; hasSignals: boolean; freshnessPhrase: string }) {
  if (params.degraded) {
    return params.hasSignals ? "Limited this cycle. Watching for fresh setups." : "Limited this cycle. Market is quiet right now.";
  }

  if (!params.providerLive) {
    return "Stream reconnecting. Keeping the latest trusted snapshot on screen.";
  }

  if (params.freshnessPhrase === "Waiting for fresh prints") {
    return "Scanner is live and waiting for fresh prints.";
  }

  return params.hasSignals ? "Live scanner is tracking active setups." : "Watching for fresh setups.";
}

function getSessionContextLabel(sessionStatus: "premarket" | "regular" | "after-hours" | "closed") {
  if (sessionStatus !== "regular") {
    if (sessionStatus === "premarket") return "Premarket";
    if (sessionStatus === "after-hours") return "After-Hours";
    return "Closed";
  }

  const nyParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hour = Number(nyParts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(nyParts.find((part) => part.type === "minute")?.value ?? "0");
  const minutes = hour * 60 + minute;

  if (minutes < 690) return "Open";
  if (minutes < 870) return "Midday";
  return "Power Hour";
}

export default function HomePage() {
  const initialProviderStatus = useMemo(() => getMarketDataProviderStatus(), []);
  const previousSignalMetaRef = useRef<Record<string, { rank: number; score: number }>>({});
  const previousTopIdRef = useRef<string | null>(null);
  const signalUiMetaRef = useRef<Record<string, SignalUiMeta>>({});
  const analysisFingerprintBySignalIdRef = useRef<Record<string, string>>({});
  const [signals, setSignals] = useState<Signal[]>([]);
  const [signalUiMeta, setSignalUiMeta] = useState<Record<string, SignalUiMeta>>({});
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);
  const [activeSignal, setActiveSignal] = useState<SignalType | "All">("All");
  const [minConfidence, setMinConfidence] = useState(70);
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [scanPreset, setScanPreset] = useState<ScanPreset>("Penny Momentum");
  const [showMoreCandidates, setShowMoreCandidates] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [providerMessage, setProviderMessage] = useState(initialProviderStatus.message);
  const [providerLive, setProviderLive] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [sessionLabel, setSessionLabel] = useState("Closed");
  const [sessionStatus, setSessionStatus] = useState<"premarket" | "regular" | "after-hours" | "closed">("closed");
  const [persistenceHealthy, setPersistenceHealthy] = useState(true);
  const [retryAfterMs, setRetryAfterMs] = useState(initialProviderStatus.pollIntervalMs);
  const [watchlistQuotes, setWatchlistQuotes] = useState<WatchlistQuote[]>(() => createInitialWatchlistQuotes());
  const [volumeMovers, setVolumeMovers] = useState<VolumeMover[]>([]);
  const [volumeMoversMessage, setVolumeMoversMessage] = useState<string | null>(null);
  const [activeUniverseCount, setActiveUniverseCount] = useState(watchlistUniverse.length);
  const [universeMessage, setUniverseMessage] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [topSetupLiveNote, setTopSetupLiveNote] = useState<string | null>(null);
  const [signalAnalysisById, setSignalAnalysisById] = useState<Record<string, SignalAnalysis>>({});
  const [analysisLoadingId, setAnalysisLoadingId] = useState<string | null>(null);

  function mapLiveCueToRankMovement(liveCue: LiveCue | null): RankMovement {
    if (liveCue === "New") {
      return "new";
    }

    if (liveCue === "Rising" || liveCue === "Moved up") {
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
      const scoreDelta = previous ? signal.score - previous.score : 0;

      let liveCue: LiveCue | null = null;
      let changedAt = previous ? (previousUiMeta[signal.id]?.changedAt ?? now) : now;

      if (!previous) {
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
        score: signal.score,
      };
    }

    previousSignalMetaRef.current = Object.fromEntries(nextSignals.map((signal, index) => [
      signal.id,
      { rank: index + 1, score: signal.score },
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
    if (result.ok) {
      startTransition(() => {
        const nextSignals = result.signals;
        const previousSignalIds = new Set(Object.keys(previousSignalMetaRef.current));
        const nextToasts = nextSignals
          .filter((signal) => !previousSignalIds.has(signal.id))
          .slice(0, 3)
          .map((signal) => ({
            id: `${signal.id}-${signal.timestamp}`,
            title: `${signal.ticker} ${signal.signalType}`,
            body: signal.reason,
          }));

        if (nextToasts.length) {
          setToasts((existing) => [...nextToasts, ...existing].slice(0, 3));
        }

        setSelectedSignal((selected) => {
          if (!selected) return selected;
          return nextSignals.find((signal) => signal.id === selected.id) ?? null;
        });

        buildSignalUiMeta(nextSignals);
        setSignals(nextSignals);

        setWatchlistQuotes(result.watchlist);
        setVolumeMovers(result.volumeMovers);
        setVolumeMoversMessage(result.volumeMoversMessage);
      });

      setProviderLive(true);
      setDegraded(false);
      setLastUpdated(result.lastUpdated);
      setPersistenceHealthy(result.persistence.healthy);
      setProviderMessage(result.persistence.healthy ? result.message : `${result.message} ${result.persistence.message}`);
      setSessionLabel(result.sessionLabel);
      setSessionStatus(result.sessionStatus);
      setRetryAfterMs(result.retryAfterMs);
      setActiveUniverseCount(result.activeUniverseTickers?.length ?? watchlistUniverse.length);
      setUniverseMessage(result.universeMessage ?? null);
      return;
    }

    setProviderLive(false);
    setDegraded(true);
    setSignals(result.signals);
    buildSignalUiMeta(result.signals);
    setSelectedSignal((selected) => {
      if (!selected) return selected;
      return result.signals.find((signal) => signal.id === selected.id) ?? null;
    });
    setPersistenceHealthy(result.persistence.healthy);
    setProviderMessage(result.persistence.healthy ? result.message : `${result.message} ${result.persistence.message}`);
    setSessionLabel(result.sessionLabel);
    setSessionStatus(result.sessionStatus);
    setLastUpdated(result.lastUpdated);
    setRetryAfterMs(result.retryAfterMs);
    setWatchlistQuotes(result.watchlist.length ? result.watchlist : createInitialWatchlistQuotes());
    setVolumeMovers(result.volumeMovers);
    setVolumeMoversMessage(result.volumeMoversMessage);
    setActiveUniverseCount(result.activeUniverseTickers?.length ?? watchlistUniverse.length);
    setUniverseMessage(result.universeMessage ?? null);
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

        setProviderLive(false);
        setDegraded(true);
        setSignals([]);
        setPersistenceHealthy(false);
        setProviderMessage("Live session snapshot is temporarily unavailable. The dashboard will retry shortly.");
        setRetryAfterMs(15000);
        setVolumeMovers([]);
        setVolumeMoversMessage("Volume Movers is temporarily unavailable while the dashboard reconnects.");
      }

      if (!active) return;

      eventSource = new EventSource("/api/live-session/events");
      eventSource.addEventListener("snapshot", (event) => {
        if (!active) return;

        const result = JSON.parse((event as MessageEvent<string>).data) as Awaited<ReturnType<typeof fetchLiveSessionSnapshot>>;
        applySnapshot(result);
      });

      eventSource.onerror = () => {
        if (!active) return;

        setProviderLive(false);
        setProviderMessage("Live stream is reconnecting. The latest honest server snapshot remains on screen.");
      };
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
    const timeout = window.setTimeout(() => {
      setToasts((current) => current.slice(0, -1));
    }, 3600);

    return () => window.clearTimeout(timeout);
  }, [toasts]);

  useEffect(() => {
    setShowMoreCandidates(false);
  }, [scanPreset, activeSignal, minConfidence, watchlistOnly, signals]);

  const filteredSignals = useMemo(() => {
    return signals
      .filter((signal) => {
      const matchesType = activeSignal === "All" || signal.signalType === activeSignal;
      const matchesConfidence = signal.confidence >= minConfidence;
      const matchesWatchlist = !watchlistOnly || signal.watchlisted;
      const matchesPreset =
        scanPreset === "Penny Momentum"
          ? signal.price <= 5 && signal.quoteFreshness === "fresh" && (signal.relativeVolume ?? 0) >= 2
          : scanPreset === "Low Float Catalysts"
            ? signal.price <= 10 && (signal.floatShares ?? Number.POSITIVE_INFINITY) <= 50_000_000
            : scanPreset === "Clean Movers Only"
              ? signal.quoteFreshness === "fresh" && signal.riskFlags.length === 0
              : signal.price <= 10;

      return matchesType && matchesConfidence && matchesWatchlist && matchesPreset;
    })
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return right.confidence - left.confidence;
      });
  }, [activeSignal, minConfidence, scanPreset, signals, watchlistOnly]);

  const topOpportunity = filteredSignals[0] ?? null;
  const topSetups = filteredSignals.slice(1, 4);
  const rankedCandidates = filteredSignals.slice(4, showMoreCandidates ? undefined : 9);
  const hiddenCandidateCount = Math.max(0, filteredSignals.length - 9);
  const freshnessPhrase = getFreshnessPhrase(lastUpdated, degraded, nowTick);
  const liveMoodMessage = getLiveMood({
    degraded,
    providerLive,
    hasSignals: filteredSignals.length > 0,
    freshnessPhrase,
  });
  const sessionContextLabel = getSessionContextLabel(sessionStatus);
  const topSetupAnalysis = topOpportunity ? signalAnalysisById[topOpportunity.id] ?? null : null;
  const selectedSignalAnalysis = selectedSignal ? signalAnalysisById[selectedSignal.id] ?? null : null;

  useEffect(() => {
    const targetSignal = selectedSignal ?? topOpportunity;
    if (!targetSignal) {
      return;
    }

    const rank = Math.max(1, filteredSignals.findIndex((signal) => signal.id === targetSignal.id) + 1 || 1);
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
  }, [
    degraded,
    filteredSignals,
    selectedSignal,
    sessionStatus,
    signalAnalysisById,
    signalUiMeta,
    topOpportunity,
  ]);

  return (
    <main className="relative overflow-hidden">
      <div className="absolute inset-0 grid-overlay opacity-40" />
      <ToastStack toasts={toasts} />

      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <nav className="glass-panel flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-cyan-200/70">PulseGrid Lite</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Live Penny Scanner</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge
              label={providerLive ? `Live | ${freshnessPhrase}` : degraded ? "Limited Cycle" : "Connecting"}
              tone={providerLive ? "live" : degraded ? "warning" : "neutral"}
            />
            <StatusBadge label={sessionLabel} tone={sessionStatus === "regular" ? "positive" : "neutral"} />
            {!persistenceHealthy ? <StatusBadge label="Persistence Degraded" tone="warning" /> : null}
          </div>
        </nav>

        <section className="mt-6 grid gap-4 lg:grid-cols-[1.5fr_0.85fr]">
          <div className="glass-panel overflow-hidden p-5 sm:p-6">
            <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Scanner</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">Live penny names worth attention</h2>
                {universeMessage ? <p className="mt-3 text-sm text-cyan-100/80">{universeMessage}</p> : null}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <MiniStat label="Universe" value={`${activeUniverseCount} live names`} />
                <MiniStat label="Session" value={sessionLabel} />
                <MiniStat
                  label="Updated"
                  value={
                    lastUpdated
                      ? new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                      : "--"
                  }
                />
              </div>
            </div>
          </div>

          <div className="glass-panel bg-gradient-to-br from-accent-cyan/10 via-transparent to-accent-blue/10 p-5 sm:p-6">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Live State</p>
            <p className="mt-2 text-sm leading-6 text-cyan-100/85">{liveMoodMessage}</p>
            <p className="mt-2 text-sm leading-6 text-slate-300/85">
              {sessionContextLabel} flow. {providerMessage.toLowerCase().includes("limited") ? "Limited this cycle." : "Staying session-aware."}
            </p>
            <p className="mt-4 text-xs uppercase tracking-[0.22em] text-slate-500">Refresh {formatRefreshCadence(retryAfterMs)} | {freshnessPhrase}</p>
          </div>
        </section>

        <div className="mt-6">
          <FilterBar
            signalTypes={signalTypes}
            activeSignal={activeSignal}
            onSignalChange={setActiveSignal}
            minConfidence={minConfidence}
            onMinConfidenceChange={setMinConfidence}
            watchlistOnly={watchlistOnly}
            onWatchlistOnlyChange={setWatchlistOnly}
            scanPreset={scanPreset}
            onScanPresetChange={setScanPreset}
            signalCount={filteredSignals.length}
          />
        </div>

        <section className="mt-6 grid flex-1 gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-5">
            {degraded ? (
              <div className="glass-panel border-white/10 bg-white/[0.04] p-6 text-center">
                <p className="text-sm font-medium text-slate-200">Limited this cycle.</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">Keeping the healthiest names visible while waiting for fresh setups.</p>
              </div>
            ) : null}

            {topOpportunity ? (
              <>
                <div className="glass-panel overflow-hidden p-6">
                  <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Top Opportunity</p>
                      <h3 className="mt-2 text-3xl font-semibold text-white">{topOpportunity.ticker}</h3>
                      <p className="mt-1 text-sm text-slate-400">{topOpportunity.company}</p>
                      {topSetupLiveNote ? <p className="mt-2 text-xs uppercase tracking-[0.2em] text-cyan-200/80">{topSetupLiveNote}</p> : null}
                    </div>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                      <MiniStat label="Price" value={`$${topOpportunity.price.toFixed(2)}`} />
                      <MiniStat label="Move" value={`${topOpportunity.changePercent >= 0 ? "+" : ""}${topOpportunity.changePercent.toFixed(2)}%`} />
                      <MiniStat label="Confidence" value={`${topOpportunity.confidence}`} />
                    </div>
                  </div>
                  <div className="mt-5">
                    <SignalCard
                      signal={topOpportunity}
                      onClick={() => setSelectedSignal(topOpportunity)}
                      featured
                      liveCue={signalUiMeta[topOpportunity.id]?.liveCue}
                      recentlyChanged={nowTick - (signalUiMeta[topOpportunity.id]?.changedAt ?? 0) < 2400}
                    />
                  </div>
                  <div className="mt-4 rounded-2xl border border-cyan-300/15 bg-cyan-300/5 p-4">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">AI Interpretation</p>
                    <p className="mt-2 text-sm leading-6 text-slate-200">
                      {topSetupAnalysis
                        ? topSetupAnalysis.summary
                        : analysisLoadingId === topOpportunity.id
                          ? "Analyzing live setup context..."
                          : "Preparing grounded interpretation."}
                    </p>
                    {topSetupAnalysis ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] text-slate-300">{topSetupAnalysis.stage}</span>
                        <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] text-slate-300">{topSetupAnalysis.confidence}</span>
                        <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] text-slate-300">{topSetupAnalysis.tone}</span>
                        <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] text-slate-300">
                          {topSetupAnalysis.source === "llm" ? "AI model" : "Rules fallback"}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="glass-panel p-5">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Main Scanner</p>
                      <h3 className="mt-2 text-xl font-semibold text-white">Top 3 setups</h3>
                    </div>
                    <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">
                      {Math.min(filteredSignals.length, 4)} visible
                    </span>
                  </div>
                  <div className="mt-4 space-y-4">
                    {topSetups.length ? topSetups.map((signal) => (
                      <SignalCard
                        key={signal.id}
                        signal={signal}
                        onClick={() => setSelectedSignal(signal)}
                        liveCue={signalUiMeta[signal.id]?.liveCue}
                        recentlyChanged={nowTick - (signalUiMeta[signal.id]?.changedAt ?? 0) < 2400}
                      />
                    )) : (
                      <p className="text-sm text-slate-400">No secondary setups are clearing the current preset right now.</p>
                    )}
                  </div>
                </div>

                <div className="glass-panel p-5">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-500">More</p>
                      <h3 className="mt-2 text-xl font-semibold text-white">Ranked names</h3>
                    </div>
                    <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">
                      {Math.min(Math.max(filteredSignals.length - 4, 0), showMoreCandidates ? rankedCandidates.length : 5)} listed
                    </span>
                  </div>

                  <div className="mt-4 space-y-4">
                    {rankedCandidates.length ? rankedCandidates.map((signal) => (
                      <SignalCard
                        key={signal.id}
                        signal={signal}
                        onClick={() => setSelectedSignal(signal)}
                        compact
                        liveCue={signalUiMeta[signal.id]?.liveCue}
                        recentlyChanged={nowTick - (signalUiMeta[signal.id]?.changedAt ?? 0) < 2400}
                      />
                    )) : (
                      <p className="text-sm text-slate-400">No extra ranked candidates are earning visibility yet.</p>
                    )}
                  </div>

                  {hiddenCandidateCount > 0 && !showMoreCandidates ? (
                    <button
                      type="button"
                      onClick={() => setShowMoreCandidates(true)}
                      className="mt-4 rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:border-white/20 hover:bg-white/5"
                    >
                      More ({hiddenCandidateCount})
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="glass-panel p-10 text-center">
                <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Live Scan</p>
                <h3 className="mt-2 text-xl font-semibold text-white">Watching for fresh setups</h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">Market is quiet right now. New names appear here as soon as they qualify.</p>
              </div>
            )}
          </div>

          <div className="space-y-5">
            <VolumeMoversSection items={volumeMovers.slice(0, 5)} message={volumeMoversMessage} />

            <WatchlistPanel
              items={watchlistQuotes.slice(0, 8)}
              selectedTicker={selectedSignal?.ticker}
              onSelect={(ticker) => {
                const nextSelected = signals.find((signal) => signal.ticker === ticker) ?? null;
                setSelectedSignal(nextSelected);
              }}
            />
          </div>
        </section>
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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}
