import type { FeedItem } from "./types";

type FeedPersistencePayload = {
  marketDayKey: string;
  items: FeedItem[];
  persistedAt: string;
};

const STORAGE_KEY = "pulsegrid.channel-feed.current-day";

export function loadPersistedFeed(): FeedPersistencePayload | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as FeedPersistencePayload;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function savePersistedFeed(payload: FeedPersistencePayload) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function clearPersistedFeed() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(STORAGE_KEY);
}
