"use client";

import type { MomentumAlert } from "@/lib/active-now";
import type { BotFeedItem } from "@/lib/bot-feed/types";
import type { AlertClientSettings, SensitivityMode, SoundMode } from "@/lib/alert-reasoning";
import type { Signal } from "@/lib/live-signal-engine";

type LiveAlertsNowProps = {
  items: BotFeedItem[];
  activeAlerts: MomentumAlert[];
  signals: Signal[];
  sessionStatus: "premarket" | "regular" | "after-hours" | "closed";
  operatorStatus: {
    streamStatus: "connected" | "connecting" | "disconnected" | "degraded";
    reconnecting: boolean;
    rateBudgetLimited: boolean;
    activeSymbols: number;
    sensitivityMode: "conservative" | "balanced" | "active";
    minPriceMovePercent: number;
    minVolumeRatioThreshold: number;
    emittedSignalCount: number;
    cooldownSuppressedCount: number;
    maxPerCycleSuppressedCount: number;
    haltGuardSuppressionReasonSummary: string;
    maxSignalsPerCycle: number;
    allowExtendedHoursHalt: boolean;
    lastScanTime: string | null;
  } | null;
  nowMs: number;
  settings: AlertClientSettings;
  onSettingsChange: (next: AlertClientSettings) => void;
  onSelectSymbol: (symbol: string) => void;
};

function controlTone(active: boolean) {
  return active
    ? "border-white/12 bg-white/[0.05] text-slate-100"
    : "border-transparent text-slate-500 hover:border-white/8 hover:text-slate-300";
}

function withSetting<T extends keyof AlertClientSettings>(
  settings: AlertClientSettings,
  key: T,
  value: AlertClientSettings[T],
) {
  return {
    ...settings,
    [key]: value,
  };
}

function moveTone(value: number) {
  return value >= 0 ? "text-emerald-300" : "text-rose-300";
}

function formatMove(value: number) {
  if (Math.abs(value) >= 100 || Math.abs(value - Math.round(value)) < 0.05) {
    return `${Math.round(value)}%`;
  }

  return `${value.toFixed(1)}%`;
}

function joinParts(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part && part.trim().length)).join(" | ");
}

function sourceHeaderText(item: Extract<BotFeedItem, { type: "source_header" }>) {
  return item.subLabel ? `${item.source} | ${item.subLabel} | ${item.timeLabel}` : `${item.source} | ${item.timeLabel}`;
}

function eventMatchesSubFive(item: BotFeedItem) {
  if (item.type === "momentum_alert") {
    return item.priceBucketLabel.includes("< $5") || item.priceBucketLabel.includes("< $2") || item.priceBucketLabel.includes("< $1");
  }

  if (item.type === "symbol_news") {
    return (item.priceBucketLabel ?? "").includes("< $5") || (item.priceBucketLabel ?? "").includes("< $2") || (item.priceBucketLabel ?? "").includes("< $1");
  }

  return true;
}

function eventMatchesFilters(item: BotFeedItem, settings: AlertClientSettings) {
  if (item.type === "source_header" || item.type === "session_marker" || item.type === "summary_event" || item.type === "top_gainer_summary") {
    return true;
  }

  if (settings.onlySubFive && !eventMatchesSubFive(item)) {
    return false;
  }

  if (settings.onlyHaltNews) {
    return item.type === "halt_alert" || item.type === "symbol_news" || item.type === "sec_filing";
  }

  if (settings.onlyHighPriority && (item.priority === "medium" || item.priority === "low")) {
    return false;
  }

  if (item.type === "momentum_alert" && Math.abs(item.movePercent) < settings.minMovePercent) {
    return false;
  }

  return true;
}

