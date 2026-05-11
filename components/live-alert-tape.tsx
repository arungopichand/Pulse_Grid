"use client";

import { useMemo } from "react";
import { LiveAlertRow } from "@/components/live-alert-row";
import { LiveNewsCard } from "@/components/live-news-card";
import type { LiveEvent } from "@/lib/live-events";
import type { Signal } from "@/lib/live-signal-engine";

type LiveCue = "New" | "Rising" | "Cooling" | "Moved up" | "Moved down" | "Back again" | "Reappearing" | "Building";

type LiveAlertTapeProps = {
  signals: Signal[];
  events: LiveEvent[];
  signalUiMeta: Record<string, { liveCue: LiveCue | null; changedAt: number }>;
  nowTick: number;
  onSelectSignal: (signal: Signal) => void;
  onSelectSymbol: (symbol: string) => void;
};

function freshnessRank(signal: Signal) {
  return signal.quoteFreshness === "fresh" ? 2 : 1;
}

export function LiveAlertTape({
  signals,
  events,
  signalUiMeta,
  nowTick,
  onSelectSignal,
  onSelectSymbol,
}: LiveAlertTapeProps) {
  const rankedSignals = useMemo(() => {
    return [...signals].sort((left, right) => {
      const freshnessDelta = freshnessRank(right) - freshnessRank(left);
      if (freshnessDelta !== 0) return freshnessDelta;
      if (right.confidenceScore !== left.confidenceScore) return right.confidenceScore - left.confidenceScore;
      if (right.finalScore !== left.finalScore) return right.finalScore - left.finalScore;
      if ((right.relativeVolume ?? 0) !== (left.relativeVolume ?? 0)) return (right.relativeVolume ?? 0) - (left.relativeVolume ?? 0);
      return right.changePercent - left.changePercent;
    });
  }, [signals]);

  const catalystEvents = useMemo(() => {
    return events
      .filter((event) => event.eventType === "symbol_news" || event.eventType === "momentum_alert")
      .sort((left, right) => new Date(right.detectedAt).getTime() - new Date(left.detectedAt).getTime())
      .slice(0, 4);
  }, [events]);

  if (!rankedSignals.length) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-5 text-sm text-slate-400">
        Waiting for live confluence. New alerts will print here instantly.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/25">
      {rankedSignals.map((signal, index) => {
        const eventInsertIndex = index > 0 && index % 5 === 0 ? Math.floor(index / 5) - 1 : -1;
        const catalyst = eventInsertIndex >= 0 ? catalystEvents[eventInsertIndex] : null;

        return (
          <div key={signal.id}>
            {catalyst ? <LiveNewsCard event={catalyst} onSelectSymbol={onSelectSymbol} /> : null}
            <LiveAlertRow
              signal={signal}
              rank={index + 1}
              onClick={() => onSelectSignal(signal)}
              liveCue={signalUiMeta[signal.id]?.liveCue ?? null}
              recentlyChanged={nowTick - (signalUiMeta[signal.id]?.changedAt ?? 0) < 2400}
            />
          </div>
        );
      })}
    </div>
  );
}
