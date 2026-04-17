import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { get, put } from "@vercel/blob";
import type { Signal, TickerEvaluationState, WatchlistQuote } from "./live-signal-engine";

type LegacyObservation = {
  price: number;
  changePercent: number;
  observedAt: string;
};

export type PersistedRecentEvaluation = {
  signalType: string;
  timestamp: string;
  reason: string;
  confidence: number;
};

export type SymbolHealthOutcome =
  | "healthy"
  | "cached"
  | "missing_quote"
  | "stale_quote"
  | "missing_volume"
  | "thin_liquidity"
  | "low_score"
  | "failed_confluence";

export type PersistedSymbolHealth = {
  recentOutcomes: Array<{
    outcome: SymbolHealthOutcome;
    observedAt: string;
  }>;
  lastHealthyAt: string | null;
  lastActiveAt: string | null;
  lastIncludedAt: string | null;
  coldUntil: string | null;
};

export type PersistedSessionState = {
  sessionDate: string;
  history: Record<string, LegacyObservation[]>;
  tickerState: Record<string, TickerEvaluationState>;
  recentEvaluations: Record<string, PersistedRecentEvaluation[]>;
  symbolHealth: Record<string, PersistedSymbolHealth>;
  lastUpdated: string | null;
  lastWatchlist: WatchlistQuote[];
  lastSignals: Signal[];
  persistedAt: string | null;
};

export type PersistenceStatus = {
  mode: "blob" | "file" | "none";
  durable: boolean;
  healthy: boolean;
  message: string;
  lastPersistedAt: string | null;
};

type SessionStateAdapter = {
  mode: PersistenceStatus["mode"];
  durable: boolean;
  load: () => Promise<PersistedSessionState | null>;
  save: (state: PersistedSessionState) => Promise<void>;
};

type LoadResult = {
  state: PersistedSessionState;
  status: PersistenceStatus;
};

const STATE_PATHNAME = "pulsegrid-lite/live-session-state.json";
const LOCAL_STATE_FILE = path.join(process.cwd(), ".data", "live-session-state.json");
const MIN_PERSIST_INTERVAL_MS = 30_000;

function createEmptyState(sessionDate: string): PersistedSessionState {
  return {
    sessionDate,
    history: {},
    tickerState: {},
    recentEvaluations: {},
    symbolHealth: {},
    lastUpdated: null,
    lastWatchlist: [],
    lastSignals: [],
    persistedAt: null,
  };
}

function createStatus(
  mode: PersistenceStatus["mode"],
  durable: boolean,
  healthy: boolean,
  message: string,
  lastPersistedAt: string | null,
): PersistenceStatus {
  return {
    mode,
    durable,
    healthy,
    message,
    lastPersistedAt,
  };
}

function getBlobReadWriteToken() {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() ?? "";
}

function canUseBlobStore() {
  return getBlobReadWriteToken().length > 0;
}

function isDevelopmentEnvironment() {
  return process.env.NODE_ENV !== "production";
}

function createBlobAdapter(): SessionStateAdapter {
  return {
    mode: "blob",
    durable: true,
    async load() {
      const result = await get(STATE_PATHNAME, { access: "private", useCache: false });

      if (!result || result.statusCode !== 200 || !result.stream) {
        return null;
      }

      const text = await new Response(result.stream).text();
      return JSON.parse(text) as PersistedSessionState;
    },
    async save(state) {
      await put(STATE_PATHNAME, JSON.stringify(state), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
      });
    },
  };
}

function createFileAdapter(): SessionStateAdapter {
  return {
    mode: "file",
    durable: false,
    async load() {
      try {
        const text = await readFile(LOCAL_STATE_FILE, "utf8");
        return JSON.parse(text) as PersistedSessionState;
      } catch {
        return null;
      }
    },
    async save(state) {
      await mkdir(path.dirname(LOCAL_STATE_FILE), { recursive: true });
      await writeFile(LOCAL_STATE_FILE, JSON.stringify(state, null, 2), "utf8");
    },
  };
}

function createNoopAdapter(): SessionStateAdapter {
  return {
    mode: "none",
    durable: false,
    async load() {
      return null;
    },
    async save() {
      return;
    },
  };
}

function createAdapter(): SessionStateAdapter {
  if (canUseBlobStore()) {
    return createBlobAdapter();
  }

  if (isDevelopmentEnvironment()) {
    return createFileAdapter();
  }

  return createNoopAdapter();
}

function getObservedHigh(state: TickerEvaluationState | undefined, history: PersistedSessionState["history"][string] | undefined) {
  if (typeof state?.observedHigh === "number") {
    return state.observedHigh;
  }

  if (!history?.length) return null;
  return history.reduce((high, observation) => Math.max(high, observation.price), history[0].price);
}

function migrateTickerState(
  tickerState: PersistedSessionState["tickerState"] | undefined,
  history: PersistedSessionState["history"],
): PersistedSessionState["tickerState"] {
  if (tickerState && Object.keys(tickerState).length > 0) {
    return tickerState;
  }

  return Object.fromEntries(
    Object.entries(history).map(([ticker, observations]) => {
      const lastObservation = observations[observations.length - 1];
      return [
        ticker,
        {
          observedHigh: observations.length ? observations.reduce((high, observation) => Math.max(high, observation.price), observations[0].price) : null,
          lastQuoteTimestamp: lastObservation?.observedAt ?? null,
          lastEvaluatedAt: lastObservation?.observedAt ?? null,
          lastSignals: [],
        } satisfies TickerEvaluationState,
      ];
    }),
  );
}

