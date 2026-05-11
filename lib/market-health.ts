import type { SignalRuntimeConfig } from "./signal-runtime-config";
import type { getLiveSessionRuntimeStatus } from "./live-session-runtime";
import type { getMarketStreamHealth } from "./market-stream";

type MarketStreamHealth = ReturnType<typeof getMarketStreamHealth>;
type LiveSessionRuntimeStatus = ReturnType<typeof getLiveSessionRuntimeStatus>;

export function buildMarketHealthPayload(params: {
  health: MarketStreamHealth;
  runtimeConfig: SignalRuntimeConfig;
  runtimeStatus: LiveSessionRuntimeStatus;
}) {
  const { health, runtimeConfig, runtimeStatus } = params;
  const status = health.status === "idle" ? "disconnected" : health.status;

  return {
    status,
    mode: health.mode,
    lastMessageAt: health.lastMessageAt,
    lastBootstrapAt: health.lastBootstrapAt,
    lastForcedDisconnectAt: health.lastForcedDisconnectAt,
    messagesPerMinute: health.messagesPerMinute,
    reconnectCount: health.reconnectCount,
    reconnectScheduled: health.reconnectScheduled,
    reconnecting: health.reconnecting,
    inBootstrap: health.inBootstrap,
    rateBudgetLimited: health.rateBudgetLimited,
    lastRateBudgetLimitedAt: health.lastRateBudgetLimitedAt,
    universeSize: health.activeUniverseSize,
    subscribedSymbolCount: health.subscribedSymbolCount,
    isStale: health.stale,
    isDegraded: health.degraded,
    uptimeMs: health.uptimeMs,
    streamStarted: health.streamStarted,
    snapshotSymbolCount: health.snapshotSymbolCount,
    wsMessagesReceived: health.wsMessagesReceived,
    wsUpdatesApplied: health.wsUpdatesApplied,
    snapshotUpdatesApplied: health.snapshotUpdatesApplied,
    lastWsUpdateAt: health.lastWsUpdateAt,
    lastSnapshotUpdateAt: health.lastSnapshotUpdateAt,
    statusOnlyStream: health.statusOnlyStream,
    bootstrapping: health.inBootstrap,
    stream: {
      connected: health.connected,
      disconnected: !health.connected,
      reconnecting: health.reconnecting,
    },
    runtime: {
      sessionStatus: runtimeStatus.sessionStatus,
      lastScanTime: runtimeStatus.lastScanAt,
      lastSignalTime: runtimeStatus.lastSignalAt,
      activeUniverseSize: runtimeStatus.activeUniverseSize,
      activeSignalCount: runtimeStatus.activeSignalCount,
      engineDiagnostics: runtimeStatus.engineDiagnostics,
    },
    signalSuppression: {
      emittedSignalCount: runtimeStatus.signalDiagnostics.generated,
      returnedSignalCount: runtimeStatus.signalDiagnostics.returned,
      cooldown: runtimeStatus.signalDiagnostics.suppressedCooldown,
      maxSignalsPerCycle: runtimeStatus.signalDiagnostics.suppressedByMaxSignalsPerCycle,
      possibleHaltSuppressed: runtimeStatus.signalDiagnostics.possibleHaltsSuppressed,
      possibleHaltEmitted: runtimeStatus.signalDiagnostics.possibleHaltsEmitted,
      haltGuardSuppressionReasons: runtimeStatus.signalDiagnostics.haltSuppressionReasons,
      recentHaltGuardSuppressions: runtimeStatus.signalDiagnostics.lastHaltSuppressionReasons,
    },
    config: {
      sensitivityMode: runtimeConfig.sensitivityMode,
      minPriceMovePercent: runtimeConfig.minPriceMovePercent,
      minVolumeRatioThreshold: runtimeConfig.minVolumeRatioThreshold,
      scanIntervalMs: runtimeConfig.scanIntervalMs,
      idleScanIntervalMs: runtimeConfig.idleScanIntervalMs,
      maxSymbolsPerScan: runtimeConfig.maxSymbolsPerScan,
      maxApiCallsPerMinute: runtimeConfig.maxApiCallsPerMinute,
      perSymbolCooldownMs: runtimeConfig.perSymbolCooldownMs,
      staleTickThresholdMs: runtimeConfig.staleTickThresholdMs,
      haltFreezeThresholdMs: runtimeConfig.haltFreezeThresholdMs,
      maxSignalsPerCycle: runtimeConfig.maxSignalsPerCycle,
      allowExtendedHoursHalt: runtimeConfig.allowExtendedHoursHalt,
    },
    serverTime: new Date().toISOString(),
  };
}
