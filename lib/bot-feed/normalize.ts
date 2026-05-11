import { getMarketDayKey } from "@/lib/feed/day-boundary";
import type { MomentumAlert } from "@/lib/active-now";
import type { LiveEvent } from "@/lib/live-events";
import type { Signal } from "@/lib/live-signal-engine";
import { createEmptyBotFeedState, trimBotFeedState, type PersistedBotFeedState } from "./store";
import type {
  BotFeedItem,
  BotFeedPriority,
  HaltAlertItem,
  MomentumAlertItem,
  SecFilingItem,
  SessionMarkerItem,
  SourceHeaderItem,
  SummaryEventItem,
  SymbolNewsItem,
  TopGainerSummaryItem,
} from "./types";

type BuildBotFeedParams = {
  previousState?: PersistedBotFeedState;
  observedAt: string;
  sessionStatus: "premarket" | "regular" | "after-hours" | "closed";
  sessionLabel: string;
  signals: Signal[];
  liveAlertsNow: MomentumAlert[];
  events: LiveEvent[];
};

const SOURCE_HEADER_GAP_MS = 6 * 60_000;
const SUMMARY_DEDUPE_WINDOW_MS = 10 * 60_000;
const TOP_GAINER_DEDUPE_WINDOW_MS = 5 * 60_000;
const SESSION_DEDUPE_WINDOW_MS = 18 * 60 * 60_000;
const SEC_DEDUPE_WINDOW_MS = 90 * 60_000;

function roundMetric(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatClock(timestamp: string, withSeconds = false) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    hour12: false,
  }).format(new Date(timestamp));
}

function formatHeaderTime(timestamp: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(timestamp));
}

function formatPriceLabel(price: number) {
  return `$${roundMetric(price, price >= 10 ? 2 : 3)}`;
}

function priorityFromAlert(alert: MomentumAlert): BotFeedPriority {
  if (alert.notificationPriority === "high") return "high";
  if (alert.notificationPriority === "medium") return "medium";
  return "low";
}

function sessionMarkerCopy(status: BuildBotFeedParams["sessionStatus"]) {
  if (status === "premarket") {
    return {
      label: "Premarket Open",
      detail: "Live momentum tape is tracking premarket expansion and catalyst flow.",
    };
  }

  if (status === "regular") {
    return {
      label: "Market Open",
      detail: "Regular session is live. Breakouts, NHOD pressure, and reclaims will print here.",
    };
  }

  if (status === "after-hours" || status === "closed") {
    return {
      label: "Market Close",
      detail: "Regular session has ended. After-hours continuation and wrap-up rows remain in the stream.",
    };
  }

  return {
    label: "Session Update",
    detail: "Live session status changed.",
  };
}

function buildSummaryDetail(alerts: MomentumAlert[]) {
  const highConfidence = alerts.filter((alert) => alert.confidenceLabel === "High").length;
  const halts = alerts.filter((alert) =>
    alert.alertLabel === "Halted Up" ||
    alert.alertLabel === "Halted Down" ||
    alert.alertLabel === "Possible Halt Up" ||
    alert.alertLabel === "Possible Halt Down" ||
    alert.alertLabel === "Resumption Watch",
  ).length;
  const newsSpikes = alerts.filter((alert) => alert.alertLabel === "News Spike" || alert.alertLabel === "News Pending").length;

  return `${highConfidence} high-confidence alerts, ${halts} halts, ${newsSpikes} news-backed names`;
}

function topGainerSummary(signals: Signal[]) {
  const top = [...signals]
    .filter((signal) => signal.changePercent >= 20)
    .sort((left, right) => right.changePercent - left.changePercent)
    .slice(0, 3);

  if (!top.length) {
    return null;
  }

  return {
    text: `Top Gainers: ${top.map((signal) => `${signal.ticker} ${signal.changePercent >= 0 ? "+" : ""}${Math.round(signal.changePercent)}%`).join(", ")}`,
    symbols: top.map((signal) => signal.ticker),
  };
}

