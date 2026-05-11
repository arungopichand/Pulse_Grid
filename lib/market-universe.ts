import { getMassiveApiKey } from "./providers/massive";
import { classifyInstrumentCandidate } from "./instrument-filter";
import type { WatchlistTicker } from "./watchlist";

type MassiveSnapshotBar = {
  c?: number;
  v?: number;
};

type MassiveSnapshotTicker = {
  ticker?: string;
  todaysChangePerc?: number;
  todaysChange?: number;
  lastTrade?: {
    p?: number;
  };
  day?: MassiveSnapshotBar;
  prevDay?: MassiveSnapshotBar;
};

type MassiveSnapshotResponse = {
  tickers?: MassiveSnapshotTicker[];
};

type UniverseRejectionReason =
  | "too_expensive"
  | "below_min_price"
  | "low_volume"
  | "low_relative_volume"
  | "low_change"
  | "bearish_filtered"
  | "etf_or_fund"
  | "warrant_filtered"
  | "unit_filtered"
  | "right_filtered"
  | "unknown_allowed"
  | "selected_common_stock";

type DiscoveredTicker = {
  ticker: string;
  price: number;
  changePercent: number;
  currentVolume: number;
  relativeVolume: number | null;
  dollarLiquidity: number;
  source: "gainers" | "losers";
  rankScore: number;
  reason: string;
};

export type DynamicMarketUniverseResult = {
  candidates: WatchlistTicker[];
  discoveredCount: number;
  discoveredBeforeFilters: number;
  selectedCount: number;
  source: "live" | "cache" | "fallback_empty";
  topSymbols: string[];
  reasonsBySymbol: Record<string, string>;
  scannerThresholds: {
    minPrice: number;
    maxPrice: number;
    minVolume: number;
    minRelativeVolume: number;
    minAbsChangePercent: number;
    bullishOnly: boolean;
  };
  rejectionReasonCounts: Record<UniverseRejectionReason, number>;
  etfRejectedCount?: number;
  rejectedEtfSymbols?: string[];
  rejectedWarrantSymbols?: string[];
  unknownAllowedSymbols?: string[];
  topCandidates: Array<{
    ticker: string;
    price: number;
    changePercent: number;
    currentVolume: number;
    relativeVolume: number | null;
    reason: string;
  }>;
};

const UNIVERSE_CACHE_TTL_MS = 45_000;
const DEFAULT_UNIVERSE_CAP = 50;
const DEFAULT_MIN_PRICE = 0.1;
const DEFAULT_MAX_PRICE = 20;
const DEFAULT_MIN_CURRENT_VOLUME = 0;
const DEFAULT_MIN_ABS_CHANGE_PERCENT = 0;
const DEFAULT_MIN_RELATIVE_VOLUME = 0;
const DEFAULT_BULLISH_ONLY = false;

function readNumberEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readBooleanEnv(name: string, fallback: boolean) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return fallback;
}

function getScannerConfig() {
  const minPrice = readNumberEnv("PULSEGRID_MIN_PRICE", DEFAULT_MIN_PRICE, 0.01, 50);
  const maxPrice = readNumberEnv("PULSEGRID_MAX_PRICE", DEFAULT_MAX_PRICE, minPrice, 200);
  const minCurrentVolume = readNumberEnv("PULSEGRID_MIN_VOLUME", DEFAULT_MIN_CURRENT_VOLUME, 0, 500_000_000);
  const minRelativeVolume = readNumberEnv("PULSEGRID_MIN_RELATIVE_VOLUME", DEFAULT_MIN_RELATIVE_VOLUME, 0, 100);
  const minAbsChangePercent = readNumberEnv("PULSEGRID_MIN_ABS_CHANGE_PERCENT", DEFAULT_MIN_ABS_CHANGE_PERCENT, 0, 100);
  const bullishOnly = readBooleanEnv("PULSEGRID_BULLISH_ONLY", DEFAULT_BULLISH_ONLY);

  return {
    minPrice,
    maxPrice,
    minCurrentVolume,
    minRelativeVolume,
    minAbsChangePercent,
    bullishOnly,
  };
}

let cachedUniverse: {
  expiresAt: number;
  value: DynamicMarketUniverseResult;
} | null = null;

function parseNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toUpperTicker(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function toWatchlistTicker(symbol: string): WatchlistTicker {
  return {
    ticker: symbol,
    company: symbol,
    sector: "Dynamic",
    exchange: "UNKNOWN",
    instrumentType: "Common Stock",
    country: "US",
    floatShares: null,
  };
}

function getChangePercent(raw: MassiveSnapshotTicker, price: number) {
  const direct = parseNumber(raw.todaysChangePerc);
  if (direct !== null) return direct;

  const todayChange = parseNumber(raw.todaysChange);
  if (todayChange !== null) {
    const priorClose = price - todayChange;
    if (Math.abs(priorClose) > 0.000001) {
      return (todayChange / priorClose) * 100;
    }
  }

  return null;
}

function normalizeSnapshotTicker(
  raw: MassiveSnapshotTicker,
  source: "gainers" | "losers",
): Omit<DiscoveredTicker, "rankScore" | "reason"> | null {
  const ticker = toUpperTicker(raw.ticker);
  if (!ticker) return null;
  const price = parseNumber(raw.lastTrade?.p) ?? parseNumber(raw.day?.c);
  if (price === null) return null;
  const changePercent = getChangePercent(raw, price);
  if (changePercent === null) return null;
  const currentVolume = parseNumber(raw.day?.v) ?? 0;
  const previousVolume = parseNumber(raw.prevDay?.v) ?? null;
  const relativeVolume = previousVolume && previousVolume > 0 ? currentVolume / previousVolume : null;
  const dollarLiquidity = price * currentVolume;

  return {
    ticker,
    price,
    changePercent,
    currentVolume,
    relativeVolume,
    dollarLiquidity,
    source,
  };
}

function buildRankScore(entry: Omit<DiscoveredTicker, "rankScore" | "reason">) {
  const absChange = Math.abs(entry.changePercent);
  const bullishBias = entry.changePercent > 0 ? entry.changePercent * 7 : entry.changePercent * 2;
  const rvolWeight = entry.relativeVolume !== null ? Math.min(entry.relativeVolume, 6) * 10 : 0;
  return bullishBias + absChange * 3 + rvolWeight + Math.log10(Math.max(1, entry.currentVolume)) * 5 + Math.log10(Math.max(1, entry.dollarLiquidity)) * 2;
}

function validateEntry(
  entry: Omit<DiscoveredTicker, "rankScore" | "reason">,
  scanner: ReturnType<typeof getScannerConfig>,
): UniverseRejectionReason | null {
  const absChange = Math.abs(entry.changePercent);
  if (entry.price < scanner.minPrice) return "below_min_price";
  if (entry.price > scanner.maxPrice) return "too_expensive";
  if (entry.currentVolume < scanner.minCurrentVolume) return "low_volume";
  if (absChange < scanner.minAbsChangePercent) return "low_change";
  if (scanner.bullishOnly && entry.changePercent <= 0) return "bearish_filtered";
  if (entry.relativeVolume !== null && entry.relativeVolume < scanner.minRelativeVolume) return "low_relative_volume";
  return null;
}

async function fetchSnapshotList(source: "gainers" | "losers") {
  const key = getMassiveApiKey();
  if (!key) {
    throw new Error("MASSIVE_API_KEY missing for dynamic universe discovery.");
  }

  const url = `https://api.massive.com/v2/snapshot/locale/us/markets/stocks/${source}?apiKey=${key}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Massive ${source} snapshot failed with status ${response.status}`);
  }
  return (await response.json()) as MassiveSnapshotResponse;
}

