"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchLiveSessionSnapshot } from "@/lib/market-data";
import type { RunnerAlert } from "@/lib/runner-alerts";

function buildAlertLineFallback(alert: RunnerAlert) {
  const arrow = alert.direction === "up" ? "\u2191" : alert.direction === "down" ? "\u2193" : "\u2192";
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
  type UiAlert = RunnerAlert & {
    retained: boolean;
    retainedReason: string | null;
    retainedAgeMs: number;
    lastSeenAt: number;
  };
  const [alerts, setAlerts] = useState<UiAlert[]>([]);
  const lastNonEmptyAlertAtRef = useRef<number | null>(null);
  const [frontendRetained, setFrontendRetained] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<"premarket" | "regular" | "after-hours" | "closed">("closed");
  const [streamConnected, setStreamConnected] = useState<boolean | null>(null);

  const applySnapshot = useCallback((result: Awaited<ReturnType<typeof fetchLiveSessionSnapshot>>) => {
    const incomingAlerts = (result.alerts ?? []).filter((alert) => alert.alertType !== "TEST");
    setSessionStatus(result.sessionStatus);
    setStreamConnected(result.streamHealth?.connected ?? null);
    const reconnecting = result.streamHealth?.reconnecting ?? false;
    const degraded = result.degraded || (result.streamHealth?.degraded ?? false);
    const now = Date.now();
    const maxPrice = result.scannerDiagnostics?.scannerThresholds?.maxPrice ?? 20;

    setAlerts((previous) => {
      const byKey = new Map(previous.map((item) => [`${item.ticker}-${item.alertType}`, item] as const));
      const nextByKey = new Map<string, UiAlert>();

      for (const alert of incomingAlerts) {
        const key = `${alert.ticker}-${alert.alertType}`;
        nextByKey.set(key, {
          ...alert,
          retained: false,
          retainedReason: null,
          retainedAgeMs: 0,
          lastSeenAt: now,
        });
      }

      for (const [key, prior] of byKey.entries()) {
        if (nextByKey.has(key)) continue;
        const ageMs = now - prior.lastSeenAt;
        const ttlMs = (prior.score ?? 0) >= 85 ? 20 * 60_000 : 10 * 60_000;
        const price = prior.tickerPrice ?? 0;
        const invalidPrice = price > maxPrice;
        const stronglyNegative = (prior.changePercent ?? 0) <= -7;
        if (ageMs > ttlMs || invalidPrice || stronglyNegative) {
          continue;
        }
        nextByKey.set(key, {
          ...prior,
          retained: true,
          retainedReason: "Last valid live signal retained while waiting for next confirmation.",
          retainedAgeMs: ageMs,
        });
      }

      const next = [...nextByKey.values()].sort((a, b) => {
        const scoreDelta = (b.score ?? 0) - (a.score ?? 0);
        if (scoreDelta !== 0) return scoreDelta;
        const changeDelta = (b.changePercent ?? 0) - (a.changePercent ?? 0);
        if (changeDelta !== 0) return changeDelta;
        return a.ticker.localeCompare(b.ticker);
      });

      if (next.length > 0) {
        lastNonEmptyAlertAtRef.current = now;
      }
      return next;
    });

    const canRetain = (degraded || reconnecting) && lastNonEmptyAlertAtRef.current !== null && now - lastNonEmptyAlertAtRef.current <= 60_000;
    setFrontendRetained(canRetain);
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
    return alerts;
  }, [alerts]);
  const topSignal = alertTape[0] ?? null;
  const statusLine = getStatusLine({ sessionStatus, topSignal, streamConnected });

  return (
    <main className="mx-auto max-w-7xl px-5 py-8 text-slate-100">
      <h1 className="text-3xl font-semibold">PulseGrid Live Scanner</h1>
      <p className="mt-3 text-sm text-slate-300">
        {statusLine}
        {streamConnected === false ? " Reconnecting..." : ""}
        {frontendRetained ? " Last live signal retained." : ""}
      </p>

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
            <table className="min-w-[1080px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400">
                  <th className="pr-4">Symbol</th>
                  <th className="pr-4">Event</th>
                  <th className="pr-4">Price Bucket</th>
                  <th className="pr-4">Change</th>
                  <th className="pr-4">Alerts</th>
                  <th className="pr-4">Labels</th>
                  <th className="pr-4">RVol</th>
                  <th className="pr-4">Volume</th>
                  <th className="pr-4">News</th>
                  <th className="pr-4">Alert Line</th>
                </tr>
              </thead>
              <tbody>
                {alertTape.map((signal) => (
                  <tr key={`${signal.ticker}-${signal.alertType}`} className="border-t border-white/10">
                    <td className="py-2 pr-4 font-semibold">{signal.ticker}</td>
                    <td className="py-2 pr-4">{signal.alertType}</td>
                    <td className="py-2 pr-4">{signal.priceBucket}</td>
                    <td className="py-2 pr-4">{signal.changePercent !== null ? `${signal.changePercent >= 0 ? "+" : ""}${signal.changePercent.toFixed(1)}%` : "n/a"}</td>
                    <td className="py-2 pr-4">{signal.alertCountToday}</td>
                    <td className="py-2 pr-4">{signal.alertType === "NHOD" ? "NHOD" : signal.alertType === "GREEN_BARS" ? "3 Green Bars" : signal.alertType === "VOLUME_SPIKE" ? "Volume Burst" : signal.alertType}</td>
                    <td className="py-2 pr-4">{signal.relativeVolume !== null ? `${signal.relativeVolume.toFixed(1)}x` : "n/a"}</td>
                    <td className="py-2 pr-4">{signal.currentVolume !== null ? Math.round(signal.currentVolume).toLocaleString("en-US") : "n/a"}</td>
                    <td className="py-2 pr-4">
                      {signal.newsUrl ? (
                        <a href={signal.newsUrl} target="_blank" rel="noreferrer" className="text-sky-300 underline">
                          Link
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-4 text-slate-300">
                      {signal.formattedLine || buildAlertLineFallback(signal)}
                      {signal.retained ? ` · ${Math.floor((signal.retainedAgeMs ?? 0) / 60000)}m ago · retained` : ""}
                    </td>
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

