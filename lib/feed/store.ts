import { getMarketDayKey } from "./day-boundary";
import { clearPersistedFeed, loadPersistedFeed, savePersistedFeed } from "./persist";
import type { FeedItem, FeedItemType, FeedStoreDiagnostics } from "./types";

type FeedStoreState = {
  marketDayKey: string;
  items: FeedItem[];
  diagnostics: FeedStoreDiagnostics;
};

type FeedStoreOptions = {
  maxItems?: number;
  maxPerType?: Partial<Record<FeedItemType, number>>;
};

const DEFAULT_MAX_ITEMS = 900;
const DEFAULT_MAX_PER_TYPE: Record<FeedItemType, number> = {
  signal: 360,
  signal_followup: 220,
  filing: 80,
  news: 140,
  macro_news: 40,
  halt: 50,
  market_marker: 40,
  economic_event: 30,
  summary_line: 60,
  summary_table: 24,
};

function getPerTypeCounts(items: FeedItem[]) {
  return items.reduce<Partial<Record<FeedItemType, number>>>((counts, item) => {
    counts[item.type] = (counts[item.type] ?? 0) + 1;
    return counts;
  }, {});
}

function sortChronologically(items: FeedItem[]) {
  return [...items].sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
}

function trimItems(items: FeedItem[], maxItems: number, maxPerType: Record<FeedItemType, number>) {
  const sorted = sortChronologically(items);
  const kept: FeedItem[] = [];
  const perTypeCounts: Partial<Record<FeedItemType, number>> = {};

  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const item = sorted[index];
    if ((perTypeCounts[item.type] ?? 0) >= maxPerType[item.type]) {
      continue;
    }

    kept.push(item);
    perTypeCounts[item.type] = (perTypeCounts[item.type] ?? 0) + 1;

    if (kept.length >= maxItems) {
      break;
    }
  }

  return kept.reverse();
}

export class CurrentDayFeedStore {
  private readonly maxItems: number;
  private readonly maxPerType: Record<FeedItemType, number>;
  private state: FeedStoreState;
  private dedupeKeys = new Set<string>();
  private itemIds = new Set<string>();

  constructor(options?: FeedStoreOptions) {
    this.maxItems = options?.maxItems ?? DEFAULT_MAX_ITEMS;
    this.maxPerType = {
      ...DEFAULT_MAX_PER_TYPE,
      ...(options?.maxPerType ?? {}),
    };

    const marketDayKey = getMarketDayKey();
    this.state = this.createEmptyState(marketDayKey, false, false);
  }

  private createEmptyState(marketDayKey: string, loadedFromPersistence: boolean, rolloverPurged: boolean): FeedStoreState {
    return {
      marketDayKey,
      items: [],
      diagnostics: {
        marketDayKey,
        itemCount: 0,
        perTypeCounts: {},
        oldestTimestamp: null,
        newestTimestamp: null,
        loadedFromPersistence,
        rolloverPurged,
      },
    };
  }

  private rebuildIndexes() {
    this.dedupeKeys = new Set(this.state.items.map((item) => item.dedupeKey));
    this.itemIds = new Set(this.state.items.map((item) => item.id));
  }

  private updateDiagnostics(loadedFromPersistence = this.state.diagnostics.loadedFromPersistence, rolloverPurged = this.state.diagnostics.rolloverPurged) {
    this.state.diagnostics = {
      marketDayKey: this.state.marketDayKey,
      itemCount: this.state.items.length,
      perTypeCounts: getPerTypeCounts(this.state.items),
      oldestTimestamp: this.state.items[0]?.timestamp ?? null,
      newestTimestamp: this.state.items[this.state.items.length - 1]?.timestamp ?? null,
      loadedFromPersistence,
      rolloverPurged,
    };
  }

  hydrate(now = new Date()) {
    const currentDayKey = getMarketDayKey(now);
    const persisted = loadPersistedFeed();

    if (!persisted) {
      this.state = this.createEmptyState(currentDayKey, false, false);
      this.rebuildIndexes();
      return this.getState();
    }

    if (persisted.marketDayKey !== currentDayKey) {
      clearPersistedFeed();
      this.state = this.createEmptyState(currentDayKey, false, true);
      this.rebuildIndexes();
      return this.getState();
    }

    this.state = {
      marketDayKey: currentDayKey,
      items: trimItems(
        persisted.items.filter((item) => item.marketDayKey === currentDayKey),
        this.maxItems,
        this.maxPerType,
      ),
      diagnostics: {
        marketDayKey: currentDayKey,
        itemCount: 0,
        perTypeCounts: {},
        oldestTimestamp: null,
        newestTimestamp: null,
        loadedFromPersistence: true,
        rolloverPurged: false,
      },
    };
    this.rebuildIndexes();
    this.updateDiagnostics(true, false);
    return this.getState();
  }

  ensureCurrentDay(now = new Date()) {
    const currentDayKey = getMarketDayKey(now);
    if (this.state.marketDayKey === currentDayKey) {
      return false;
    }

    clearPersistedFeed();
    this.state = this.createEmptyState(currentDayKey, false, true);
    this.rebuildIndexes();
    return true;
  }

  append(items: FeedItem[], now = new Date()) {
    const rolled = this.ensureCurrentDay(now);
    const nextItems = items.filter((item) => item.marketDayKey === this.state.marketDayKey)
      .filter((item) => !this.itemIds.has(item.id) && !this.dedupeKeys.has(item.dedupeKey));

    if (!nextItems.length) {
      this.updateDiagnostics(this.state.diagnostics.loadedFromPersistence, rolled || this.state.diagnostics.rolloverPurged);
      return this.getState();
    }

    this.state.items = trimItems([...this.state.items, ...nextItems], this.maxItems, this.maxPerType);
    this.rebuildIndexes();
    this.updateDiagnostics(this.state.diagnostics.loadedFromPersistence, rolled || this.state.diagnostics.rolloverPurged);
    savePersistedFeed({
      marketDayKey: this.state.marketDayKey,
      items: this.state.items,
      persistedAt: new Date().toISOString(),
    });
    return this.getState();
  }

  getState() {
    return {
      marketDayKey: this.state.marketDayKey,
      items: [...this.state.items],
      diagnostics: { ...this.state.diagnostics, perTypeCounts: { ...this.state.diagnostics.perTypeCounts } },
    };
  }
}
