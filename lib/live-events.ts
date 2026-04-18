import type { Signal } from "./live-signal-engine";

export type LiveEventType =
  | "NEWS"
  | "SEC_FILING"
  | "OFFERING"
  | "REVERSE_SPLIT"
  | "HALT"
  | "FDA"
  | "EARNINGS"
  | "PRICE_SPIKE"
  | "VOLUME_SPIKE"
  | "REAPPEAR"
  | "TOP_SETUP"
  | "BULLISH_SIGNAL"
  | "BEARISH_SIGNAL";

export type LiveEventPriority = "high" | "medium" | "low";

export type LiveEvent = {
  id: string;
  symbol: string;
  eventType: LiveEventType;
  title: string;
  summary: string;
  source: "scanner" | "finnhub_news";
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
};

type BuildLiveEventsParams = {
  signals: Signal[];
  previousState: PersistedEventState;
  observedAt: string;
  degraded: boolean;
};

const MAX_RECENT_EVENTS = 80;
const MAX_SNAPSHOT_EVENTS = 28;
const REAPPEAR_ABSENCE_MS = 8 * 60_000;
const EVENT_DEDUP_WINDOW_MS = 50 * 60_000;
const COOLDOWN_MS: Record<LiveEventPriority, number> = {
  high: 3 * 60_000,
  medium: 7 * 60_000,
  low: 12 * 60_000,
};

function getPriorityRank(priority: LiveEventPriority) {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

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
  const roundedScore = candidate.linkedSignal ? Math.round(candidate.linkedSignal.finalScore / 5) * 5 : 0;
  return [
    candidate.symbol,
    candidate.eventType,
    candidate.headline ?? "",
    candidate.linkedSignal?.signalType ?? "",
    String(roundedScore),
    candidate.sentiment ?? "",
  ].join("|");
}

function shouldEmitEvent(params: {
  candidate: EventCandidate;
  dedupHash: string;
  state: PersistedEventState;
  nowMs: number;
}) {
  const { candidate, dedupHash, state, nowMs } = params;

  const seenDuplicate = state.recentEvents.some((event) => {
    if (event.dedupKey !== dedupHash) return false;
    return nowMs - new Date(event.detectedAt).getTime() <= EVENT_DEDUP_WINDOW_MS;
  });
  if (seenDuplicate) {
    return {
      emit: false,
      notify: false,
    };
  }

  const notifyKey = `${candidate.symbol}|${candidate.eventType}`;
  const lastNotify = state.lastNotifiedByKey[notifyKey];
  const cooldown = COOLDOWN_MS[candidate.priority];
  const candidateScore = candidate.linkedSignal?.finalScore ?? 0;
  const candidatePriorityRank = getPriorityRank(candidate.priority);

  if (lastNotify) {
    const withinCooldown = nowMs - new Date(lastNotify.at).getTime() < cooldown;
    const raisedPriority = candidatePriorityRank > getPriorityRank(lastNotify.priority);
    const improvedScore = candidateScore - lastNotify.score >= 12;
    if (withinCooldown && !raisedPriority && !improvedScore) {
      return {
        emit: false,
        notify: false,
      };
    }
  }

  return {
    emit: true,
    notify: true,
  };
}

function shouldNotifyCandidate(candidate: EventCandidate) {
  if (!candidate.notifyEligible) {
    return false;
  }

  if (candidate.degraded || candidate.freshness !== "fresh") {
    return false;
  }

  return true;
}

function toEvent(candidate: EventCandidate, dedupKey: string, notify: boolean, ordinal: number): LiveEvent {
  const eventFields = { ...candidate };
  delete eventFields.notifyEligible;
  return {
    ...eventFields,
    id: `${candidate.symbol}-${candidate.eventType}-${new Date(candidate.detectedAt).getTime()}-${ordinal}`,
    dedupKey,
    notify,
  };
}

