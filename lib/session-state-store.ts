import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Signal, TickerEvaluationState, WatchlistQuote } from "./live-signal-engine";
import type { PersistedEventState } from "./live-events";
import {
  getStateObjectPath,
  hasSupabaseAdminEnv,
  readJsonFromSupabaseStorage,
  uploadJsonToSupabaseStorage,
} from "./supabase-storage";

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
  finalScore?: number;
  rank?: number;
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
  eventState: PersistedEventState;
  lastUpdated: string | null;
  lastWatchlist: WatchlistQuote[];
  lastSignals: Signal[];
  persistedAt: string | null;
};

export type PersistenceStatus = {
  mode: "supabase_storage" | "file" | "memory" | "none";
  durable: boolean;
  healthy: boolean;
  message: string;
  lastPersistedAt: string | null;
};

type LoadResult = {
  state: PersistedSessionState;
  status: PersistenceStatus;
};

const LOCAL_STATE_FILE = path.join(process.cwd(), ".data", "live-session-state.json");
const DEFAULT_STATE_STORE_KEY = "live-session";
const DEFAULT_PROD_INTERVAL_MS = 300_000;
const DEFAULT_DEV_INTERVAL_MS = 30_000;

let memoryState: PersistedSessionState | null = null;
let memoryStatus: PersistenceStatus | null = null;
let memoryFingerprint: string | null = null;
let memoryStoreKey: string | null = null;

function logStateStore(event: string, details: Record<string, unknown> = {}) {
  console.log("[session-state-store]", event, details);
}

function sanitizeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}

function getEnvBoolean(name: string, defaultValue: boolean) {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

function getEnvNumber(name: string, defaultValue: number) {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return parsed;
}

function isDevelopmentEnvironment() {
  return process.env.NODE_ENV !== "production";
}

function getPersistIntervalMs() {
  return getEnvNumber(
    "STATE_PERSIST_INTERVAL_MS",
    isDevelopmentEnvironment() ? DEFAULT_DEV_INTERVAL_MS : DEFAULT_PROD_INTERVAL_MS,
  );
}

function getStateStoreKey() {
  const raw = process.env.STATE_STORE_KEY?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_STATE_STORE_KEY;
}

function isPersistenceDisabled() {
  return getEnvBoolean("DISABLE_STATE_PERSISTENCE", false);
}

function isLocalFileFallbackEnabled() {
  if (!isDevelopmentEnvironment()) {
    return false;
  }
  return getEnvBoolean("ENABLE_LOCAL_STATE_FILE", false);
}

function canUseSupabaseStore() {
  return hasSupabaseAdminEnv();
}

function createEmptyState(sessionDate: string): PersistedSessionState {
  return {
    sessionDate,
    history: {},
    tickerState: {},
    recentEvaluations: {},
    symbolHealth: {},
    eventState: {
      recentEvents: [],
      lastNotifiedByKey: {},
      lastNotificationBySymbol: {},
      lastSignalBySymbol: {},
      topSymbol: null,
    },
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
          observedHigh: observations.length
            ? observations.reduce(
                (high, observation) => Math.max(high, observation.price),
                observations[0].price,
              )
            : null,
          lastQuoteTimestamp: lastObservation?.observedAt ?? null,
          lastEvaluatedAt: lastObservation?.observedAt ?? null,
          lastSignals: [],
        } satisfies TickerEvaluationState,
      ];
    }),
  );
}

