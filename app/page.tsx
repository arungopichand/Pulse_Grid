"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchLiveSessionSnapshot } from "@/lib/market-data";
import type { RunnerAlert } from "@/lib/runner-alerts";

function buildAlertLineFallback(alert: RunnerAlert) {
  const arrow = alert.direction === "up" ? "↑" : alert.direction === "down" ? "↓" : "→";
  return `${alert.alertTime} ${arrow} ${alert.ticker} ${alert.priceBucket} ${alert.alertType}`;
}

function getStatusLine(params: {
  sessionStatus: "premarket" | "regular" | "after-hours" | "closed";
  topSignal: RunnerAlert | null;
  streamConnected: boolean | null;
}) {
  if (params.sessionStatus === "closed") {
    return "Market is closed. Scanner will monitor pre-market activity when available.";
  }
  if (params.streamConnected === false) {
    return "Live stream is reconnecting. Waiting for fresh market data.";
  }
  if (params.topSignal) {
    return `${params.topSignal.ticker} is leading with fresh momentum confirmation.`;
  }
  return "Scanner is live. Waiting for qualifying <$10 momentum setups.";
}

export default function HomePage() {
  const [alerts, setAlerts] = useState<RunnerAlert[]>([]);
  const [sessionStatus, setSessionStatus] = useState<"premarket" | "regular" | "after-hours" | "closed">("closed");
  const [streamConnected, setStreamConnected] = useState<boolean | null>(null);

  const applySnapshot = useCallback((result: Awaited<ReturnType<typeof fetchLiveSessionSnapshot>>) => {
    setAlerts(result.alerts ?? []);
    setSessionStatus(result.sessionStatus);
    setStreamConnected(result.streamHealth?.connected ?? null);
  }, []);

  useEffect(() => {
    let active = true;
    let eventSource: EventSource | null = null;

    const bootstrap = async () => {
      const result = await fetchLiveSessionSnapshot();
      if (!active) return;
      applySnapshot(result);
      eventSource = new EventSource("/api/live-session/events");
      eventSource.addEventListener("snapshot", (event) => {
        if (!active) return;
        const payload = JSON.parse((event as MessageEvent<string>).data) as Awaited<ReturnType<typeof fetchLiveSessionSnapshot>>;
        applySnapshot(payload);
      });
    };

    void bootstrap();
    return () => {
      active = false;
      eventSource?.close();
    };
  }, [applySnapshot]);

  const alertTape = useMemo(() => {
    return [...alerts]
      .filter((alert) => alert.alertType !== "TEST")
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [alerts]);
  const topSignal = alertTape[0] ?? null;
  const statusLine = getStatusLine({ sessionStatus, topSignal, streamConnected });

  return (
    <main className="mx-auto max-w-7xl px-5 py-8 text-slate-100">
      <h1 className="text-3xl font-semibold">PulseGrid Live Scanner</h1>
      <p className="mt-3 text-sm text-slate-300">{statusLine}</p>

      <section className="mt-8 rounded border border-white/10 p-5">
        <p className="text-xs uppercase tracking-[0.15em] text-slate-400">Top Opportunity</p>
        {topSignal ? (
          <div className="mt-4">
            <p className="text-4xl font-semibold">{topSignal.ticker}</p>
            <p className="mt-2 text-sm text-slate-300">
              {topSignal.formattedLine ?? buildAlertLineFallback(topSignal)}
            </p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-400">No active setup yet.</p>
        )}
      </section>

      <section className="mt-8">
        <p className="text-xs uppercase tracking-[0.15em] text-slate-400">Live Alert Tape</p>
        {alertTape.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">No active signals yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400">
                  <th className="pr-4">Time</th>
                  <th className="pr-4">Symbol</th>
                  <th className="pr-4">Signal</th>
                  <th className="pr-4">Alert</th>
                </tr>
              </thead>
              <tbody>
                {alertTape.map((signal) => (
                  <tr key={signal.id} className="border-t border-white/10">
                    <td className="py-2 pr-4 font-semibold">{signal.alertTime}</td>
                    <td className="py-2 pr-4 font-semibold">{signal.ticker}</td>
                    <td className="py-2 pr-4">{signal.alertType}</td>
                    <td className="py-2 pr-4 text-slate-300">{signal.formattedLine || buildAlertLineFallback(signal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