function buildVisibleStream(items: BotFeedItem[], activeAlerts: MomentumAlert[], settings: AlertClientSettings) {
  const activeSymbols = new Set(activeAlerts.map((alert) => alert.symbol));
  const filtered = items.filter((item) => {
    if (!eventMatchesFilters(item, settings)) {
      return false;
    }

    if (item.type === "source_header" || item.type === "session_marker" || item.type === "summary_event" || item.type === "top_gainer_summary") {
      return true;
    }

    return "ticker" in item && item.ticker ? activeSymbols.has(item.ticker) : false;
  });

  const recentTail = filtered.slice(-18);
  const compacted: BotFeedItem[] = [];

  for (const item of recentTail) {
    if (item.type === "source_header") {
      const hasFollowingContent = recentTail.slice(recentTail.indexOf(item) + 1).some((candidate) => candidate.type !== "source_header");
      const previous = compacted[compacted.length - 1];
      if (!hasFollowingContent) {
        continue;
      }
      if (previous?.type === "source_header" && previous.source === item.source && previous.timeLabel === item.timeLabel) {
        continue;
      }
    }

    compacted.push(item);
  }

  while (compacted[compacted.length - 1]?.type === "source_header") {
    compacted.pop();
  }

  return compacted;
}

function baseRowTone(isFresh: boolean, faded: boolean) {
  return `${isFresh ? "bg-white/[0.025]" : ""} ${faded ? "opacity-60" : "opacity-100"}`;
}

function renderSignalFallbackRow(signal: Signal, onSelectSymbol: (symbol: string) => void) {
  return (
    <button
      key={`signal-fallback-${signal.id}`}
      type="button"
      onClick={() => onSelectSymbol(signal.ticker)}
      className="block w-full border-b border-white/6 px-1 py-4 text-left transition hover:bg-white/[0.02]"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-base leading-6 text-slate-200 tabular-nums">
        <span className="shrink-0 text-lg font-semibold tracking-[0.08em] text-white">{signal.ticker}</span>
        <span className="shrink-0 text-sm text-slate-500">{signal.priceBucketLabel}</span>
        <span className={`shrink-0 text-base font-semibold ${moveTone(signal.changePercent)}`}>
          {signal.changePercent >= 0 ? "+" : ""}
          {formatMove(signal.changePercent)}
        </span>
        <span className="shrink-0 text-base font-medium text-slate-100">{signal.signalType}</span>
        <span className="shrink-0 text-sm text-slate-500">S{signal.finalScore}</span>
        <span className="shrink-0 text-sm text-slate-500">{signal.confidence}</span>
      </div>
      <p className="mt-1.5 text-sm leading-5 text-slate-500">
        {joinParts([
          signal.alertSummary || signal.reason,
          signal.relativeVolume !== null ? `RVOL ${signal.relativeVolume.toFixed(1)}x` : null,
          signal.exchange,
        ])}
      </p>
    </button>
  );
}

