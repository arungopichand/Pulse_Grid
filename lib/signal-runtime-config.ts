export type SignalSensitivity = "conservative" | "balanced" | "active";
export type SignalUniverseMode = "all" | "penny";

export type SignalRuntimeConfig = {
  sensitivityMode: SignalSensitivity;
  scanIntervalMs: number;
  idleScanIntervalMs: number;
  activeDemandWindowMs: number;
  maxSymbolsPerScan: number;
  universeRefreshMs: number;
  newsRefreshMs: number;
  maxApiCallsPerMinute: number;
  staleTickThresholdMs: number;
  haltFreezeThresholdMs: number;
  momentumWindowMs: number;
  volumeBaselineWindow: number;
  minPriceMovePercent: number;
  minVolumeRatioThreshold: number;
  perSymbolCooldownMs: number;
  maxSignalsPerCycle: number;
  allowExtendedHoursHalt: boolean;
  signalUniverseMode: SignalUniverseMode;
};

const MODE_DEFAULTS: Record<SignalSensitivity, Pick<SignalRuntimeConfig, "minPriceMovePercent" | "minVolumeRatioThreshold" | "perSymbolCooldownMs" | "maxSignalsPerCycle">> = {
  active: {
    minPriceMovePercent: 0.8,
    minVolumeRatioThreshold: 1.4,
    perSymbolCooldownMs: 90_000,
    maxSignalsPerCycle: 3,
  },
  balanced: {
    minPriceMovePercent: 1.5,
    minVolumeRatioThreshold: 2,
    perSymbolCooldownMs: 3 * 60_000,
    maxSignalsPerCycle: 2,
  },
  conservative: {
    minPriceMovePercent: 2.5,
    minVolumeRatioThreshold: 3,
    perSymbolCooldownMs: 5 * 60_000,
    maxSignalsPerCycle: 2,
  },
};

const DEFAULTS: Omit<SignalRuntimeConfig, "sensitivityMode" | "minPriceMovePercent" | "minVolumeRatioThreshold" | "perSymbolCooldownMs" | "maxSignalsPerCycle"> = {
  scanIntervalMs: 2_000,
  idleScanIntervalMs: 5_000,
  activeDemandWindowMs: 60_000,
  maxSymbolsPerScan: 50,
  universeRefreshMs: 60_000,
  newsRefreshMs: 90_000,
  maxApiCallsPerMinute: 90,
  staleTickThresholdMs: 60_000,
  haltFreezeThresholdMs: 75_000,
  momentumWindowMs: 3 * 60_000,
  volumeBaselineWindow: 8,
  allowExtendedHoursHalt: false,
  signalUniverseMode: "all",
};
const DEFAULT_SENSITIVITY_MODE: SignalSensitivity = "balanced";

function readIntegerEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readFloatEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readBooleanEnv(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function readSensitivityEnv(name: string, fallback: SignalSensitivity): SignalSensitivity {
  const raw = process.env[name];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "conservative" || normalized === "balanced" || normalized === "active") {
    return normalized;
  }
  return fallback;
}

function readUniverseModeEnv(name: string, fallback: SignalUniverseMode): SignalUniverseMode {
  const raw = process.env[name];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "all" || normalized === "penny") {
    return normalized;
  }
  return fallback;
}

let cached: SignalRuntimeConfig | null = null;

export function getSignalRuntimeConfig(): SignalRuntimeConfig {
  if (cached) {
    return cached;
  }

  const sensitivityMode = readSensitivityEnv("SIGNAL_SENSITIVITY", DEFAULT_SENSITIVITY_MODE);
  const modeDefaults = MODE_DEFAULTS[sensitivityMode];
  cached = {
    sensitivityMode,
    scanIntervalMs: readIntegerEnv("SIGNAL_SCAN_INTERVAL_MS", DEFAULTS.scanIntervalMs, 1000, 120_000),
    idleScanIntervalMs: readIntegerEnv("SIGNAL_IDLE_SCAN_INTERVAL_MS", DEFAULTS.idleScanIntervalMs, 2000, 180_000),
    activeDemandWindowMs: readIntegerEnv("SIGNAL_ACTIVE_DEMAND_WINDOW_MS", DEFAULTS.activeDemandWindowMs, 10_000, 600_000),
    maxSymbolsPerScan: readIntegerEnv("SIGNAL_MAX_SYMBOLS_PER_SCAN", DEFAULTS.maxSymbolsPerScan, 10, 200),
    universeRefreshMs: readIntegerEnv("SIGNAL_UNIVERSE_REFRESH_MS", DEFAULTS.universeRefreshMs, 10_000, 10 * 60_000),
    newsRefreshMs: readIntegerEnv("SIGNAL_NEWS_REFRESH_MS", DEFAULTS.newsRefreshMs, 15_000, 10 * 60_000),
    maxApiCallsPerMinute: readIntegerEnv("SIGNAL_MAX_API_CALLS_PER_MINUTE", DEFAULTS.maxApiCallsPerMinute, 10, 300),
    staleTickThresholdMs: readIntegerEnv("SIGNAL_STALE_TICK_THRESHOLD_MS", DEFAULTS.staleTickThresholdMs, 10_000, 5 * 60_000),
    haltFreezeThresholdMs: readIntegerEnv("SIGNAL_HALT_FREEZE_THRESHOLD_MS", DEFAULTS.haltFreezeThresholdMs, 20_000, 10 * 60_000),
    momentumWindowMs: readIntegerEnv("SIGNAL_MOMENTUM_WINDOW_MS", DEFAULTS.momentumWindowMs, 30_000, 10 * 60_000),
    volumeBaselineWindow: readIntegerEnv("SIGNAL_VOLUME_BASELINE_WINDOW", DEFAULTS.volumeBaselineWindow, 3, 30),
    minPriceMovePercent: readFloatEnv("SIGNAL_MIN_PRICE_MOVE_THRESHOLD", modeDefaults.minPriceMovePercent, 0.5, 30),
    minVolumeRatioThreshold: readFloatEnv("SIGNAL_MIN_VOLUME_RATIO_THRESHOLD", modeDefaults.minVolumeRatioThreshold, 1, 20),
    perSymbolCooldownMs: readIntegerEnv("SIGNAL_PER_SYMBOL_COOLDOWN_MS", modeDefaults.perSymbolCooldownMs, 10_000, 30 * 60_000),
    maxSignalsPerCycle: readIntegerEnv("SIGNAL_MAX_SIGNALS_PER_CYCLE", modeDefaults.maxSignalsPerCycle, 1, 20),
    allowExtendedHoursHalt: readBooleanEnv("SIGNAL_ALLOW_EXTENDED_HOURS_HALT", DEFAULTS.allowExtendedHoursHalt),
    signalUniverseMode: readUniverseModeEnv("SIGNAL_UNIVERSE_MODE", "all"),
  };

  return cached;
}

export function resetSignalRuntimeConfigForTests() {
  cached = null;
}
