import type { LiveSessionSnapshot } from "@/lib/market-data";
import type { LiveEvent } from "@/lib/live-events";
import type { Signal } from "@/lib/live-signal-engine";
import { formatCompactNumber, formatQuoteFreshness, getDisplayPriceBucketLabel, getScannerRuleLabel, getSignalStageLabel } from "@/lib/utils";
import { formatMarketDateLabel, getMarketDayKey, getMarketPhaseForTime } from "./day-boundary";
import type {
  FeedItem,
  FeedMarketMarkerItem,
  FeedPriority,
  FeedSignalItem,
} from "./types";

function getObservedAt(snapshot: LiveSessionSnapshot) {
  return ("generatedAt" in snapshot ? snapshot.generatedAt : snapshot.lastUpdated) ?? snapshot.lastUpdated ?? new Date().toISOString();
}

function formatFloatLabel(floatShares: number | null) {
  if (!floatShares || floatShares <= 0) {
    return null;
  }

  if (floatShares >= 1_000_000_000) {
    return `${(floatShares / 1_000_000_000).toFixed(1)}B`;
  }

  return `${(floatShares / 1_000_000).toFixed(1)}M`;
}

function formatVolumeLabel(volume: number | null) {
  return volume && Number.isFinite(volume) ? formatCompactNumber(volume) : "n/a";
}

function getSignalStageTags(signal: Signal, observedAt: string) {
  const tags = [
    signal.primaryPatternLabel,
    signal.secondaryReasonLabel,
    getSignalStageLabel({
      timestamp: signal.timestamp,
      quoteFreshness: signal.quoteFreshness,
      nowMs: new Date(observedAt).getTime(),
    }),
  ].filter((value): value is string => Boolean(value));

  return tags.slice(0, 4);
}

function mapEventPriority(priority: LiveEvent["priority"]): FeedPriority {
  if (priority === "high") return "high";
  if (priority === "medium") return "medium";
  return "low";
}

function toSignalFeedItem(signal: Signal, observedAt: string): FeedSignalItem {
  const priceBucketLabel = getDisplayPriceBucketLabel(signal.price, signal.priceBucketLabel);
  const scannerRuleLabel = getScannerRuleLabel(signal.price);
  const marketDayKey = getMarketDayKey(new Date(signal.timestamp));
  const eventTimestamp = new Date(signal.timestamp).getTime();

  return {
    id: `feed-signal-${signal.ticker}-${signal.signalType}-${eventTimestamp}`,
    dedupeKey: `signal|${signal.ticker}|${signal.signalType}|${eventTimestamp}`,
    type: "signal",
    timestamp: signal.timestamp,
    marketDayKey,
    source: "scanner",
    priority: signal.confidence === "HIGH" ? "high" : signal.confidence === "MEDIUM" ? "medium" : "low",
    ticker: signal.ticker,
    headline: `${signal.ticker} ${signal.signalType.toLowerCase()} setup`,
    text: signal.alertSummary || signal.reason,
    metadata: {
      signalType: signal.signalType,
      company: signal.company,
      price: signal.price,
      changePercent: signal.changePercent,
      priceBucketLabel,
      scannerRuleLabel,
      confidence: signal.confidence,
      confidenceScore: signal.confidenceScore,
      finalScore: signal.finalScore,
      quoteFreshness: formatQuoteFreshness(signal.quoteFreshness),
      countryCode: signal.countryCode,
      exchange: signal.exchange,
      floatLabel: formatFloatLabel(signal.floatShares),
      relativeVolumeLabel: signal.relativeVolume !== null ? `${signal.relativeVolume.toFixed(1)}x` : "n/a",
      volumeLabel: formatVolumeLabel(signal.volume),
      stageTags: getSignalStageTags(signal, observedAt),
      primaryPatternLabel: signal.primaryPatternLabel,
      secondaryReasonLabel: signal.secondaryReasonLabel,
      occurrenceCount: signal.occurrenceCount,
      sequenceLabel: signal.sequenceLabel,
      summary: signal.alertSummary || signal.reason,
      reasonBadges: signal.reasonBadges.slice(0, 4),
      themeTags: signal.themeTags.slice(0, 2),
      specialTags: signal.specialTags.slice(0, 4),
      riskFlags: signal.riskFlags.slice(0, 3),
    },
  };
}