export function buildLiveEvents(params: BuildLiveEventsParams): {
  events: LiveEvent[];
  notifications: LiveEvent[];
  nextState: PersistedEventState;
} {
  const nowMs = new Date(params.observedAt).getTime();
  const previous = trimEventState(params.previousState ?? createEmptyEventState(), nowMs);
  const rankedSignals = [...params.signals].sort((a, b) => b.finalScore - a.finalScore);
  const newEvents: LiveEvent[] = [];
  const notifications: LiveEvent[] = [];

  let ordinal = 0;
  const pushCandidate = (candidate: EventCandidate) => {
    const dedupKey = eventDedupHash(candidate);
    const decision = shouldEmitEvent({
      candidate,
      dedupHash: dedupKey,
      state: previous,
      nowMs,
    });
    if (!decision.emit) {
      return;
    }

    const shouldNotify = shouldNotifyCandidate(candidate) && decision.notify !== false;
    ordinal += 1;
    const event = toEvent(candidate, dedupKey, shouldNotify, ordinal);
    newEvents.push(event);
    if (event.notify) {
      notifications.push(event);
      previous.lastNotificationBySymbol[candidate.symbol] = candidate.detectedAt;
    }

    previous.lastNotifiedByKey[`${candidate.symbol}|${candidate.eventType}`] = {
      at: candidate.detectedAt,
      priority: candidate.priority,
      score: candidate.linkedSignal?.finalScore ?? 0,
    };
  };

  for (const [index, signal] of rankedSignals.entries()) {
    const rank = index + 1;
    const previousSignal = previous.lastSignalBySymbol[signal.ticker];
    const scoreDelta = signal.finalScore - (previousSignal?.finalScore ?? 0);
    const wasAbsentLong = previousSignal
      ? nowMs - new Date(previousSignal.lastSeenAt).getTime() >= REAPPEAR_ABSENCE_MS
      : false;

    const linkedSignal = {
      signalId: signal.id,
      signalType: signal.signalType,
      confidence: signal.confidence,
      finalScore: signal.finalScore,
      rank,
      stage: getStage(signal),
    } as const;

    if (rank === 1 && previous.topSymbol !== signal.ticker) {
      pushCandidate({
        symbol: signal.ticker,
        eventType: "TOP_SETUP",
        title: `${signal.ticker} now Top Setup`,
        summary: `Now leading with ${signal.confidence.toLowerCase()} confidence and score ${signal.finalScore}.`,
        source: "scanner",
        detectedAt: params.observedAt,
        publishedAt: null,
        priority: "high",
        sentiment: signal.newsSentiment === "none" ? "neutral" : signal.newsSentiment,
        linkedSignal,
        headline: null,
        freshness: signal.quoteFreshness,
        degraded: signal.degraded || params.degraded,
        notifyEligible: true,
      });
    }

    if ((signal.signalType === "BULLISH" || signal.signalType === "BEARISH") && signal.scoreBreakdown.newsScore > 0 && previousSignal?.signalType !== signal.signalType) {
      pushCandidate({
        symbol: signal.ticker,
        eventType: signal.signalType === "BULLISH" ? "BULLISH_SIGNAL" : "BEARISH_SIGNAL",
        title: `${signal.ticker} ${signal.signalType === "BULLISH" ? "bullish" : "bearish"} signal`,
        summary: `Directional signal is now backed by structured news context.`,
        source: "scanner",
        detectedAt: params.observedAt,
        publishedAt: signal.news.publishedAt,
        priority: "high",
        sentiment: signal.signalType === "BULLISH" ? "bullish" : "bearish",
        linkedSignal,
        headline: signal.news.headline,
        freshness: signal.quoteFreshness,
        degraded: signal.degraded || params.degraded,
        notifyEligible: true,
      });
    }

    if (signal.news.hasNews && signal.news.headline && previousSignal?.newsHeadline !== signal.news.headline) {
      pushCandidate({
        symbol: signal.ticker,
        eventType: "NEWS",
        title: `${signal.ticker} news context updated`,
        summary: signal.news.headline,
        source: "finnhub_news",
        detectedAt: params.observedAt,
        publishedAt: signal.news.publishedAt,
        priority: signal.news.bullishNews || signal.news.bearishNews ? "high" : "medium",
        sentiment: signal.news.bullishNews ? "bullish" : signal.news.bearishNews ? "bearish" : "neutral",
        linkedSignal,
        headline: signal.news.headline,
        freshness: signal.quoteFreshness,
        degraded: signal.degraded || params.degraded,
        notifyEligible: false,
      });
    }

    if (!previousSignal && signal.confidence === "HIGH") {
      pushCandidate({
        symbol: signal.ticker,
        eventType: "PRICE_SPIKE",
        title: `${signal.ticker} high conviction setup`,
        summary: `New high-confluence setup entered the live scanner at score ${signal.finalScore}.`,
        source: "scanner",
        detectedAt: params.observedAt,
        publishedAt: null,
        priority: "high",
        sentiment: signal.newsSentiment === "none" ? "neutral" : signal.newsSentiment,
        linkedSignal,
        headline: null,
        freshness: signal.quoteFreshness,
        degraded: signal.degraded || params.degraded,
        notifyEligible: true,
      });
    }

    if (wasAbsentLong) {
      const strongerReappearance = signal.reappearance.strongerReappearance || scoreDelta >= 8;
      pushCandidate({
        symbol: signal.ticker,
        eventType: "REAPPEAR",
        title: strongerReappearance ? `${signal.ticker} back with stronger momentum` : `${signal.ticker} reappeared`,
        summary: strongerReappearance
          ? `Returned with stronger confluence and score +${scoreDelta}.`
          : `Returned to the live scanner with active confluence.`,
        source: "scanner",
        detectedAt: params.observedAt,
        publishedAt: null,
        priority: strongerReappearance ? "high" : "medium",
        sentiment: signal.newsSentiment === "none" ? "neutral" : signal.newsSentiment,
        linkedSignal,
        headline: null,
        freshness: signal.quoteFreshness,
        degraded: signal.degraded || params.degraded,
        notifyEligible: strongerReappearance,
      });
    }

    if (signal.factors.strongMove && !previousSignal?.strongMove) {
      pushCandidate({
        symbol: signal.ticker,
        eventType: "PRICE_SPIKE",
        title: `${signal.ticker} price spike`,
        summary: `Strong move factor activated at ${signal.changePercent >= 0 ? "+" : ""}${signal.changePercent.toFixed(2)}%.`,
        source: "scanner",
        detectedAt: params.observedAt,
        publishedAt: null,
        priority: signal.factorCount >= 3 ? "high" : "medium",
        sentiment: signal.newsSentiment === "none" ? "neutral" : signal.newsSentiment,
        linkedSignal,
        headline: null,
        freshness: signal.quoteFreshness,
        degraded: signal.degraded || params.degraded,
        notifyEligible: false,
      });
    }

    if (signal.factors.volumeSpike && !previousSignal?.volumeSpike) {
      pushCandidate({
        symbol: signal.ticker,
        eventType: "VOLUME_SPIKE",
        title: `${signal.ticker} volume spike`,
        summary: signal.relativeVolume !== null
          ? `Relative volume is ${signal.relativeVolume.toFixed(2)}x with active setup confluence.`
          : "Volume spike factor activated with active setup confluence.",
        source: "scanner",
        detectedAt: params.observedAt,
        publishedAt: null,
        priority: signal.factorCount >= 3 ? "high" : "medium",
        sentiment: signal.newsSentiment === "none" ? "neutral" : signal.newsSentiment,
        linkedSignal,
        headline: null,
        freshness: signal.quoteFreshness,
        degraded: signal.degraded || params.degraded,
        notifyEligible: false,
      });
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
    notifications: notifications.slice(0, 4),
    nextState,
  };
}
