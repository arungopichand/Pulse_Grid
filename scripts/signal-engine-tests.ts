import assert from "node:assert/strict";
import {
  evaluateLiveSignals,
  createLiveSignalEngineState,
  getLiveSignalEngineCycleDiagnostics,
  type LiveSignalEngineState,
} from "../lib/live-signal-engine.ts";
import { getSignalRuntimeConfig, resetSignalRuntimeConfigForTests } from "../lib/signal-runtime-config.ts";
import { consumeRateLimitToken, resetRequestRateLimiterForTests } from "../lib/request-rate-limiter.ts";
import { buildMarketHealthPayload } from "../lib/market-health.ts";
import type { QuoteSnapshot } from "../lib/market-data.ts";
import type { VolumeSnapshot } from "../lib/volume-data.ts";
import type { WatchlistTicker } from "../lib/watchlist.ts";
import type { StructuredNewsSnapshot } from "../lib/news-data.ts";

function baseTicker(symbol: string): WatchlistTicker {
  return {
    ticker: symbol,
    company: symbol,
    sector: "Dynamic",
    exchange: "NASDAQ",
    instrumentType: "Common Stock",
    country: "US",
  };
}

function quote(
  symbol: string,
  price: number,
  changePercent: number,
  timestamp: string,
  freshness: QuoteSnapshot["freshness"] = "fresh",
): QuoteSnapshot {
  return {
    ticker: symbol,
    price,
    changePercent,
    timestamp,
    lastUpdated: timestamp,
    freshness,
    provider: "massive",
  };
}

function volume(symbol: string, price: number, changePercent: number, currentVolume: number, averageVolume: number, timestamp: string): VolumeSnapshot {
  return {
    ticker: symbol,
    company: symbol,
    price,
    changePercent,
    currentVolume,
    averageVolume,
    recentBars: [],
    lastUpdated: timestamp,
    freshness: "fresh",
  };
}

function bullishNews(symbol: string, timestamp: string): StructuredNewsSnapshot {
  return {
    ticker: symbol,
    availability: "available",
    hasNews: true,
    bullishNews: true,
    bearishNews: false,
    sentimentScore: 0.8,
    bullishPercent: 72,
    bearishPercent: 8,
    headline: `${symbol} catalyst`,
    source: "Test",
    publishedAt: timestamp,
    provider: "finnhub",
  };
}

function setTestConfig() {
  process.env.SIGNAL_SENSITIVITY = "balanced";
  process.env.SIGNAL_MAX_SIGNALS_PER_CYCLE = "5";
  process.env.SIGNAL_PER_SYMBOL_COOLDOWN_MS = "300000";
  process.env.SIGNAL_MOMENTUM_WINDOW_MS = "180000";
  process.env.SIGNAL_HALT_FREEZE_THRESHOLD_MS = "75000";
  process.env.SIGNAL_STALE_TICK_THRESHOLD_MS = "60000";
  process.env.SIGNAL_MIN_PRICE_MOVE_THRESHOLD = "4";
  process.env.SIGNAL_MIN_VOLUME_RATIO_THRESHOLD = "1.8";
  process.env.SIGNAL_ALLOW_EXTENDED_HOURS_HALT = "false";
  resetSignalRuntimeConfigForTests();
}

function withTempEnv(name: string, value: string | null, callback: () => void) {
  const previous = process.env[name];
  if (value === null) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  resetSignalRuntimeConfigForTests();

  try {
    callback();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
    resetSignalRuntimeConfigForTests();
  }
}