function toEventFeedItem(event: LiveEvent): FeedItem {
  const marketDayKey = getMarketDayKey(new Date(event.detectedAt));

  if (event.eventType === "halt_alert") {
    return {
      id: `feed-halt-${event.id}`,
      dedupeKey: `halt|${event.dedupKey}`,
      type: "halt",
      timestamp: event.detectedAt,
      marketDayKey,
      source: "system",
      priority: event.priority === "high" ? "critical" : mapEventPriority(event.priority),
      ticker: event.symbol,
      headline: event.title,
      text: event.summary,
      metadata: {
        haltCode: event.headline ?? event.title,
        linkedTicker: event.symbol,
      },
    };
  }

  if (
    event.eventType === "sec_filing"
    || event.eventType === "symbol_news"
    || event.eventType === "momentum_alert"
    || event.eventType === "summary_event"
  ) {
    const label = event.eventType === "sec_filing"
      ? "SEC filing"
      : event.eventType === "symbol_news"
        ? "PR / news"
        : event.eventType === "summary_event"
          ? "Summary"
          : "Momentum alert";

    return {
      id: `feed-followup-${event.id}`,
      dedupeKey: `followup|${event.dedupKey}`,
      type: "signal_followup",
      timestamp: event.detectedAt,
      marketDayKey,
      source: event.source === "finnhub_news" ? "news" : event.eventType === "sec_filing" ? "filing" : "scanner",
      priority: mapEventPriority(event.priority),
      ticker: event.symbol,
      headline: event.title,
      text: event.summary,
      metadata: {
        eventType: label,
        context: event.headline ?? event.summary,
        linkedTicker: event.symbol,
      },
    };
  }

  return {
    id: `feed-followup-${event.id}`,
    dedupeKey: `followup|${event.dedupKey}`,
    type: "signal_followup",
    timestamp: event.detectedAt,
    marketDayKey,
    source: "scanner",
    priority: mapEventPriority(event.priority),
    ticker: event.symbol,
    headline: event.title,
    text: event.summary,
    metadata: {
      eventType: event.eventType,
      context: event.linkedSignal ? `${event.linkedSignal.signalType} | score ${event.linkedSignal.finalScore}` : "Live scanner follow-up",
      linkedTicker: event.symbol,
    },
  };
}

function buildMarketMarker(snapshot: LiveSessionSnapshot, observedAt: string): FeedMarketMarkerItem {
  const marketDayKey = getMarketDayKey(new Date(observedAt));
  const phase = getMarketPhaseForTime(new Date(observedAt));
  const labelByPhase = {
    premarket: "Premarket",
    regular: "Regular Session",
    "after-hours": "After-Hours",
    closed: "Closed",
  } as const;
  const detailByPhase = {
    premarket: "Scanner is tracking premarket momentum and setup quality.",
    regular: "Opening bell flow, NHOD pressure, and live scanner confluence are active.",
    "after-hours": "After-hours continuation and headline follow-through are active.",
    closed: "Market is closed. Feed remains on the current 04:00 New York session day.",
  } as const;

  return {
    id: `feed-marker-${marketDayKey}-${phase}`,
    dedupeKey: `marker|${marketDayKey}|${phase}`,
    type: "market_marker",
    timestamp: observedAt,
    marketDayKey,
    source: "system",
    priority: "low",
    headline: labelByPhase[phase],
    text: detailByPhase[phase],
    metadata: {
      label: labelByPhase[phase],
      phase,
      detail: `${detailByPhase[phase]} Day: ${formatMarketDateLabel(marketDayKey)}.`,
    },
  };
}

export function normalizeSnapshotToFeedItems(snapshot: LiveSessionSnapshot): FeedItem[] {
  const observedAt = getObservedAt(snapshot);
  const marketDayKey = getMarketDayKey(new Date(observedAt));

  const items: FeedItem[] = [
    buildMarketMarker(snapshot, observedAt),
    ...snapshot.signals.map((signal) => toSignalFeedItem(signal, observedAt)),
    ...snapshot.events.map(toEventFeedItem),
  ];

  return items
    .filter((item) => item.marketDayKey === marketDayKey)
    .filter((item) => item.type === "signal" || item.type === "signal_followup" || item.type === "halt" || item.type === "market_marker")
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
}