function normalizeStoredState(
  stored: PersistedSessionState,
  sessionDate: string,
): PersistedSessionState {
  if (stored.sessionDate !== sessionDate) {
    return createEmptyState(sessionDate);
  }

  return {
    ...stored,
    history: stored.history ?? {},
    tickerState: migrateTickerState(stored.tickerState, stored.history ?? {}),
    recentEvaluations: stored.recentEvaluations ?? {},
    symbolHealth: stored.symbolHealth ?? {},
    eventState: stored.eventState
      ? {
          ...stored.eventState,
          lastNotifiedByKey: stored.eventState.lastNotifiedByKey ?? {},
          lastNotificationBySymbol:
            stored.eventState.lastNotificationBySymbol ?? {},
          lastSignalBySymbol: stored.eventState.lastSignalBySymbol ?? {},
          topSymbol: stored.eventState.topSymbol ?? null,
          recentEvents: stored.eventState.recentEvents ?? [],
        }
      : {
          recentEvents: [],
          lastNotifiedByKey: {},
          lastNotificationBySymbol: {},
          lastSignalBySymbol: {},
          topSymbol: null,
        },
    lastWatchlist: stored.lastWatchlist ?? [],
    lastSignals: stored.lastSignals ?? [],
  };
}

function buildComparablePayload(state: PersistedSessionState) {
  return {
    sessionDate: state.sessionDate,
    tickerState: Object.fromEntries(
      Object.entries(state.tickerState).map(([ticker, entry]) => [
        ticker,
        {
          observedHigh: entry.observedHigh ?? null,
          lastSignals: entry.lastSignals ?? [],
        },
      ]),
    ),
    recentEvaluations: Object.fromEntries(
      Object.entries(state.recentEvaluations).map(([ticker, evaluations]) => [
        ticker,
        evaluations.slice(0, 20).map((evaluation) => ({
          signalType: evaluation.signalType,
          confidence: evaluation.confidence,
          finalScore: evaluation.finalScore ?? null,
          rank: evaluation.rank ?? null,
        })),
      ]),
    ),
    symbolHealth: Object.fromEntries(
      Object.entries(state.symbolHealth).map(([ticker, health]) => [
        ticker,
        {
          lastHealthyAt: health.lastHealthyAt,
          lastIncludedAt: health.lastIncludedAt,
          coldUntil: health.coldUntil,
          recentOutcomes: health.recentOutcomes
            .slice(0, 6)
            .map((outcome) => outcome.outcome),
        },
      ]),
    ),
    eventState: {
      recentEventIds: state.eventState.recentEvents
        .slice(0, 12)
        .map((event) => event.id),
      topSymbol: state.eventState.topSymbol ?? null,
      lastNotifiedKeys: Object.keys(state.eventState.lastNotifiedByKey ?? {})
        .sort()
        .slice(0, 48),
      lastNotificationSymbols: Object.keys(
        state.eventState.lastNotificationBySymbol ?? {},
      )
        .sort()
        .slice(0, 48),
    },
    lastSignals: state.lastSignals.map((signal) => ({
      id: signal.id,
      ticker: signal.ticker,
      signalType: signal.signalType,
      finalScore: signal.finalScore,
    })),
    watchlistSnapshot: state.lastWatchlist.map((item) => ({
      ticker: item.ticker,
      hasActiveSignal: item.hasActiveSignal,
      scannerScore: item.scannerScore ?? null,
      exclusionReason: item.exclusionReason ?? null,
      freshness: item.freshness,
    })),
  };
}

function getPersistenceFingerprint(state: PersistedSessionState) {
  return JSON.stringify(buildComparablePayload(state));
}

async function loadFromSupabaseStorage(
  stateStoreKey: string,
): Promise<PersistedSessionState | null> {
  const objectPath = getStateObjectPath(stateStoreKey);
  return readJsonFromSupabaseStorage<PersistedSessionState>(objectPath);
}

async function saveToSupabaseStorage(
  stateStoreKey: string,
  state: PersistedSessionState,
): Promise<void> {
  const objectPath = getStateObjectPath(stateStoreKey);
  await uploadJsonToSupabaseStorage(objectPath, state);
}

async function loadFromFile(): Promise<PersistedSessionState | null> {
  try {
    const text = await readFile(LOCAL_STATE_FILE, "utf8");
    return JSON.parse(text) as PersistedSessionState;
  } catch {
    return null;
  }
}