function renderEventRow(item: BotFeedItem, nowMs: number, onSelectSymbol: (symbol: string) => void) {
  if (item.type === "source_header") {
    return (
      <div key={item.id} className="px-1 pt-5 pb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-slate-600 first:pt-1">
        {sourceHeaderText(item)}
      </div>
    );
  }

  if (item.type === "session_marker" || item.type === "summary_event") {
    return (
      <div key={item.id} className="border-b border-white/6 px-1 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400 tabular-nums">
          <span className="text-slate-500">{item.timeLabel}</span>
          <span className="font-medium text-slate-200">{item.label}</span>
          <span>{item.detail}</span>
        </div>
      </div>
    );
  }

  if (item.type === "top_gainer_summary") {
    return (
      <div key={item.id} className="border-b border-white/6 px-1 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400 tabular-nums">
          <span className="text-slate-500">{item.timeLabel}</span>
          <span>{item.summaryText}</span>
        </div>
      </div>
    );
  }

  if (item.type === "momentum_alert") {
    const isFresh = Boolean(item.isFresh && nowMs - new Date(item.timestamp).getTime() <= 15_000);
    const lifecycleLabel =
      item.lifecycleState === "new"
        ? "new"
        : item.lifecycleState === "cooled_down"
          ? "cooled down"
          : item.lifecycleState === "resolved"
            ? "resolved"
            : "active";
    const secondary = joinParts([
      item.severity ? `Severity ${item.severity}` : null,
      `State ${lifecycleLabel}`,
      `${item.confidenceLabel} confidence`,
      ...item.metadataParts,
      item.whyNow,
    ]);

    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onSelectSymbol(item.ticker)}
        className={`block w-full border-b border-white/6 px-1 py-4 text-left transition hover:bg-white/[0.02] ${baseRowTone(isFresh, Boolean(item.isFading))}`}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-base leading-6 text-slate-200 tabular-nums">
          <span className="shrink-0 text-sm text-slate-500">{item.timeLabel}</span>
          <span className="shrink-0 text-lg font-semibold tracking-[0.08em] text-white">{item.ticker}</span>
          <span className="shrink-0 text-sm text-slate-500">{item.priceBucketLabel}</span>
          <span className={`shrink-0 text-base font-semibold ${moveTone(item.movePercent)}`}>
            {item.movePercent >= 0 ? "+" : ""}
            {formatMove(item.movePercent)}
          </span>
          <span className="shrink-0 text-base font-medium text-slate-100">{item.label}</span>
        </div>
        {secondary ? (
          <p className="mt-1.5 text-sm leading-5 text-slate-500 tabular-nums">
            {secondary}
          </p>
        ) : null}
      </button>
    );
  }

  if (item.type === "symbol_news") {
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onSelectSymbol(item.ticker)}
        className="block w-full border-b border-white/6 px-1 py-4 text-left transition hover:bg-white/[0.02]"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-base leading-6 text-slate-200">
          <span className="shrink-0 text-sm text-slate-500 tabular-nums">{item.timeLabel}</span>
          <span className="shrink-0 text-lg font-semibold tracking-[0.08em] text-white">{item.ticker}</span>
          {item.priceBucketLabel ? <span className="shrink-0 text-sm text-slate-500 tabular-nums">{item.priceBucketLabel}</span> : null}
          <span className="shrink-0 text-base font-medium text-slate-100">{item.label}</span>
        </div>
        <p className="mt-1.5 text-base leading-6 text-slate-300">{item.headline}</p>
        <p className="mt-1.5 text-sm leading-5 text-slate-500 tabular-nums">
          {joinParts([...item.metadataParts, `${item.confidenceLabel} confidence`])}
        </p>
      </button>
    );
  }

  if (item.type === "halt_alert") {
    const isPossible = item.reasonLabel?.toLowerCase().includes("possible");
    const haltText =
      item.haltDirection === "UP"
        ? isPossible
          ? "Possible Halt Up"
          : "Halted Up"
        : item.haltDirection === "DOWN"
          ? isPossible
            ? "Possible Halt Down"
            : "Halted Down"
          : "Resumption Watch";
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onSelectSymbol(item.ticker)}
        className="block w-full border-b border-white/6 px-1 py-4 text-left transition hover:bg-white/[0.02]"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-base leading-6 text-slate-200 tabular-nums">
          <span className="shrink-0 text-sm text-slate-500">{item.timeLabel}</span>
          <span className="shrink-0 text-lg font-semibold tracking-[0.08em] text-white">{item.ticker}</span>
          <span className="shrink-0 text-base font-medium text-amber-100">
            {haltText}
          </span>
          {item.priceLabel ? <span className="shrink-0 text-base text-slate-300">{item.priceLabel}</span> : null}
        </div>
        <p className="mt-1.5 text-sm leading-5 text-slate-500 tabular-nums">
          {joinParts([item.reasonLabel, ...item.metadataParts])}
        </p>
      </button>
    );
  }

  if (item.type === "sec_filing") {
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onSelectSymbol(item.ticker)}
        className="block w-full border-b border-white/6 px-1 py-4 text-left transition hover:bg-white/[0.02]"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-base leading-6 text-slate-200 tabular-nums">
          <span className="shrink-0 text-sm text-slate-500">{item.timeLabel}</span>
          <span className="shrink-0 text-lg font-semibold tracking-[0.08em] text-white">{item.ticker}</span>
          <span className="shrink-0 text-base font-medium text-slate-100">{item.formLabel}</span>
        </div>
        <p className="mt-1.5 text-sm leading-5 text-slate-500">{item.linkText}</p>
      </button>
    );
  }

  return null;
}

