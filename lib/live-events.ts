import type { MomentumAlert } from "./active-now";
import type { Signal } from "./live-signal-engine";

export type LiveEventType =
  | "momentum_alert"
  | "symbol_news"
  | "sec_filing"
  | "halt_alert"
  | "summary_event";

export type LiveEventPriority = "high" | "medium" | "low";

export type LiveEvent = {
  id: string;
  symbol: string;
  eventType: LiveEventType;
  title: string;
  summary: string;
  source: "scanner" | "finnhub_news" | "system";
  detectedAt: string;
  publishedAt: string | null;
  priority: LiveEventPriority;
  sentiment: "bullish" | "bearish" | "neutral" | null;
  linkedSignal: {
    signalId: string;
    signalType: Signal["signalType"];
    confidence: Signal["confidence"];
    finalScore: number;
    rank: number;
    stage: "Early" | "In play" | "Extended";
  } | null;
  headline: string | null;
  freshness: Signal["quoteFreshness"] | "missing";
  degraded: boolean;
  notify: boolean;
  dedupKey: string;
};

export type PersistedEventSignalState = {
  lastSeenAt: string;
  rank: number;
  lastRank: number;
  finalScore: number;
  lastScore: number;
  signalType: Signal["signalType"];
  factorCount: number;
  strongMove: boolean;
  volumeSpike: boolean;
  topOpportunity: boolean;
  newsScore: number;
  newsSentiment: Signal["newsSentiment"];
  newsHeadline: string | null;
};

export type PersistedEventState = {
  recentEvents: LiveEvent[];
  lastNotifiedByKey: Record<string, { at: string; priority: LiveEventPriority; score: number }>;
  lastNotificationBySymbol: Record<string, string>;
  lastSignalBySymbol: Record<string, PersistedEventSignalState>;
  topSymbol: string | null;
};

type EventCandidate = Omit<LiveEvent, "id" | "notify" | "dedupKey"> & {
  notifyEligible?: boolean;
  occurrenceCount?: number;
};

type BuildLiveEventsParams = {
  signals: Signal[];
  liveAlertsNow: MomentumAlert[];
  previousState: PersistedEventState;
  observedAt: string;
  degraded: boolean;
};

const MAX_RECENT_EVENTS = 80;
const MAX_SNAPSHOT_EVENTS = 28;
const EVENT_DEDUP_WINDOW_MS = 50 * 60_000;

function getStage(signal: Signal): "Early" | "In play" | "Extended" {
  const ageSeconds = Math.max(0, Math.round((Date.now() - new Date(signal.timestamp).getTime()) / 1000));
  if (signal.quoteFreshness === "cached") {
    return ageSeconds <= 900 ? "In play" : "Extended";
  }
  if (ageSeconds <= 240) return "Early";
  if (ageSeconds <= 1200) return "In play";
  return "Extended";
}

function createEmptyEventState(): PersistedEventState {
  return {
    recentEvents: [],
    lastNotifiedByKey: {},
    lastNotificationBySymbol: {},
    lastSignalBySymbol: {},
    topSymbol: null,
  };
}

function trimEventState(state: PersistedEventState, nowMs: number) {
  const recentEvents = state.recentEvents
    .filter((event) => nowMs - new Date(event.detectedAt).getTime() <= EVENT_DEDUP_WINDOW_MS * 2)
    .slice(0, MAX_RECENT_EVENTS);

  const lastNotifiedByKey = Object.fromEntries(
    Object.entries(state.lastNotifiedByKey).filter(([, value]) => nowMs - new Date(value.at).getTime() <= EVENT_DEDUP_WINDOW_MS * 2),
  );
  const lastNotificationBySymbol = Object.fromEntries(
    Object.entries(state.lastNotificationBySymbol ?? {}).filter(([, value]) => nowMs - new Date(value).getTime() <= EVENT_DEDUP_WINDOW_MS * 2),
  );

  const lastSignalBySymbol = Object.fromEntries(
    Object.entries(state.lastSignalBySymbol).filter(([, value]) => nowMs - new Date(value.lastSeenAt).getTime() <= 24 * 60 * 60_000),
  );

  return {
    recentEvents,
    lastNotifiedByKey,
    lastNotificationBySymbol,
    lastSignalBySymbol,
    topSymbol: state.topSymbol,
  } satisfies PersistedEventState;
}

function eventDedupHash(candidate: EventCandidate) {
  return [
    candidate.symbol,
    candidate.eventType,
    candidate.occurrenceCount ?? 0,
    candidate.headline ?? "",
    candidate.title,
  ].join("|");
}

function shouldNotifyCandidate(candidate: EventCandidate) {
  if (!candidate.notifyEligible) {
    return false;
  }

  if (candidate.degraded || candidate.freshness !== "fresh") {
    return false;
  }

  return candidate.priority !== "low";
}