async function saveToFile(state: PersistedSessionState): Promise<void> {
  await mkdir(path.dirname(LOCAL_STATE_FILE), { recursive: true });
  await writeFile(LOCAL_STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function syncMemory(
  stateStoreKey: string,
  state: PersistedSessionState,
  status: PersistenceStatus,
) {
  memoryStoreKey = stateStoreKey;
  memoryState = state;
  memoryStatus = status;
  memoryFingerprint = getPersistenceFingerprint(state);
}

function canReuseMemoryState(sessionDate: string, stateStoreKey: string) {
  if (!memoryState || !memoryStatus) {
    return false;
  }
  return memoryState.sessionDate === sessionDate && memoryStoreKey === stateStoreKey;
}

function createHealthyStatus(
  mode: PersistenceStatus["mode"],
  durable: boolean,
  message: string,
  lastPersistedAt: string | null,
) {
  return createStatus(mode, durable, true, message, lastPersistedAt);
}

export async function loadPersistedSessionState(
  sessionDate: string,
): Promise<LoadResult> {
  const stateStoreKey = getStateStoreKey();

  if (canReuseMemoryState(sessionDate, stateStoreKey)) {
    return {
      state: memoryState as PersistedSessionState,
      status: memoryStatus as PersistenceStatus,
    };
  }

  if (isPersistenceDisabled()) {
    const status = createHealthyStatus(
      "memory",
      false,
      "State persistence is disabled by DISABLE_STATE_PERSISTENCE. Running memory-only.",
      null,
    );
    const state = createEmptyState(sessionDate);
    syncMemory(stateStoreKey, state, status);
    logStateStore("rehydrated", {
      source: "memory_default",
      reason: "persistence_disabled",
      stateStoreKey,
    });
    return { state, status };
  }

  if (canUseSupabaseStore()) {
    try {
      const stored = await loadFromSupabaseStorage(stateStoreKey);
      if (stored) {
        const normalized = normalizeStoredState(stored, sessionDate);
        const status = createHealthyStatus(
          "supabase_storage",
          true,
          "Session state rehydrated from Supabase Storage.",
          normalized.persistedAt,
        );
        syncMemory(stateStoreKey, normalized, status);
        logStateStore("rehydrated", {
          source: "supabase",
          stateStoreKey,
        });
        return { state: normalized, status };
      }

      const status = createHealthyStatus(
        "supabase_storage",
        true,
        "Supabase Storage object not found. Initialized empty state.",
        null,
      );
      const state = createEmptyState(sessionDate);
      syncMemory(stateStoreKey, state, status);
      logStateStore("rehydrated", {
        source: "memory_default",
        reason: "supabase_storage_object_missing",
        stateStoreKey,
      });
      return { state, status };
    } catch (error) {
      logStateStore("supabase_load_failed", {
        error: sanitizeError(error),
        stateStoreKey,
      });
    }
  }

  if (isLocalFileFallbackEnabled()) {
    try {
      const stored = await loadFromFile();
      if (stored) {
        const normalized = normalizeStoredState(stored, sessionDate);
        const status = createHealthyStatus(
          "file",
          false,
          "Session state rehydrated from local fallback file.",
          normalized.persistedAt,
        );
        syncMemory(stateStoreKey, normalized, status);
        logStateStore("rehydrated", {
          source: "local_fallback",
          stateStoreKey,
        });
        return { state: normalized, status };
      }
    } catch (error) {
      logStateStore("file_load_failed", { error: sanitizeError(error) });
    }
  }

  const fallbackStatus = createStatus(
    "memory",
    false,
    true,
    "Durable persistence unavailable. Running memory-only.",
    null,
  );
  const fallbackState = createEmptyState(sessionDate);
  syncMemory(stateStoreKey, fallbackState, fallbackStatus);
  logStateStore("rehydrated", {
    source: "memory_default",
    reason: "durable_store_unavailable",
    stateStoreKey,
  });
  return {
    state: fallbackState,
    status: fallbackStatus,
  };
}

export async function savePersistedSessionState(
  previous: PersistedSessionState,
  next: Omit<PersistedSessionState, "persistedAt">,
): Promise<PersistenceStatus> {
  const stateStoreKey = getStateStoreKey();
  const candidate: PersistedSessionState = {
    ...next,
    persistedAt: previous.persistedAt,
  };

  const nextFingerprint = getPersistenceFingerprint(candidate);
  const lastPersistedAt =
    memoryState?.persistedAt ?? previous.persistedAt ?? null;

  if (isPersistenceDisabled()) {
    const status = createHealthyStatus(
      "memory",
      false,
      "State persistence is disabled by DISABLE_STATE_PERSISTENCE. Running memory-only.",
      lastPersistedAt,
    );
    syncMemory(stateStoreKey, candidate, status);
    logStateStore("persist_skipped", {
      reason: "persistence_disabled",
      stateStoreKey,
    });
    return status;
  }

  if (memoryFingerprint && memoryFingerprint === nextFingerprint) {
    const status =
      memoryStatus ??
      createHealthyStatus(
        "memory",
        false,
        "Persistence skipped because no meaningful state change was detected.",
        lastPersistedAt,
      );
    syncMemory(stateStoreKey, candidate, status);
    logStateStore("persist_skipped", {
      reason: "no_meaningful_change",
      stateStoreKey,
    });
    return status;
  }

  const elapsedMs = lastPersistedAt
    ? Date.now() - new Date(lastPersistedAt).getTime()
    : Number.POSITIVE_INFINITY;
  const persistIntervalMs = getPersistIntervalMs();

  if (elapsedMs < persistIntervalMs) {
    const status =
      memoryStatus ??
      createHealthyStatus(
        "memory",
        false,
        `Persistence throttled by STATE_PERSIST_INTERVAL_MS (${persistIntervalMs}ms).`,
        lastPersistedAt,
      );
    syncMemory(stateStoreKey, candidate, status);
    logStateStore("persist_skipped", {
      reason: "interval_throttled",
      persistIntervalMs,
      stateStoreKey,
    });
    return status;
  }

  const persistedAt = new Date().toISOString();
  const payload: PersistedSessionState = {
    ...candidate,
    persistedAt,
  };

  if (canUseSupabaseStore()) {
    try {
      await saveToSupabaseStorage(stateStoreKey, payload);
      const status = createHealthyStatus(
        "supabase_storage",
        true,
        "Session state persisted to Supabase Storage.",
        persistedAt,
      );
      syncMemory(stateStoreKey, payload, status);
      logStateStore("persist_success", {
        mode: "supabase_storage",
        stateStoreKey,
      });
      return status;
    } catch (error) {
      logStateStore("persist_failure", {
        mode: "supabase_storage",
        error: sanitizeError(error),
        stateStoreKey,
      });
    }
  }

  if (isLocalFileFallbackEnabled()) {
    try {
      await saveToFile(payload);
      const status = createHealthyStatus(
        "file",
        false,
        "Session state persisted to local fallback file.",
        persistedAt,
      );
      syncMemory(stateStoreKey, payload, status);
      logStateStore("persist_success", {
        mode: "file",
        stateStoreKey,
      });
      return status;
    } catch (error) {
      logStateStore("persist_failure", {
        mode: "file",
        error: sanitizeError(error),
        stateStoreKey,
      });
    }
  }

  const status = createStatus(
    "memory",
    false,
    false,
    "Durable persistence unavailable. Continuing in memory-only mode.",
    lastPersistedAt,
  );
  syncMemory(stateStoreKey, candidate, status);
  logStateStore("persist_skipped", {
    reason: "memory_only_fallback",
    stateStoreKey,
  });
  return status;
}

export async function flushPersistedSessionState(): Promise<PersistenceStatus | null> {
  if (!memoryState || !memoryStatus) {
    return null;
  }

  const candidate: PersistedSessionState = {
    ...memoryState,
    persistedAt: null,
  };

  return savePersistedSessionState(memoryState, candidate);
}