export function LiveAlertsNow({
  items,
  activeAlerts,
  signals,
  sessionStatus,
  operatorStatus,
  nowMs,
  settings,
  onSettingsChange,
  onSelectSymbol,
}: LiveAlertsNowProps) {
  const visibleItems = buildVisibleStream(items, activeAlerts, settings);
  const hasActionableRows = visibleItems.some((item) => item.type !== "source_header" && item.type !== "session_marker" && item.type !== "summary_event" && item.type !== "top_gainer_summary");
  const fallbackSignals = !hasActionableRows ? signals.slice(0, 8) : [];
  const operatorLabel = operatorStatus
    ? joinParts([
        `Session ${sessionStatus}`,
        `Stream ${operatorStatus.streamStatus}`,
        operatorStatus.reconnecting ? "Reconnecting" : null,
        operatorStatus.rateBudgetLimited ? "API budget limited" : "API budget ok",
        `Mode ${operatorStatus.sensitivityMode}`,
        `Move >=${operatorStatus.minPriceMovePercent.toFixed(1)}%`,
        `RVOL >=${operatorStatus.minVolumeRatioThreshold.toFixed(1)}x`,
        `Emitted ${operatorStatus.emittedSignalCount}`,
        `CD suppress ${operatorStatus.cooldownSuppressedCount}`,
        `Cap suppress ${operatorStatus.maxPerCycleSuppressedCount}`,
        operatorStatus.haltGuardSuppressionReasonSummary,
        `${operatorStatus.activeSymbols} symbols`,
        `Max/cycle ${operatorStatus.maxSignalsPerCycle}`,
        operatorStatus.allowExtendedHoursHalt ? "Ext-hours halt ON" : "Ext-hours halt OFF",
        operatorStatus.lastScanTime ? `Last scan ${new Date(operatorStatus.lastScanTime).toLocaleTimeString()}` : "Last scan n/a",
      ])
    : null;

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 border-b border-white/6 pb-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">
              Live Alerts Now
            </div>
            <p className="mt-1 text-sm text-slate-400">
              {activeAlerts.length} active names | {visibleItems.filter((item) => item.type !== "source_header").length} live rows
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-500">
            {(["tight", "balanced", "early"] as SensitivityMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onSettingsChange(withSetting(settings, "sensitivityMode", mode))}
                className={`rounded-full border px-3 py-1 transition ${controlTone(settings.sensitivityMode === mode)}`}
              >
                {mode}
              </button>
            ))}

            {(["off", "important", "all"] as SoundMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onSettingsChange(withSetting(settings, "soundMode", mode))}
                className={`rounded-full border px-3 py-1 transition ${controlTone(settings.soundMode === mode)}`}
              >
                snd {mode}
              </button>
            ))}

            <label className="inline-flex items-center gap-2 rounded-full border border-transparent px-3 py-1 text-slate-500 transition hover:border-white/8 hover:text-slate-300">
              <span>toast</span>
              <input
                type="checkbox"
                checked={settings.toastNotifications}
                onChange={(event) => onSettingsChange(withSetting(settings, "toastNotifications", event.target.checked))}
                className="h-3.5 w-3.5 accent-cyan-300"
              />
            </label>

            <label className="inline-flex items-center gap-2 rounded-full border border-transparent px-3 py-1 text-slate-500 transition hover:border-white/8 hover:text-slate-300">
              <span>browser</span>
              <input
                type="checkbox"
                checked={settings.browserNotifications}
                onChange={(event) => onSettingsChange(withSetting(settings, "browserNotifications", event.target.checked))}
                className="h-3.5 w-3.5 accent-cyan-300"
              />
            </label>
          </div>
        </div>
      </div>

      {operatorLabel ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-slate-400">
          {operatorLabel}
        </div>
      ) : null}

      <div>
        {visibleItems.length ? (
          visibleItems.map((item) => renderEventRow(item, nowMs, onSelectSymbol))
        ) : (
          <div className="px-1 py-6 text-sm text-slate-500">
            No active momentum alerts meet the current settings right now.
          </div>
        )}

        {fallbackSignals.length ? (
          <div className="pt-4">
            <div className="px-1 pb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-600">
              Current signals
            </div>
            {fallbackSignals.map((signal) => renderSignalFallbackRow(signal, onSelectSymbol))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
