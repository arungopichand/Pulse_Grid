"use client";

import type { FeedSignalItem } from "@/lib/feed/types";
import { formatMarketTimestamp } from "@/lib/feed/day-boundary";
import { scannerRuleTone } from "@/lib/utils";

type FeedRowSignalProps = {
  item: FeedSignalItem;
  onSelectSymbol: (symbol: string) => void;
};

function moveTone(changePercent: number) {
  return changePercent >= 0 ? "text-emerald-300" : "text-rose-300";
}

function normalizeAlertEvent(label: string | null | undefined) {
  if (!label) {
    return "signal";
  }

  switch (label) {
    case "NHOD":
      return "breakout";
    case "PR Spike":
      return "news spike";
    case "Top Gainer":
      return "top gainer";
    case "After Lull":
      return "after lull";
    case "Reappearing":
      return "reappearing";
    case "3 Green Bars":
      return "3 green bars";
    default:
      return label.toLowerCase();
  }
}

function formatConfidenceScore(score: number) {
  return `${Math.round(score)}%`;
}

function formatMomentum(changePercent: number) {
  const rounded = Math.abs(changePercent) >= 10
    ? Math.round(changePercent)
    : Math.round(changePercent * 10) / 10;
  const asText = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
  return `${changePercent >= 0 ? "+" : ""}${asText}%`;
}

function buildReasonFromBadges(item: FeedSignalItem) {
  const reasonParts: string[] = [];
  const badges = item.metadata.reasonBadges.map((badge) => badge.trim());

  if (item.metadata.secondaryReasonLabel) {
    reasonParts.push(item.metadata.secondaryReasonLabel.toLowerCase());
  }

  if (badges.some((badge) => badge.startsWith("Strong Move"))) {
    reasonParts.push("strong move");
  }

  if (badges.some((badge) => badge.startsWith("RVOL"))) {
    reasonParts.push("volume spike");
  }

  if (badges.includes("Bullish News")) {
    reasonParts.push("bullish news support");
  } else if (badges.includes("Bearish News")) {
    reasonParts.push("bearish news pressure");
  } else if (badges.includes("News Context")) {
    reasonParts.push("news context");
  }

  if (badges.includes("TRENDING")) {
    reasonParts.push("trend confirmation");
  }

  const repeatStrength = badges.find((badge) => badge.includes("Repeat Strength"));
  if (repeatStrength) {
    reasonParts.push(repeatStrength.toLowerCase());
  }

  if (!reasonParts.length) {
    return null;
  }

  return Array.from(new Set(reasonParts)).slice(0, 3).join(" + ");
}

function buildFallbackReason(item: FeedSignalItem) {
  const summary = item.metadata.summary || item.text || "";
  const normalized = summary
    .replace(/\bRVOL\s+\d+(\.\d+)?x\b/gi, "")
    .replace(/\bVol\s+[A-Za-z0-9.]+\b/gi, "")
    .replace(/\s+\|\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[|,-\s]+|[|,-\s]+$/g, "");

  return normalized || "criteria met";
}

function buildSignalAlertReason(item: FeedSignalItem) {
  return buildReasonFromBadges(item) ?? buildFallbackReason(item);
}

function buildSignalAlertLine(item: FeedSignalItem) {
  const direction = item.metadata.changePercent >= 0 ? "↑" : "↓";
  const segments = [
    `${item.ticker} ${normalizeAlertEvent(item.metadata.primaryPatternLabel)} ${direction}`,
    `Conf ${formatConfidenceScore(item.metadata.confidenceScore)}`,
    item.metadata.relativeVolumeLabel !== "n/a" ? `Vol ${item.metadata.relativeVolumeLabel}` : null,
    Number.isFinite(item.metadata.changePercent) ? `Mom ${formatMomentum(item.metadata.changePercent)}` : null,
  ].filter((segment): segment is string => Boolean(segment));

  return `${segments.join(" | ")} — ${buildSignalAlertReason(item)}`;
}

export function FeedRowSignal({ item, onSelectSymbol }: FeedRowSignalProps) {
  const alertLine = buildSignalAlertLine(item);

  return (
    <button
      type="button"
      onClick={() => item.ticker && onSelectSymbol(item.ticker)}
      className="w-full px-0.5 py-1.5 text-left transition hover:bg-white/[0.02]"
      title={alertLine}
    >
      <div className="flex items-center gap-3 text-sm leading-6 text-slate-300">
        <span className="w-14 shrink-0 font-mono tabular-nums text-sm text-slate-500">
          {formatMarketTimestamp(item.timestamp)}
        </span>
        <span className={`min-w-0 flex-1 truncate ${moveTone(item.metadata.changePercent)}`}>
          <span className="text-white">{alertLine}</span>
        </span>
        {item.metadata.scannerRuleLabel === "Above Price Limit" ? (
          <span className={`font-mono text-sm ${scannerRuleTone(item.metadata.price)}`}>
            Above Price Limit
          </span>
        ) : null}
      </div>
    </button>
  );
}
