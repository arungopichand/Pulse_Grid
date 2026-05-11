"use client";

import { useCallback, useEffect, useState } from "react";

type DebugPayload = {
  scannerMode?: "closed_waiting" | "premarket_scanning" | "regular_scanning" | "afterhours_scanning";
  scannerDiagnostics: {
    massiveApiKeyConfigured: boolean;
    universeSource: string;
    activeUniverseCount: number;
    discoveredCount: number;
    selectedCount: number;
    noQualifyingSymbols: boolean;
    websocketConnected: boolean;
    websocketAuthenticated: boolean | null;
    websocketSubscribedCount: number;
    websocketMessagesReceived: number;
    websocketUpdatesApplied: number;
    websocketDegradedReason: string | null;
    quoteFresh: number;
    quoteCached: number;
    quoteStale: number;
    quoteFailed: number;
    primaryMessages: string[];
    stocksOnly?: boolean;
    etfRejectedCount?: number;
    rejectedEtfSymbols?: string[];
    retainedUniverse?: boolean;
    retainedUniverseCount?: number;
    retainedSignalCount?: number;
    activeSignalMemoryCount?: number;
    latestSnapshotSignalCount?: number;
    uiRetentionTtlMs?: number;
    lastSignalReceivedAt?: string | null;
    lastNonEmptySignalTimestamp?: string | null;
    flickerProtectionActive?: boolean;
    scannerThresholds?: {
      minPrice: number;
      maxPrice: number;
      minVolume: number;
      minRelativeVolume: number;
      minAbsChangePercent: number;
      bullishOnly: boolean;
    };
    discoveredBeforeFilters?: number;
    rejectionReasonCounts?: Record<string, number>;
    topCandidates?: Array<{
      ticker: string;
      price: number;
      changePercent: number;
      currentVolume: number;
      relativeVolume: number | null;
      reason: string;
    }>;
  } | null;
  websocket: {
    statusOnlyStream: boolean;
    degradedReason: string | null;
    aggregateUnauthorized?: boolean;
    subscribedTradeCount?: number;
    subscribedAggregateCount?: number;
    appStartedAt?: string | null;
    lastDiscoveryAt?: string | null;
    lastDiscoveryStatus?: string | null;
    lastUniverseCount?: number;
    lastWebSocketConnectAt?: string | null;
    lastTradeAt?: string | null;
    lastAggregateAt?: string | null;
    startup?: {
      massiveKeyConfigured: boolean;
      discoveryAttempted: boolean;
      websocketAttempted: boolean;
    };
    reconnectCount?: number;
  };
  activeSignalsCount: number;
  alertTapeCount?: number;
  emittedAlerts?: Array<{
    ticker: string;
    alertType: string;
    score: number;
    formattedLine: string | null;
    timestamp: string;
  }>;
  alertCountsByTicker?: Array<{ ticker: string; count: number }>;
  alertsCount?: number;
  lastAlertAt?: string | null;
  alertsCountToday?: number;
  latestAlerts?: Array<{
    id: string;
    ticker: string;
    timestamp: string;
    alertType: string;
    score: number;
    formattedLine: string;
  }>;
  highTracking?: Array<{
    ticker: string;
    price: number | null;
    dayHigh: number | null;
    sessionHigh: number | null;
    previousDayHigh: number | null;
    previousSessionHigh: number | null;
    lastAlertHigh: number | null;
    alertCountToday: number;
  }>;
  suppressedDuplicateAlerts?: Array<{
    time: string;
    ticker: string;
    alertType: string;
    reason: string;
  }>;
  transitionLog?: Array<{
    time: string;
    ticker: string;
    previousDayHigh: number | null;
    newDayHigh: number | null;
    previousSessionHigh: number | null;
    newSessionHigh: number | null;
    alertType: string;
    emitted: boolean;
    suppressedReason: string | null;
  }>;
  pipelineCounts?: Record<string, number | null>;
  missingDataFields?: {
    floatUnavailable: number;
    ctbUnavailable: number;
    siUnavailable: number;
    haltUnavailable: number;
  };
  topRejected: Array<{ ticker: string; reason: string }>;
  dynamicUniverse: {
    source: string;
    topSymbols: string[];
    stocksOnly?: boolean;
    etfRejectedCount?: number;
    rejectedEtfSymbols?: string[];
    activeUniverseTickers?: string[];
  };
};