function toEvent(candidate: EventCandidate, dedupKey: string, notify: boolean, ordinal: number): LiveEvent {
  const eventFields = { ...candidate };
  delete eventFields.notifyEligible;
  delete eventFields.occurrenceCount;
  return {
    ...eventFields,
    id: `${candidate.symbol}-${candidate.eventType}-${new Date(candidate.detectedAt).getTime()}-${ordinal}`,
    dedupKey,
    notify,
  };
}

function mapAlertToEventType(alert: MomentumAlert): LiveEventType {
  if (
    alert.alertLabel === "Halted Up" ||
    alert.alertLabel === "Halted Down" ||
    alert.alertLabel === "Possible Halt Up" ||
    alert.alertLabel === "Possible Halt Down" ||
    alert.alertLabel === "Resumption Watch"
  ) {
    return "halt_alert";
  }

  if (alert.alertLabel === "News Pending" || alert.alertLabel === "News Spike") {
    return "symbol_news";
  }

  return "momentum_alert";
}

export function buildLiveEvents(params: BuildLiveEventsParams): {
  events: LiveEvent[];
  notifications: LiveEvent[];
  nextState: PersistedEventState;
} {
  const nowMs = new Date(params.observedAt).getTime();
  const previous = trimEventState(params.previousState ?? createEmptyEventState(), nowMs);
  const rankedSignals = [...params.signals].sort((a, b) => b.finalScore - a.finalScore);
  const alertBySymbol = new Map(params.liveAlertsNow.map((alert) => [alert.symbol, alert]));
  const newEvents: LiveEvent[] = [];
  const notifications: LiveEvent[] = [];

  let ordinal = 0;
  for (const [index, signal] of rankedSignals.entries()) {
    const alert = alertBySymbol.get(signal.ticker);
    const rank = index + 1;

    if (alert?.transitionType) {
      const linkedSignal = {
        signalId: signal.id,
        signalType: signal.signalType,
        confidence: signal.confidence,
        finalScore: signal.finalScore,
        rank,
        stage: getStage(signal),
      } as const;
      const candidate: EventCandidate = {
        symbol: signal.ticker,
        eventType: mapAlertToEventType(alert),
        title: `${signal.ticker} ${alert.alertLabel}`,
        summary: `${alert.whyNow}${alert.confidenceLabel ? ` | ${alert.confidenceLabel} confidence` : ""}`,
        source: "scanner",
        detectedAt: alert.detectedAt,
        publishedAt: signal.news.publishedAt,
        priority: alert.notificationPriority,
        sentiment: signal.newsSentiment === "none" ? "neutral" : signal.newsSentiment,
        linkedSignal,
        headline: alert.newsHeadline,
        freshness: signal.quoteFreshness,
        degraded: signal.degraded || params.degraded,
        notifyEligible: true,
        occurrenceCount: alert.occurrenceCount,
      };

      const dedupKey = eventDedupHash(candidate);
      const alreadySeen = previous.recentEvents.some((event) => event.dedupKey === dedupKey);
      if (!alreadySeen) {
        ordinal += 1;
        const shouldNotify = shouldNotifyCandidate(candidate);
        const event = toEvent(candidate, dedupKey, shouldNotify, ordinal);
        newEvents.push(event);
        if (event.notify) {
          notifications.push(event);
          previous.lastNotificationBySymbol[candidate.symbol] = candidate.detectedAt;
          previous.lastNotifiedByKey[`${candidate.symbol}|${candidate.eventType}`] = {
            at: candidate.detectedAt,
            priority: candidate.priority,
            score: candidate.linkedSignal?.finalScore ?? 0,
          };
        }
      }
    }

    previous.lastSignalBySymbol[signal.ticker] = {
      lastSeenAt: params.observedAt,
      rank,
      lastRank: rank,
      finalScore: signal.finalScore,
      lastScore: signal.finalScore,
      signalType: signal.signalType,
      factorCount: signal.factorCount,
      strongMove: signal.factors.strongMove,
      volumeSpike: signal.factors.volumeSpike,
      topOpportunity: rank === 1,
      newsScore: signal.scoreBreakdown.newsScore,
      newsSentiment: signal.newsSentiment,
      newsHeadline: signal.news.headline,
    };
  }

  previous.topSymbol = rankedSignals[0]?.ticker ?? null;
  const recentEvents = [...newEvents, ...previous.recentEvents]
    .sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime())
    .slice(0, MAX_RECENT_EVENTS);

  const nextState = trimEventState(
    {
      ...previous,
      recentEvents,
    },
    nowMs,
  );

  return {
    events: nextState.recentEvents.slice(0, MAX_SNAPSHOT_EVENTS),
    notifications: notifications.slice(0, 6),
    nextState,
  };
}