function withTempEnvMap(values: Record<string, string | null>, callback: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, process.env[name]);
    if (value === null) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  resetSignalRuntimeConfigForTests();

  try {
    callback();
  } finally {
    for (const [name, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    resetSignalRuntimeConfigForTests();
  }
}

function runCycle(params: {
  state: LiveSignalEngineState;
  ticker: string;
  observedAt: string;
  quotePrice: number;
  quoteChange: number;
  quoteTimestamp?: string;
  quoteFreshness?: QuoteSnapshot["freshness"];
  currentVolume?: number;
  averageVolume?: number;
  news?: StructuredNewsSnapshot[];
  sessionStatus?: "premarket" | "regular" | "after-hours" | "closed";
  haltGuards?: {
    isStreamReconnecting: boolean;
    isRateLimited: boolean;
  };
}) {
  const quoteTimestamp = params.quoteTimestamp ?? params.observedAt;
  return evaluateLiveSignals({
    state: params.state,
    watchlist: [baseTicker(params.ticker)],
    quotes: [quote(params.ticker, params.quotePrice, params.quoteChange, quoteTimestamp, params.quoteFreshness ?? "fresh")],
    volumeSnapshots: [
      volume(
        params.ticker,
        params.quotePrice,
        params.quoteChange,
        params.currentVolume ?? 400_000,
        params.averageVolume ?? 120_000,
        quoteTimestamp,
      ),
    ],
    newsSnapshots: params.news ?? [],
    observedAt: params.observedAt,
    sessionStatus: params.sessionStatus ?? "regular",
    haltGuards: params.haltGuards ?? {
      isStreamReconnecting: false,
      isRateLimited: false,
    },
  });
}

function testMomentumUp() {
  const state = createLiveSignalEngineState();
  runCycle({
    state,
    ticker: "UPT",
    observedAt: "2026-04-27T14:30:00.000Z",
    quotePrice: 1.0,
    quoteChange: 1.2,
  });
  const result = runCycle({
    state,
    ticker: "UPT",
    observedAt: "2026-04-27T14:32:00.000Z",
    quotePrice: 1.09,
    quoteChange: 9.1,
    currentVolume: 740_000,
    averageVolume: 180_000,
  });

  assert.equal(result.signals.length >= 1, true);
  assert.equal(result.signals[0]?.signalType, "MOMENTUM_UP");
}

function testMomentumDown() {
  const state = createLiveSignalEngineState();
  runCycle({
    state,
    ticker: "DNT",
    observedAt: "2026-04-27T14:30:00.000Z",
    quotePrice: 4.8,
    quoteChange: -1.1,
    currentVolume: 310_000,
    averageVolume: 160_000,
  });
  const result = runCycle({
    state,
    ticker: "DNT",
    observedAt: "2026-04-27T14:32:00.000Z",
    quotePrice: 4.1,
    quoteChange: -14.6,
    currentVolume: 900_000,
    averageVolume: 220_000,
  });

  assert.equal(result.signals.length >= 1, true);
  assert.equal(result.signals[0]?.signalType, "MOMENTUM_DOWN");
}

function testVolumeSurge() {
  const state = createLiveSignalEngineState();
  runCycle({
    state,
    ticker: "VSG",
    observedAt: "2026-04-27T14:30:00.000Z",
    quotePrice: 2.0,
    quoteChange: 1.1,
    currentVolume: 160_000,
    averageVolume: 130_000,
  });
  const result = runCycle({
    state,
    ticker: "VSG",
    observedAt: "2026-04-27T14:31:30.000Z",
    quotePrice: 2.02,
    quoteChange: 2.2,
    currentVolume: 780_000,
    averageVolume: 150_000,
    news: [bullishNews("VSG", "2026-04-27T14:31:00.000Z")],
  });

  assert.equal(result.signals.length >= 1, true);
  assert.equal(result.signals[0]?.signalType, "VOLUME_SURGE");
}

function buildHaltUpPattern(params?: {
  sessionStatus?: "premarket" | "regular" | "after-hours" | "closed";
  haltGuards?: {
    isStreamReconnecting: boolean;
    isRateLimited: boolean;
  };
  lowLiquidity?: boolean;
}) {
  const state = createLiveSignalEngineState();
  runCycle({
    state,
    ticker: "HUP",
    observedAt: "2026-04-27T14:29:00.000Z",
    quotePrice: 1.0,
    quoteChange: 0.9,
    quoteTimestamp: "2026-04-27T14:29:00.000Z",
    currentVolume: 240_000,
    averageVolume: 130_000,
    sessionStatus: params?.sessionStatus ?? "regular",
    haltGuards: params?.haltGuards,
  });
  runCycle({
    state,
    ticker: "HUP",
    observedAt: "2026-04-27T14:30:00.000Z",
    quotePrice: 1.12,
    quoteChange: 12.4,
    quoteTimestamp: "2026-04-27T14:30:00.000Z",
    currentVolume: params?.lowLiquidity ? 80_000 : 1_050_000,
    averageVolume: params?.lowLiquidity ? 90_000 : 180_000,
    sessionStatus: params?.sessionStatus ?? "regular",
    haltGuards: params?.haltGuards,
  });
  return runCycle({
    state,
    ticker: "HUP",
    observedAt: "2026-04-27T14:31:40.000Z",
    quotePrice: 1.22,
    quoteChange: 22.1,
    quoteTimestamp: "2026-04-27T14:30:00.000Z",
    quoteFreshness: "cached",
    currentVolume: params?.lowLiquidity ? 85_000 : 1_180_000,
    averageVolume: params?.lowLiquidity ? 95_000 : 180_000,
    sessionStatus: params?.sessionStatus ?? "regular",
    haltGuards: params?.haltGuards,
  });
}

function buildHaltDownPattern(params?: {
  sessionStatus?: "premarket" | "regular" | "after-hours" | "closed";
  haltGuards?: {
    isStreamReconnecting: boolean;
    isRateLimited: boolean;
  };
}) {
  const state = createLiveSignalEngineState();
  runCycle({
    state,
    ticker: "HDN",
    observedAt: "2026-04-27T14:29:00.000Z",
    quotePrice: 4.4,
    quoteChange: -0.8,
    quoteTimestamp: "2026-04-27T14:29:00.000Z",
    currentVolume: 260_000,
    averageVolume: 160_000,
    sessionStatus: params?.sessionStatus ?? "regular",
    haltGuards: params?.haltGuards,
  });
  runCycle({
    state,
    ticker: "HDN",
    observedAt: "2026-04-27T14:30:00.000Z",
    quotePrice: 3.9,
    quoteChange: -11.3,
    quoteTimestamp: "2026-04-27T14:30:00.000Z",
    currentVolume: 940_000,
    averageVolume: 180_000,
    sessionStatus: params?.sessionStatus ?? "regular",
    haltGuards: params?.haltGuards,
  });
  return runCycle({
    state,
    ticker: "HDN",
    observedAt: "2026-04-27T14:31:40.000Z",
    quotePrice: 3.45,
    quoteChange: -21.6,
    quoteTimestamp: "2026-04-27T14:30:00.000Z",
    quoteFreshness: "cached",
    currentVolume: 1_020_000,
    averageVolume: 185_000,
    sessionStatus: params?.sessionStatus ?? "regular",
    haltGuards: params?.haltGuards,
  });
}

function testTruePossibleHaltUp() {
  const result = buildHaltUpPattern();
  assert.equal(result.signals.length >= 1, true);
  assert.equal(result.signals[0]?.signalType, "POSSIBLE_HALT_UP");
}

function testTruePossibleHaltDown() {
  const result = buildHaltDownPattern();
  assert.equal(result.signals.length >= 1, true);
  assert.equal(result.signals[0]?.signalType, "POSSIBLE_HALT_DOWN");
}

function testMarketClosedSuppressesHalt() {
  const result = buildHaltUpPattern({ sessionStatus: "closed" });
  assert.equal(result.signals.some((signal) => signal.signalType === "POSSIBLE_HALT_UP"), false);
}

function testReconnectSuppressesHalt() {
  const result = buildHaltUpPattern({
    haltGuards: {
      isStreamReconnecting: true,
      isRateLimited: false,
    },
  });
  assert.equal(result.signals.some((signal) => signal.signalType === "POSSIBLE_HALT_UP"), false);
}

function testRateLimitedSuppressesHalt() {
  const result = buildHaltUpPattern({
    haltGuards: {
      isStreamReconnecting: false,
      isRateLimited: true,
    },
  });
  assert.equal(result.signals.some((signal) => signal.signalType === "POSSIBLE_HALT_UP"), false);
}

function testBootstrapGapSuppressesHalt() {
  const state = createLiveSignalEngineState();
  const result = runCycle({
    state,
    ticker: "BOOT",
    observedAt: "2026-04-27T14:31:40.000Z",
    quotePrice: 1.24,
    quoteChange: 24.2,
    quoteTimestamp: "2026-04-27T14:30:00.000Z",
    quoteFreshness: "cached",
    currentVolume: 1_250_000,
    averageVolume: 170_000,
    sessionStatus: "regular",
  });
  assert.equal(result.signals.some((signal) => signal.signalType === "POSSIBLE_HALT_UP"), false);
}

function testLowVolumeStaleSuppressesHalt() {
  const result = buildHaltUpPattern({ lowLiquidity: true });
  assert.equal(result.signals.some((signal) => signal.signalType === "POSSIBLE_HALT_UP"), false);
}

function testStaleNoMoveDoesNotHalt() {
  const state = createLiveSignalEngineState();
  runCycle({
    state,
    ticker: "FLAT",
    observedAt: "2026-04-27T14:29:00.000Z",
    quotePrice: 1.5,
    quoteChange: 0.2,
    quoteTimestamp: "2026-04-27T14:29:00.000Z",
  });
  const result = runCycle({
    state,
    ticker: "FLAT",
    observedAt: "2026-04-27T14:31:00.000Z",
    quotePrice: 1.5,
    quoteChange: 0.2,
    quoteTimestamp: "2026-04-27T14:29:10.000Z",
    currentVolume: 200_000,
    averageVolume: 190_000,
  });

  assert.equal(result.signals.some((signal) => signal.signalType === "POSSIBLE_HALT_UP" || signal.signalType === "POSSIBLE_HALT_DOWN"), false);
}

function testDuplicateSuppressionAndCooldown() {
  const state = createLiveSignalEngineState();
  const first = runCycle({
    state,
    ticker: "DUP",
    observedAt: "2026-04-27T14:30:00.000Z",
    quotePrice: 1.0,
    quoteChange: 1.5,
  });
  const second = runCycle({
    state,
    ticker: "DUP",
    observedAt: "2026-04-27T14:31:00.000Z",
    quotePrice: 1.1,
    quoteChange: 9.8,
    currentVolume: 760_000,
    averageVolume: 180_000,
  });
  const third = runCycle({
    state,
    ticker: "DUP",
    observedAt: "2026-04-27T14:31:40.000Z",
    quotePrice: 1.11,
    quoteChange: 9.9,
    currentVolume: 780_000,
    averageVolume: 180_000,
  });

  assert.equal(first.signals.length, 0);
  assert.equal(second.signals.length >= 1, true);
  assert.equal(third.signals.length, 0);
}

function testMissingDataDoesNotCrash() {
  const state = createLiveSignalEngineState();
  const result = evaluateLiveSignals({
    state,
    watchlist: [baseTicker("MISS")],
    quotes: [],
    volumeSnapshots: [],
    newsSnapshots: [],
    observedAt: "2026-04-27T14:30:00.000Z",
    sessionStatus: "regular",
  });
  assert.equal(result.signals.length, 0);
  assert.equal(result.watchlist[0]?.exclusionReason, "missing_quote");
}

function testRateLimiter() {
  resetRequestRateLimiterForTests();
  const first = consumeRateLimitToken("massive:test", 2, 60_000, 0);
  const second = consumeRateLimitToken("massive:test", 2, 60_000, 1000);
  const third = consumeRateLimitToken("massive:test", 2, 60_000, 2000);
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
}

function testInvalidEnvSafetyClamp() {
  withTempEnv("SIGNAL_SCAN_INTERVAL_MS", "-10", () => {
    const config = getSignalRuntimeConfig();
    assert.equal(config.scanIntervalMs, 1000);
  });

  withTempEnv("SIGNAL_MAX_SIGNALS_PER_CYCLE", "999", () => {
    const config = getSignalRuntimeConfig();
    assert.equal(config.maxSignalsPerCycle, 20);
  });

  withTempEnv("SIGNAL_MIN_PRICE_MOVE_THRESHOLD", "not-a-number", () => {
    const config = getSignalRuntimeConfig();
    assert.equal(config.minPriceMovePercent, 1.5);
  });
}

function runModeSample(mode: "active" | "balanced" | "conservative") {
  const state = createLiveSignalEngineState();
  const watchlist = [baseTicker("SM1"), baseTicker("SM2"), baseTicker("SM3")];

  evaluateLiveSignals({
    state,
    watchlist,
    quotes: [
      quote("SM1", 1.0, 0.2, "2026-04-27T14:30:00.000Z"),
      quote("SM2", 1.2, 0.3, "2026-04-27T14:30:00.000Z"),
      quote("SM3", 2.0, 0.4, "2026-04-27T14:30:00.000Z"),
    ],
    volumeSnapshots: [
      volume("SM1", 1.0, 0.2, 220_000, 160_000, "2026-04-27T14:30:00.000Z"),
      volume("SM2", 1.2, 0.3, 240_000, 170_000, "2026-04-27T14:30:00.000Z"),
      volume("SM3", 2.0, 0.4, 260_000, 180_000, "2026-04-27T14:30:00.000Z"),
    ],
    newsSnapshots: [],
    observedAt: "2026-04-27T14:30:00.000Z",
    sessionStatus: "regular",
  });

  return evaluateLiveSignals({
    state,
    watchlist,
    quotes: [
      quote("SM1", 1.01, 1.0, "2026-04-27T14:31:00.000Z"),
      quote("SM2", 1.215, 1.2, "2026-04-27T14:31:00.000Z"),
      quote("SM3", 2.036, 1.8, "2026-04-27T14:31:00.000Z"),
    ],
    volumeSnapshots: [
      volume("SM1", 1.01, 1.0, 330_000, 220_000, "2026-04-27T14:31:00.000Z"),
      volume("SM2", 1.215, 1.2, 380_000, 240_000, "2026-04-27T14:31:00.000Z"),
      volume("SM3", 2.036, 1.8, 620_000, 280_000, "2026-04-27T14:31:00.000Z"),
    ],
    newsSnapshots: [],
    observedAt: "2026-04-27T14:31:00.000Z",
    sessionStatus: "regular",
  });
}

function testSensitivityModes() {
  let activeCount = 0;
  let balancedCount = 0;
  let conservativeCount = 0;

  withTempEnvMap(
    {
      SIGNAL_SENSITIVITY: "active",
      SIGNAL_MIN_PRICE_MOVE_THRESHOLD: null,
      SIGNAL_MIN_VOLUME_RATIO_THRESHOLD: null,
      SIGNAL_PER_SYMBOL_COOLDOWN_MS: null,
      SIGNAL_MAX_SIGNALS_PER_CYCLE: null,
    },
    () => {
      activeCount = runModeSample("active").signals.length;
    },
  );

  withTempEnvMap(
    {
      SIGNAL_SENSITIVITY: "balanced",
      SIGNAL_MIN_PRICE_MOVE_THRESHOLD: null,
      SIGNAL_MIN_VOLUME_RATIO_THRESHOLD: null,
      SIGNAL_PER_SYMBOL_COOLDOWN_MS: null,
      SIGNAL_MAX_SIGNALS_PER_CYCLE: null,
    },
    () => {
      balancedCount = runModeSample("balanced").signals.length;
    },
  );

  withTempEnvMap(
    {
      SIGNAL_SENSITIVITY: "conservative",
      SIGNAL_MIN_PRICE_MOVE_THRESHOLD: null,
      SIGNAL_MIN_VOLUME_RATIO_THRESHOLD: null,
      SIGNAL_PER_SYMBOL_COOLDOWN_MS: null,
      SIGNAL_MAX_SIGNALS_PER_CYCLE: null,
    },
    () => {
      conservativeCount = runModeSample("conservative").signals.length;
    },
  );

  assert.equal(activeCount > balancedCount, true);
  assert.equal(balancedCount >= 1 && balancedCount <= 2, true);
  assert.equal(conservativeCount < balancedCount, true);
}

function testExtendedHoursDefaultIsFalse() {
  withTempEnv("SIGNAL_ALLOW_EXTENDED_HOURS_HALT", null, () => {
    const config = getSignalRuntimeConfig();
    assert.equal(config.allowExtendedHoursHalt, false);
  });
}

function testMaxSignalsPerCycleEnforced() {
  withTempEnv("SIGNAL_MAX_SIGNALS_PER_CYCLE", "1", () => {
    const state = createLiveSignalEngineState();
    evaluateLiveSignals({
      state,
      watchlist: [baseTicker("MX1"), baseTicker("MX2")],
      quotes: [
        quote("MX1", 1.0, 1.1, "2026-04-27T14:30:00.000Z"),
        quote("MX2", 1.0, 1.2, "2026-04-27T14:30:00.000Z"),
      ],
      volumeSnapshots: [
        volume("MX1", 1.0, 1.1, 220_000, 120_000, "2026-04-27T14:30:00.000Z"),
        volume("MX2", 1.0, 1.2, 230_000, 120_000, "2026-04-27T14:30:00.000Z"),
      ],
      newsSnapshots: [],
      observedAt: "2026-04-27T14:30:00.000Z",
      sessionStatus: "regular",
    });
    const result = evaluateLiveSignals({
      state,
      watchlist: [baseTicker("MX1"), baseTicker("MX2")],
      quotes: [
        quote("MX1", 1.12, 12.2, "2026-04-27T14:31:00.000Z"),
        quote("MX2", 1.15, 15.1, "2026-04-27T14:31:00.000Z"),
      ],
      volumeSnapshots: [
        volume("MX1", 1.12, 12.2, 900_000, 160_000, "2026-04-27T14:31:00.000Z"),
        volume("MX2", 1.15, 15.1, 980_000, 170_000, "2026-04-27T14:31:00.000Z"),
      ],
      newsSnapshots: [],
      observedAt: "2026-04-27T14:31:00.000Z",
      sessionStatus: "regular",
    });

    assert.equal(result.signals.length, 1);
    const diagnostics = getLiveSignalEngineCycleDiagnostics();
    assert.equal(diagnostics.suppressedByMaxSignalsPerCycle >= 1, true);
  });
}

function testHaltSuppressionReasonsCaptured() {
  withTempEnvMap(
    {
      SIGNAL_SENSITIVITY: "active",
      SIGNAL_MIN_PRICE_MOVE_THRESHOLD: null,
      SIGNAL_MIN_VOLUME_RATIO_THRESHOLD: null,
      SIGNAL_PER_SYMBOL_COOLDOWN_MS: null,
      SIGNAL_MAX_SIGNALS_PER_CYCLE: null,
    },
    () => {
      buildHaltUpPattern({
        sessionStatus: "closed",
      });
      const diagnostics = getLiveSignalEngineCycleDiagnostics();
      assert.equal(diagnostics.possibleHaltsSuppressed >= 1, true);
      assert.equal(diagnostics.haltSuppressionReasons.session_closed >= 1, true);
    },
  );
}

function testHealthPayloadSafetyAndRateLimitedState() {
  const payload = buildMarketHealthPayload({
    health: {
      status: "connected",
      connected: true,
      realtime: true,
      mode: "realtime",
      lastMessageAt: "2026-04-27T14:31:00.000Z",
      lastWebSocketConnectAt: "2026-04-27T14:30:59.000Z",
      lastBootstrapAt: "2026-04-27T14:30:00.000Z",
      lastForcedDisconnectAt: null,
      subscribedSymbolCount: 12,
      subscribedTradeCount: 12,
      subscribedAggregateCount: 12,
      activeUniverseSize: 12,
      snapshotSymbolCount: 12,
      messagesPerMinute: 42,
      reconnectCount: 1,
      streamStarted: true,
      uptimeMs: 1000,
      reconnectScheduled: false,
      reconnecting: false,
      inBootstrap: false,
      rateBudgetLimited: true,
      lastRateBudgetLimitedAt: "2026-04-27T14:31:10.000Z",
      stale: false,
      degraded: false,
      wsMessagesReceived: 12,
      wsUpdatesApplied: 8,
      snapshotUpdatesApplied: 4,
      lastWsUpdateAt: "2026-04-27T14:31:08.000Z",
      lastTradeAt: "2026-04-27T14:31:08.000Z",
      lastAggregateAt: "2026-04-27T14:31:07.000Z",
      lastSnapshotUpdateAt: "2026-04-27T14:31:05.000Z",
      wsMessageSamples: [],
      statusOnlyStream: false,
      aggregateUnauthorized: false,
      appStartedAt: "2026-04-27T14:00:00.000Z",
      lastDiscoveryAt: "2026-04-27T14:31:01.000Z",
      lastDiscoveryStatus: "ok:24/12",
      lastUniverseCount: 12,
      startup: {
        massiveKeyConfigured: true,
        discoveryAttempted: true,
        websocketAttempted: true,
      },
    },
    runtimeConfig: getSignalRuntimeConfig(),
    runtimeStatus: {
      streamConnected: true,
      sessionStatus: "regular",
      lastScanAt: "2026-04-27T14:31:10.000Z",
      lastSignalAt: "2026-04-27T14:31:00.000Z",
      activeUniverseSize: 12,
      activeSignalCount: 1,
      scanIntervalMs: 2000,
      maxApiCallsPerMinute: 90,
      maxSymbolsPerScan: 50,
      maxSignalsPerCycle: 2,
      allowExtendedHoursHalt: false,
      signalDiagnostics: getLiveSignalEngineCycleDiagnostics(),
      engineDiagnostics: {
        evaluatedSymbols: 12,
        candidateSignals: 2,
        emittedSignals: 1,
        topRejected: [],
        sampleSnapshots: [],
      },
    },
  });

  const text = JSON.stringify(payload).toLowerCase();
  assert.equal(payload.rateBudgetLimited, true);
  assert.equal(payload.config.sensitivityMode !== undefined, true);
  assert.equal(typeof payload.config.minPriceMovePercent, "number");
  assert.equal(typeof payload.config.minVolumeRatioThreshold, "number");
  assert.equal(typeof payload.signalSuppression.emittedSignalCount, "number");
  assert.equal(text.includes("massive_api_key"), false);
  assert.equal(text.includes("openai_api_key"), false);
  assert.equal(text.includes("supabase_service_role_key"), false);
}

function run() {
  setTestConfig();
  testMomentumUp();
  testMomentumDown();
  testVolumeSurge();
  testTruePossibleHaltUp();
  testTruePossibleHaltDown();
  testMarketClosedSuppressesHalt();
  testReconnectSuppressesHalt();
  testBootstrapGapSuppressesHalt();
  testRateLimitedSuppressesHalt();
  testLowVolumeStaleSuppressesHalt();
  testStaleNoMoveDoesNotHalt();
  testDuplicateSuppressionAndCooldown();
  testMissingDataDoesNotCrash();
  testRateLimiter();
  testInvalidEnvSafetyClamp();
  testExtendedHoursDefaultIsFalse();
  testSensitivityModes();
  testMaxSignalsPerCycleEnforced();
  testHaltSuppressionReasonsCaptured();
  testHealthPayloadSafetyAndRateLimitedState();
  console.log("signal-engine-tests: ok");
}

run();