export async function getDynamicMarketUniverse(
  options?: { cap?: number; forceRefresh?: boolean },
): Promise<DynamicMarketUniverseResult> {
  const cap = Math.max(10, Math.min(options?.cap ?? DEFAULT_UNIVERSE_CAP, 100));
  const now = Date.now();

  if (!options?.forceRefresh && cachedUniverse && cachedUniverse.expiresAt > now) {
    return {
      ...cachedUniverse.value,
      source: "cache",
    };
  }

  const scanner = getScannerConfig();
  const [gainers, losers] = await Promise.all([fetchSnapshotList("gainers"), fetchSnapshotList("losers")]);
  const rawRows = [
    ...(gainers.tickers ?? []).map((ticker) => normalizeSnapshotTicker(ticker, "gainers")),
    ...(losers.tickers ?? []).map((ticker) => normalizeSnapshotTicker(ticker, "losers")),
  ].filter((row): row is Omit<DiscoveredTicker, "rankScore" | "reason"> => Boolean(row));

  const dedupedRaw = new Map<string, Omit<DiscoveredTicker, "rankScore" | "reason">>();
  for (const row of rawRows) {
    const existing = dedupedRaw.get(row.ticker);
    if (!existing || Math.abs(row.changePercent) > Math.abs(existing.changePercent)) {
      dedupedRaw.set(row.ticker, row);
    }
  }

  const rejectionReasonCounts: Record<UniverseRejectionReason, number> = {
    too_expensive: 0,
    below_min_price: 0,
    low_volume: 0,
    low_relative_volume: 0,
    low_change: 0,
    bearish_filtered: 0,
    etf_or_fund: 0,
    warrant_filtered: 0,
    unit_filtered: 0,
    right_filtered: 0,
    unknown_allowed: 0,
    selected_common_stock: 0,
  };
  const rejectedEtfSymbols: string[] = [];
  const rejectedWarrantSymbols: string[] = [];
  const unknownAllowedSymbols: string[] = [];

  const passed: DiscoveredTicker[] = [];
  for (const row of dedupedRaw.values()) {
    const classification = classifyInstrumentCandidate({ ticker: row.ticker });
    if (!classification.allowed) {
      if (
        classification.reason === "etf_or_fund" ||
        classification.reason === "warrant_filtered" ||
        classification.reason === "unit_filtered" ||
        classification.reason === "right_filtered"
      ) {
        rejectionReasonCounts[classification.reason] += 1;
      }
      if (classification.reason === "etf_or_fund" && rejectedEtfSymbols.length < 50) rejectedEtfSymbols.push(row.ticker);
      if (classification.reason === "warrant_filtered" && rejectedWarrantSymbols.length < 50) rejectedWarrantSymbols.push(row.ticker);
      continue;
    }
    if (classification.reason === "unknown_allowed") {
      rejectionReasonCounts.unknown_allowed += 1;
      if (unknownAllowedSymbols.length < 50) unknownAllowedSymbols.push(row.ticker);
    } else {
      rejectionReasonCounts.selected_common_stock += 1;
    }
    const rejection = validateEntry(row, scanner);
    if (rejection) {
      rejectionReasonCounts[rejection] += 1;
      continue;
    }
    const rankScore = buildRankScore(row);
    const reason = `source=${row.source} move=${row.changePercent.toFixed(2)}% price=$${row.price.toFixed(2)} vol=${Math.round(row.currentVolume)} rvol=${row.relativeVolume !== null ? row.relativeVolume.toFixed(2) : "n/a"} liq=${Math.round(row.dollarLiquidity)} class=${classification.reason} confidence=${classification.confidence}`;
    passed.push({ ...row, rankScore, reason });
  }

  const ranked = [...passed].sort((a, b) => {
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
    if (b.changePercent !== a.changePercent) return b.changePercent - a.changePercent;
    return a.ticker.localeCompare(b.ticker);
  });
  const selected = ranked.slice(0, cap);

  const result: DynamicMarketUniverseResult = {
    candidates: selected.map((entry) => toWatchlistTicker(entry.ticker)),
    discoveredCount: dedupedRaw.size,
    discoveredBeforeFilters: dedupedRaw.size,
    selectedCount: selected.length,
    source: "live",
    topSymbols: selected.slice(0, 20).map((entry) => entry.ticker),
    reasonsBySymbol: Object.fromEntries(selected.map((entry) => [entry.ticker, entry.reason])),
    scannerThresholds: {
      minPrice: scanner.minPrice,
      maxPrice: scanner.maxPrice,
      minVolume: scanner.minCurrentVolume,
      minRelativeVolume: scanner.minRelativeVolume,
      minAbsChangePercent: scanner.minAbsChangePercent,
      bullishOnly: scanner.bullishOnly,
    },
    rejectionReasonCounts,
    etfRejectedCount: rejectionReasonCounts.etf_or_fund,
    rejectedEtfSymbols: rejectedEtfSymbols.slice(0, 20),
    rejectedWarrantSymbols: rejectedWarrantSymbols.slice(0, 20),
    unknownAllowedSymbols: unknownAllowedSymbols.slice(0, 20),
    topCandidates: ranked.slice(0, 20).map((entry) => ({
      ticker: entry.ticker,
      price: entry.price,
      changePercent: entry.changePercent,
      currentVolume: entry.currentVolume,
      relativeVolume: entry.relativeVolume,
      reason: entry.reason,
    })),
  };

  cachedUniverse = {
    expiresAt: now + UNIVERSE_CACHE_TTL_MS,
    value: result,
  };

  return result;
}