export default function MonitoringPage() {
  const [payload, setPayload] = useState<DebugPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDebug = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/live-session/debug", { cache: "no-store" });
      const data = (await response.json()) as DebugPayload;
      setPayload(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDebug();
    const interval = window.setInterval(() => {
      void fetchDebug();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [fetchDebug]);

  const d = payload?.scannerDiagnostics;

  return (
    <main className="mx-auto max-w-6xl px-5 py-8 text-slate-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Monitoring</h1>
        <button
          type="button"
          onClick={() => void fetchDebug()}
          className="rounded border border-white/20 px-3 py-1 text-sm"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded border border-white/10 p-3">Scanner Mode: {payload?.scannerMode ?? "n/a"}</div>
        <div className="rounded border border-white/10 p-3">API Key: {d ? (d.massiveApiKeyConfigured ? "Configured" : "Missing") : "n/a"}</div>
        <div className="rounded border border-white/10 p-3">Stream: {d ? (d.websocketConnected ? "Connected" : "Disconnected") : "n/a"}</div>
        <div className="rounded border border-white/10 p-3">WS Auth: {d ? String(d.websocketAuthenticated) : "n/a"}</div>
        <div className="rounded border border-white/10 p-3">WS Subscribed: {d?.websocketSubscribedCount ?? "n/a"}</div>
        <div className="rounded border border-white/10 p-3">Trade Subs: {payload?.websocket?.subscribedTradeCount ?? "n/a"}</div>
        <div className="rounded border border-white/10 p-3">Aggregate Subs: {payload?.websocket?.subscribedAggregateCount ?? "n/a"}</div>
        <div className="rounded border border-white/10 p-3">WS Messages: {d?.websocketMessagesReceived ?? "n/a"}</div>
        <div className="rounded border border-white/10 p-3">WS Updates: {d?.websocketUpdatesApplied ?? "n/a"}</div>
        <div className="rounded border border-white/10 p-3">Universe Source: {d?.universeSource ?? "n/a"}</div>
        <div className="rounded border border-white/10 p-3">Stocks Only: {String(d?.stocksOnly ?? payload?.dynamicUniverse?.stocksOnly ?? true)}</div>
        <div className="rounded border border-white/10 p-3">ETF Rejected Count: {d?.etfRejectedCount ?? payload?.dynamicUniverse?.etfRejectedCount ?? 0}</div>
        <div className="rounded border border-white/10 p-3">Discovered Before Filters: {d?.discoveredBeforeFilters ?? "n/a"}</div>
        <div className="rounded border border-white/10 p-3">Universe: {d ? `${d.selectedCount} selected / ${d.discoveredCount} discovered` : "n/a"}</div>
        <div className="rounded border border-white/10 p-3">Active Universe: {d?.activeUniverseCount ?? "n/a"}</div>
        <div className="rounded border border-white/10 p-3">Quotes: {d ? `${d.quoteFresh}/${d.quoteCached}/${d.quoteStale}/${d.quoteFailed}` : "n/a"}</div>
        <div className="rounded border border-white/10 p-3">Status-only stream: {payload ? String(payload.websocket.statusOnlyStream) : "n/a"}</div>
        <div className="rounded border border-white/10 p-3">AM Unauthorized: {payload ? String(payload.websocket.aggregateUnauthorized ?? false) : "n/a"}</div>
        <div className="rounded border border-white/10 p-3">Degraded reason: {d?.websocketDegradedReason ?? payload?.websocket.degradedReason ?? "none"}</div>
        <div className="rounded border border-white/10 p-3">App Started At: {payload?.websocket?.appStartedAt ?? "n/a"}</div>
        <div className="rounded border border-white/10 p-3">Last Discovery At: {payload?.websocket?.lastDiscoveryAt ?? "n/a"}</div>
        <div className="rounded border border-white/10 p-3">Last Discovery Status: {payload?.websocket?.lastDiscoveryStatus ?? "n/a"}</div>
        <div className="rounded border border-white/10 p-3">Last Universe Count: {payload?.websocket?.lastUniverseCount ?? "n/a"}</div>
        <div className="rounded border border-white/10 p-3">Last WS Connect At: {payload?.websocket?.lastWebSocketConnectAt ?? "n/a"}</div>
        <div className="rounded border border-white/10 p-3">Last Trade At: {payload?.websocket?.lastTradeAt ?? "n/a"}</div>
        <div className="rounded border border-white/10 p-3">Last Aggregate At: {payload?.websocket?.lastAggregateAt ?? "n/a"}</div>
        <div className="rounded border border-white/10 p-3">Last Alert At: {payload?.lastAlertAt ?? "n/a"}</div>
        <div className="rounded border border-white/10 p-3">Alerts Count Today: {payload?.alertsCountToday ?? 0}</div>
        <div className="rounded border border-white/10 p-3">WS Reconnect Count: {payload?.websocket?.reconnectCount ?? "n/a"}</div>
        <div className="rounded border border-white/10 p-3">Retained Signal Count: {d?.retainedSignalCount ?? 0}</div>
        <div className="rounded border border-white/10 p-3">Retained Universe Count: {d?.retainedUniverseCount ?? 0}</div>
        <div className="rounded border border-white/10 p-3">Active Signal Memory Count: {d?.activeSignalMemoryCount ?? 0}</div>
        <div className="rounded border border-white/10 p-3">Latest Snapshot Signal Count: {d?.latestSnapshotSignalCount ?? 0}</div>
        <div className="rounded border border-white/10 p-3">UI Retention TTL (ms): {d?.uiRetentionTtlMs ?? "n/a"}</div>
        <div className="rounded border border-white/10 p-3">Last Signal Received At: {d?.lastSignalReceivedAt ?? "n/a"}</div>
        <div className="rounded border border-white/10 p-3">Last Non-empty Signal: {d?.lastNonEmptySignalTimestamp ?? "n/a"}</div>
        <div className="rounded border border-white/10 p-3">Flicker Protection Active: {String(d?.flickerProtectionActive ?? false)}</div>
      </div>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-400">Runtime Note</h2>
        <p className="mt-2 text-sm text-slate-300">
          Local scanner runs only while the Node process is alive. Keep terminal running and machine awake for all-day scanning, or deploy to a long-running Node host. Vercel serverless alone is not sufficient for permanent WebSocket background scanning.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-400">Primary Messages</h2>
        <div className="mt-2 space-y-1">
          {(d?.primaryMessages ?? []).map((message) => (
            <p key={message} className="text-sm text-amber-300">{message}</p>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-400">Thresholds</h2>
        <p className="mt-2 text-sm text-slate-300">
          {d?.scannerThresholds
            ? `minPrice=${d.scannerThresholds.minPrice}, maxPrice=${d.scannerThresholds.maxPrice}, minVolume=${d.scannerThresholds.minVolume}, minRVOL=${d.scannerThresholds.minRelativeVolume}, minAbsChange=${d.scannerThresholds.minAbsChangePercent}, bullishOnly=${d.scannerThresholds.bullishOnly}`
            : "n/a"}
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-400">Rejection Reason Counts</h2>
        <div className="mt-2 space-y-1 text-sm text-slate-300">
          {Object.entries(d?.rejectionReasonCounts ?? {}).map(([key, value]) => (
            <p key={key}>{key}: {value}</p>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-400">Top Rejections</h2>
        <div className="mt-2 space-y-1 text-sm text-slate-300">
          {(payload?.topRejected ?? []).slice(0, 12).map((row) => (
            <p key={`${row.ticker}-${row.reason}`}>{row.ticker}: {row.reason}</p>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-400">Pipeline Counts</h2>
        <div className="mt-2 space-y-1 text-sm text-slate-300">
          {Object.entries(payload?.pipelineCounts ?? {}).map(([key, value]) => (
            <p key={key}>{key}: {value ?? "n/a"}</p>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-400">Alert Counts By Ticker</h2>
        <div className="mt-2 space-y-1 text-sm text-slate-300">
          {(payload?.alertCountsByTicker ?? []).map((row) => (
            <p key={row.ticker}>{row.ticker}: {row.count}</p>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-400">Missing Data Fields</h2>
        <div className="mt-2 space-y-1 text-sm text-slate-300">
          <p>float unavailable: {payload?.missingDataFields?.floatUnavailable ?? 0}</p>
          <p>CTB unavailable: {payload?.missingDataFields?.ctbUnavailable ?? 0}</p>
          <p>SI unavailable: {payload?.missingDataFields?.siUnavailable ?? 0}</p>
          <p>halt unavailable: {payload?.missingDataFields?.haltUnavailable ?? 0}</p>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-400">Active Universe Tickers</h2>
        <p className="mt-2 text-sm text-slate-300">{payload?.dynamicUniverse?.activeUniverseTickers?.join(", ") || payload?.dynamicUniverse?.topSymbols?.join(", ") || "none"}</p>
        <p className="mt-2 text-sm text-slate-300">Rejected ETF symbols: {(d?.rejectedEtfSymbols ?? payload?.dynamicUniverse?.rejectedEtfSymbols ?? []).slice(0, 20).join(", ") || "none"}</p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-400">Top 20 Candidates</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-[900px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="pr-4">Ticker</th>
                <th className="pr-4">Price</th>
                <th className="pr-4">Change %</th>
                <th className="pr-4">Volume</th>
                <th className="pr-4">RVOL</th>
                <th className="pr-4">Reason</th>
              </tr>
            </thead>
            <tbody>
              {(d?.topCandidates ?? []).slice(0, 20).map((row) => (
                <tr key={row.ticker} className="border-t border-white/10">
                  <td className="py-2 pr-4">{row.ticker}</td>
                  <td className="py-2 pr-4">{row.price.toFixed(2)}</td>
                  <td className="py-2 pr-4">{row.changePercent.toFixed(2)}</td>
                  <td className="py-2 pr-4">{Math.round(row.currentVolume)}</td>
                  <td className="py-2 pr-4">{row.relativeVolume === null ? "n/a" : row.relativeVolume.toFixed(2)}</td>
                  <td className="py-2 pr-4 text-slate-400">{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-400">Active Signals Count</h2>
        <p className="mt-2 text-sm text-slate-300">{payload?.activeSignalsCount ?? 0}</p>
        <p className="mt-1 text-sm text-slate-300">Alert tape count: {payload?.alertsCount ?? payload?.alertTapeCount ?? 0}</p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-400">Emitted Alerts</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-[900px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="pr-4">Ticker</th>
                <th className="pr-4">Type</th>
                <th className="pr-4">Score</th>
                <th className="pr-4">Time</th>
                <th className="pr-4">Line</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.emittedAlerts ?? []).filter((row) => row.alertType !== "TEST").map((row) => (
                <tr key={`${row.ticker}-${row.timestamp}-${row.alertType}`} className="border-t border-white/10">
                  <td className="py-2 pr-4">{row.ticker}</td>
                  <td className="py-2 pr-4">{row.alertType}</td>
                  <td className="py-2 pr-4">{Math.round(row.score)}</td>
                  <td className="py-2 pr-4">{row.timestamp}</td>
                  <td className="py-2 pr-4 text-slate-400">{row.formattedLine ?? "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {(payload?.emittedAlerts ?? []).some((row) => row.alertType === "TEST") ? (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-400">Internal Debug TEST Alerts</h2>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-[900px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400">
                  <th className="pr-4">Ticker</th>
                  <th className="pr-4">Type</th>
                  <th className="pr-4">Score</th>
                  <th className="pr-4">Time</th>
                  <th className="pr-4">Line</th>
                </tr>
              </thead>
              <tbody>
                {(payload?.emittedAlerts ?? []).filter((row) => row.alertType === "TEST").map((row) => (
                  <tr key={`${row.ticker}-${row.timestamp}-${row.alertType}`} className="border-t border-white/10">
                    <td className="py-2 pr-4">{row.ticker}</td>
                    <td className="py-2 pr-4">{row.alertType}</td>
                    <td className="py-2 pr-4">{Math.round(row.score)}</td>
                    <td className="py-2 pr-4">{row.timestamp}</td>
                    <td className="py-2 pr-4 text-slate-400">{row.formattedLine ?? "n/a"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-400">High Tracking</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-[980px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="pr-4">Ticker</th>
                <th className="pr-4">Price</th>
                <th className="pr-4">Day High</th>
                <th className="pr-4">Session High</th>
                <th className="pr-4">Prev Day High</th>
                <th className="pr-4">Prev Session High</th>
                <th className="pr-4">Last Alert High</th>
                <th className="pr-4">Alert Count Today</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.highTracking ?? []).map((row) => (
                <tr key={row.ticker} className="border-t border-white/10">
                  <td className="py-2 pr-4">{row.ticker}</td>
                  <td className="py-2 pr-4">{row.price ?? "n/a"}</td>
                  <td className="py-2 pr-4">{row.dayHigh ?? "n/a"}</td>
                  <td className="py-2 pr-4">{row.sessionHigh ?? "n/a"}</td>
                  <td className="py-2 pr-4">{row.previousDayHigh ?? "n/a"}</td>
                  <td className="py-2 pr-4">{row.previousSessionHigh ?? "n/a"}</td>
                  <td className="py-2 pr-4">{row.lastAlertHigh ?? "n/a"}</td>
                  <td className="py-2 pr-4">{row.alertCountToday}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-400">Suppressed Duplicate Alerts</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-[900px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="pr-4">Time</th>
                <th className="pr-4">Ticker</th>
                <th className="pr-4">Alert Type</th>
                <th className="pr-4">Reason</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.suppressedDuplicateAlerts ?? []).slice(-100).reverse().map((row, idx) => (
                <tr key={`${row.ticker}-${row.time}-${idx}`} className="border-t border-white/10">
                  <td className="py-2 pr-4">{row.time}</td>
                  <td className="py-2 pr-4">{row.ticker}</td>
                  <td className="py-2 pr-4">{row.alertType}</td>
                  <td className="py-2 pr-4 text-slate-400">{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-400">Transition Log</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-[1080px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="pr-4">Time</th>
                <th className="pr-4">Ticker</th>
                <th className="pr-4">Prev Day High</th>
                <th className="pr-4">New Day High</th>
                <th className="pr-4">Prev Session High</th>
                <th className="pr-4">New Session High</th>
                <th className="pr-4">Alert Type</th>
                <th className="pr-4">Emitted</th>
                <th className="pr-4">Suppressed Reason</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.transitionLog ?? []).slice(-200).reverse().map((row, idx) => (
                <tr key={`${row.ticker}-${row.time}-${idx}`} className="border-t border-white/10">
                  <td className="py-2 pr-4">{row.time}</td>
                  <td className="py-2 pr-4">{row.ticker}</td>
                  <td className="py-2 pr-4">{row.previousDayHigh ?? "n/a"}</td>
                  <td className="py-2 pr-4">{row.newDayHigh ?? "n/a"}</td>
                  <td className="py-2 pr-4">{row.previousSessionHigh ?? "n/a"}</td>
                  <td className="py-2 pr-4">{row.newSessionHigh ?? "n/a"}</td>
                  <td className="py-2 pr-4">{row.alertType}</td>
                  <td className="py-2 pr-4">{row.emitted ? "emitted" : "suppressed"}</td>
                  <td className="py-2 pr-4 text-slate-400">{row.suppressedReason ?? "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