export function buildBotFeed(params: BuildBotFeedParams): {
  items: BotFeedItem[];
  nextState: PersistedBotFeedState;
} {
  const marketDayKey = getMarketDayKey(new Date(params.observedAt));
  const observedAtMs = new Date(params.observedAt).getTime();
  const previous = trimBotFeedState(params.previousState ?? createEmptyBotFeedState(), marketDayKey, observedAtMs);
  const signalByTicker = new Map(params.signals.map((signal) => [signal.ticker, signal]));
  const nextItems = [...previous.items];
  const nextDedupe = { ...previous.lastEmittedAtByKey };
  let ordinal = 0;

  function makeId(type: BotFeedItem["type"], timestamp: string) {
    ordinal += 1;
    return `bot-${type}-${new Date(timestamp).getTime()}-${ordinal}`;
  }

  function shouldEmit(dedupeKey: string, timestamp: string, windowMs: number) {
    const previousTimestamp = nextDedupe[dedupeKey];
    if (!previousTimestamp) {
      return true;
    }

    return new Date(timestamp).getTime() - new Date(previousTimestamp).getTime() > windowMs;
  }

  function emit(item: BotFeedItem, windowMs = 0) {
    if (windowMs > 0 && !shouldEmit(item.dedupeKey, item.timestamp, windowMs)) {
      return false;
    }

    nextItems.push(item);
    nextDedupe[item.dedupeKey] = item.timestamp;
    return true;
  }

  function maybeInsertSourceHeader(source: string, timestamp: string, familyKey: string, subLabel?: string) {
    const lastItem = nextItems[nextItems.length - 1];
    const lastHeader = [...nextItems].reverse().find((item) => item.type === "source_header") as SourceHeaderItem | undefined;
    const lastHeaderAtMs = lastHeader ? new Date(lastHeader.timestamp).getTime() : 0;
    const lastHeaderSource = lastHeader?.source ?? "";
    const lastFamily = lastItem ? `${lastItem.source}|${lastItem.type}` : "";
    const nextFamily = `${source}|${familyKey}`;

    if (
      !lastItem ||
      lastHeaderSource !== source ||
      lastFamily !== nextFamily ||
      observedAtMs - lastHeaderAtMs >= SOURCE_HEADER_GAP_MS
    ) {
      emit({
        id: makeId("source_header", timestamp),
        type: "source_header",
        source,
        timeLabel: formatHeaderTime(timestamp),
        subLabel,
        timestamp,
        marketDayKey,
        priority: "low",
        dedupeKey: `source|${source}|${familyKey}|${formatHeaderTime(timestamp)}`,
      } satisfies SourceHeaderItem);
    }
  }

  const sessionCopy = sessionMarkerCopy(params.sessionStatus);
  maybeInsertSourceHeader("PulseGrid", params.observedAt, "session", params.sessionLabel);
  emit({
    id: makeId("session_marker", params.observedAt),
    type: "session_marker",
    source: "PulseGrid",
    timeLabel: formatClock(params.observedAt),
    label: sessionCopy.label,
    detail: sessionCopy.detail,
    timestamp: params.observedAt,
    marketDayKey,
    priority: "low",
    dedupeKey: `session|${marketDayKey}|${params.sessionStatus}`,
  } satisfies SessionMarkerItem, SESSION_DEDUPE_WINDOW_MS);

  for (const alert of params.liveAlertsNow) {
    if (!alert.transitionType) {
      continue;
    }

    const signal = signalByTicker.get(alert.symbol);

    if (
      alert.alertLabel === "Halted Up" ||
      alert.alertLabel === "Halted Down" ||
      alert.alertLabel === "Possible Halt Up" ||
      alert.alertLabel === "Possible Halt Down" ||
      alert.alertLabel === "Resumption Watch"
    ) {
      maybeInsertSourceHeader("PulseGrid", alert.detectedAt, "halt");
      emit({
        id: makeId("halt_alert", alert.detectedAt),
        type: "halt_alert",
        source: "PulseGrid",
        timeLabel: formatClock(alert.detectedAt, true),
        ticker: alert.symbol,
        haltDirection:
          alert.alertLabel === "Halted Up" || alert.alertLabel === "Possible Halt Up"
            ? "UP"
            : alert.alertLabel === "Resumption Watch"
              ? "HALTED"
              : "DOWN",
        reasonLabel:
          alert.alertLabel === "Resumption Watch"
            ? "Resumption watch"
            : alert.alertLabel.startsWith("Possible")
              ? "Possible volatility halt"
              : "Volatility",
        priceLabel: formatPriceLabel(alert.price),
        metadataParts: [...alert.metadataParts, alert.whyNow].filter(Boolean),
        timestamp: alert.detectedAt,
        marketDayKey,
        priority: "high",
        dedupeKey: `halt|${alert.symbol}|${alert.alertLabel}|${Math.round(alert.price * 100)}`,
        rawRef: {
          alertSignalId: alert.signalId,
          signalId: signal?.id,
        },
      } satisfies HaltAlertItem, 2 * 60_000);
      continue;
    }

    if (alert.alertLabel === "News Spike" || alert.alertLabel === "News Pending") {
      maybeInsertSourceHeader("PulseGrid", alert.detectedAt, "symbol_news");
      emit({
        id: makeId("symbol_news", alert.detectedAt),
        type: "symbol_news",
        source: "PulseGrid",
        timeLabel: formatClock(alert.detectedAt),
        ticker: alert.symbol,
        label: alert.alertLabel,
        priceBucketLabel: alert.priceBucketLabel,
        headline: alert.newsHeadline ?? alert.whyNow,
        metadataParts: [...alert.metadataParts, alert.whyNow].filter(Boolean),
        confidenceLabel: alert.confidenceLabel,
        timestamp: alert.detectedAt,
        marketDayKey,
        priority: priorityFromAlert(alert),
        dedupeKey: `news|${alert.symbol}|${alert.alertLabel}|${alert.newsHeadline ?? alert.whyNow}`,
        rawRef: {
          alertSignalId: alert.signalId,
          signalId: signal?.id,
        },
      } satisfies SymbolNewsItem, 45 * 60_000);
      continue;
    }

    maybeInsertSourceHeader("PulseGrid", alert.detectedAt, "momentum");
    emit({
      id: makeId("momentum_alert", alert.detectedAt),
      type: "momentum_alert",
      source: "PulseGrid",
      ticker: alert.symbol,
      timeLabel: formatClock(alert.detectedAt),
      direction: alert.changePercent >= 0 ? "up" : "down",
      priceBucketLabel: alert.priceBucketLabel,
      movePercent: alert.changePercent,
      occurrenceCount: alert.occurrenceCount,
      label: alert.alertLabel,
      whyNow: alert.whyNow,
      metadataParts: alert.metadataParts,
      confidenceLabel: alert.confidenceLabel,
      confidenceScore: alert.confidenceScore,
      severity: alert.severity,
      lifecycleState: signal?.signalState ?? "active",
      isFresh: true,
      isFading: alert.lifecycle === "fading",
      timestamp: alert.detectedAt,
      marketDayKey,
      priority: priorityFromAlert(alert),
      dedupeKey: `momentum|${alert.symbol}|${alert.occurrenceCount}|${alert.alertLabel}|${Math.round(alert.changePercent)}`,
      rawRef: {
        alertSignalId: alert.signalId,
        signalId: signal?.id,
      },
    } satisfies MomentumAlertItem);
  }

  const topGainers = topGainerSummary(params.signals);
  if (topGainers) {
    maybeInsertSourceHeader("PulseGrid", params.observedAt, "summary");
    emit({
      id: makeId("top_gainer_summary", params.observedAt),
      type: "top_gainer_summary",
      source: "PulseGrid",
      timeLabel: formatClock(params.observedAt),
      summaryText: topGainers.text,
      symbols: topGainers.symbols,
      timestamp: params.observedAt,
      marketDayKey,
      priority: "medium",
      dedupeKey: `top-gainers|${marketDayKey}|${new Date(params.observedAt).getHours()}|${Math.floor(new Date(params.observedAt).getMinutes() / 5)}`,
    } satisfies TopGainerSummaryItem, TOP_GAINER_DEDUPE_WINDOW_MS);
  }

  if (params.liveAlertsNow.length > 0) {
    maybeInsertSourceHeader("PulseGrid", params.observedAt, "summary");
    emit({
      id: makeId("summary_event", params.observedAt),
      type: "summary_event",
      source: "PulseGrid",
      timeLabel: formatClock(params.observedAt),
      label: "Summary",
      detail: buildSummaryDetail(params.liveAlertsNow),
      timestamp: params.observedAt,
      marketDayKey,
      priority: "low",
      dedupeKey: `summary|${marketDayKey}|${new Date(params.observedAt).getHours()}|${Math.floor(new Date(params.observedAt).getMinutes() / 10)}`,
    } satisfies SummaryEventItem, SUMMARY_DEDUPE_WINDOW_MS);
  }

  for (const event of params.events) {
    if (event.eventType !== "sec_filing") {
      continue;
    }

    maybeInsertSourceHeader("PulseGrid", event.detectedAt, "sec");
    emit({
      id: makeId("sec_filing", event.detectedAt),
      type: "sec_filing",
      source: "PulseGrid",
      timeLabel: formatClock(event.detectedAt),
      ticker: event.symbol,
      formLabel: "SEC Filing",
      linkText: event.headline ?? event.title,
      timestamp: event.detectedAt,
      marketDayKey,
      priority: event.priority === "high" ? "high" : "medium",
      dedupeKey: `sec|${event.symbol}|${event.headline ?? event.title}`,
      rawRef: {
        eventId: event.id,
        signalId: event.linkedSignal?.signalId,
      },
    } satisfies SecFilingItem, SEC_DEDUPE_WINDOW_MS);
  }

  const nextState = trimBotFeedState(
    {
      items: nextItems,
      lastEmittedAtByKey: nextDedupe,
    },
    marketDayKey,
    observedAtMs,
  );

  return {
    items: nextState.items,
    nextState,
  };
}
