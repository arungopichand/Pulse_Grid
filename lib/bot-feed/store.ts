import type { BotFeedItem } from "./types";

export type PersistedBotFeedState = {
  items: BotFeedItem[];
  lastEmittedAtByKey: Record<string, string>;
};

const MAX_BOT_FEED_ITEMS = 1400;
const DEDUPE_LOOKBACK_MS = 18 * 60 * 60_000;

function sortChronologically(items: BotFeedItem[]) {
  return [...items].sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
}

export function createEmptyBotFeedState(): PersistedBotFeedState {
  return {
    items: [],
    lastEmittedAtByKey: {},
  };
}

export function trimBotFeedState(
  state: PersistedBotFeedState | undefined,
  marketDayKey: string,
  nowMs: number,
): PersistedBotFeedState {
  const source = state ?? createEmptyBotFeedState();
  const items = sortChronologically(source.items)
    .filter((item) => item.marketDayKey === marketDayKey)
    .slice(-MAX_BOT_FEED_ITEMS);

  const lastEmittedAtByKey = Object.fromEntries(
    Object.entries(source.lastEmittedAtByKey).filter(([, timestamp]) => nowMs - new Date(timestamp).getTime() <= DEDUPE_LOOKBACK_MS),
  );

  return {
    items,
    lastEmittedAtByKey,
  };
}

