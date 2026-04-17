"use client";

import type { SignalType } from "@/lib/live-signal-engine";
import { StatusBadge } from "./status-badge";

type FilterBarProps = {
  signalTypes: SignalType[];
  activeSignal: SignalType | "All";
  onSignalChange: (value: SignalType | "All") => void;
  minConfidence: number;
  onMinConfidenceChange: (value: number) => void;
  watchlistOnly: boolean;
  onWatchlistOnlyChange: (value: boolean) => void;
  scanPreset: "Penny Momentum" | "Low Float Catalysts" | "Clean Movers Only" | "High Risk / Fast Tape";
  onScanPresetChange: (value: "Penny Momentum" | "Low Float Catalysts" | "Clean Movers Only" | "High Risk / Fast Tape") => void;
  signalCount: number;
};

export function FilterBar({
  signalTypes,
  activeSignal,
  onSignalChange,
  minConfidence,
  onMinConfidenceChange,
  watchlistOnly,
  onWatchlistOnlyChange,
  scanPreset,
  onScanPresetChange,
  signalCount,
}: FilterBarProps) {
  return (
    <section className="glass-panel grid gap-4 p-4 md:grid-cols-[1.1fr_1fr_1fr_auto] md:items-center">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-slate-400">Focus</p>
        <div className="flex flex-wrap gap-2">
          {(["All", ...signalTypes] as const).map((type) => {
            const selected = activeSignal === type;
            return (
              <button
                key={type}
                onClick={() => onSignalChange(type)}
                className={`rounded-full border px-3 py-2 text-sm transition ${
                  selected
                    ? "border-accent-cyan/30 bg-accent-cyan/12 text-white"
                    : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/8"
                }`}
              >
                {type}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-slate-400">Confidence</p>
          <span className="text-sm text-slate-200">{minConfidence}+</span>
        </div>
        <input
          type="range"
          min={60}
          max={95}
          step={1}
          value={minConfidence}
          onChange={(event) => onMinConfidenceChange(Number(event.target.value))}
          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-cyan-300"
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-slate-400">Preset</p>
        <select
          value={scanPreset}
          onChange={(event) => onScanPresetChange(event.target.value as FilterBarProps["scanPreset"])}
          className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-accent-cyan/40"
        >
          <option value="Penny Momentum">Penny Momentum</option>
          <option value="Low Float Catalysts">Low Float Catalysts</option>
          <option value="Clean Movers Only">Clean Movers Only</option>
          <option value="High Risk / Fast Tape">High Risk / Fast Tape</option>
        </select>
      </div>

      <div className="flex justify-start md:justify-end">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onWatchlistOnlyChange(!watchlistOnly)}
            className={`rounded-full border px-3 py-2 text-sm transition ${
              watchlistOnly
                ? "border-accent-cyan/30 bg-accent-cyan/12 text-white"
                : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/8"
            }`}
          >
            Watchlist
          </button>
          <StatusBadge label={`${signalCount} live`} tone="positive" />
        </div>
      </div>
    </section>
  );
}