function shouldPersistState(previous: PersistedSessionState, next: PersistedSessionState) {
  if (!previous.persistedAt) {
    return true;
  }

  const elapsedMs = Date.now() - new Date(previous.persistedAt).getTime();
  if (elapsedMs >= MIN_PERSIST_INTERVAL_MS) {
    return true;
  }

  const previousSignalKey = previous.lastSignals.map((signal) => signal.id).join("|");
  const nextSignalKey = next.lastSignals.map((signal) => signal.id).join("|");
  if (previousSignalKey !== nextSignalKey) {
    return true;
  }

  for (const ticker of new Set([
    ...Object.keys(previous.history),
    ...Object.keys(next.history),
    ...Object.keys(previous.tickerState),
    ...Object.keys(next.tickerState),
    ...Object.keys(previous.symbolHealth),
    ...Object.keys(next.symbolHealth),
  ])) {
    const previousHigh = getObservedHigh(previous.tickerState[ticker], previous.history[ticker]);
    const nextHigh = getObservedHigh(next.tickerState[ticker], next.history[ticker]);
    const previousTimestamp = previous.tickerState[ticker]?.lastQuoteTimestamp ?? previous.history[ticker]?.[previous.history[ticker].length - 1]?.observedAt ?? null;
    const nextTimestamp = next.tickerState[ticker]?.lastQuoteTimestamp ?? next.history[ticker]?.[next.history[ticker].length - 1]?.observedAt ?? null;
    const previousHealth = previous.symbolHealth[ticker];
    const nextHealth = next.symbolHealth[ticker];
    const previousHealthKey = previousHealth
      ? `${previousHealth.lastHealthyAt}|${previousHealth.lastActiveAt}|${previousHealth.lastIncludedAt}|${previousHealth.coldUntil}|${previousHealth.recentOutcomes.map((outcome) => `${outcome.outcome}:${outcome.observedAt}`).join(",")}`
      : "";
    const nextHealthKey = nextHealth
      ? `${nextHealth.lastHealthyAt}|${nextHealth.lastActiveAt}|${nextHealth.lastIncludedAt}|${nextHealth.coldUntil}|${nextHealth.recentOutcomes.map((outcome) => `${outcome.outcome}:${outcome.observedAt}`).join(",")}`
      : "";

    if (previousHigh !== nextHigh || previousTimestamp !== nextTimestamp || previousHealthKey !== nextHealthKey) {
      return true;
    }
  }

  return false;
}

export async function loadPersistedSessionState(sessionDate: string): Promise<LoadResult> {
  const adapter = createAdapter();

  try {
    const stored = await adapter.load();

    if (!stored || stored.sessionDate !== sessionDate) {
      return {
        state: createEmptyState(sessionDate),
        status: createStatus(
          adapter.mode,
          adapter.durable,
          true,
          adapter.mode === "blob"
            ? "Durable session persistence is active via Vercel Blob."
            : adapter.mode === "file"
              ? "Local session persistence is active for development."
              : "Durable session persistence is unavailable in this environment.",
          null,
        ),
      };
    }

    return {
      state: {
        ...stored,
        history: stored.history ?? {},
        tickerState: migrateTickerState(stored.tickerState, stored.history ?? {}),
        recentEvaluations: stored.recentEvaluations ?? {},
        symbolHealth: stored.symbolHealth ?? {},
        lastWatchlist: stored.lastWatchlist ?? [],
        lastSignals: stored.lastSignals ?? [],
      },
      status: createStatus(
        adapter.mode,
        adapter.durable,
        true,
        adapter.mode === "blob"
          ? "Durable session persistence is active via Vercel Blob."
          : adapter.mode === "file"
            ? "Local session persistence is active for development."
            : "Durable session persistence is unavailable in this environment.",
        stored.persistedAt,
      ),
    };
  } catch {
    return {
      state: createEmptyState(sessionDate),
      status: createStatus(
        adapter.mode,
        adapter.durable,
        false,
        adapter.mode === "blob"
          ? "Vercel Blob session persistence is temporarily unavailable."
          : "Local session persistence is temporarily unavailable.",
        null,
      ),
    };
  }
}

export async function savePersistedSessionState(
  previous: PersistedSessionState,
  next: Omit<PersistedSessionState, "persistedAt">,
): Promise<PersistenceStatus> {
  const adapter = createAdapter();
  const candidate: PersistedSessionState = {
    ...next,
    persistedAt: previous.persistedAt,
  };

  if (adapter.mode === "none") {
    return createStatus("none", false, false, "Durable session persistence is not configured in production.", previous.persistedAt);
  }

  if (!shouldPersistState(previous, candidate)) {
    return createStatus(
      adapter.mode,
      adapter.durable,
      true,
      adapter.mode === "blob"
        ? "Durable session persistence is active via Vercel Blob."
        : "Local session persistence is active for development.",
      previous.persistedAt,
    );
  }

  const persistedAt = new Date().toISOString();

  try {
    await adapter.save({
      ...candidate,
      persistedAt,
    });

    return createStatus(
      adapter.mode,
      adapter.durable,
      true,
      adapter.mode === "blob"
        ? "Durable session persistence is active via Vercel Blob."
        : "Local session persistence is active for development.",
      persistedAt,
    );
  } catch {
    return createStatus(
      adapter.mode,
      adapter.durable,
      false,
      adapter.mode === "blob"
        ? "Vercel Blob session persistence write failed. Live evaluation continues without durable session saves."
        : "Local session persistence write failed. Live evaluation continues without local saves.",
      previous.persistedAt,
    );
  }
}
