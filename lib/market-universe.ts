import { getMassiveApiKey } from "./providers/massive";
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
  selectedCount: number;
  source: "live" | "cache" | "fallback_empty";
  topSymbols: string[];
  reasonsBySymbol: Record<string, string>;
};

const UNIVERSE_CACHE_TTL_MS = 45_000;
const DEFAULT_UNIVERSE_CAP = 50;
const MIN_PRICE = 0.2;
const MAX_PRICE = 8;
const MIN_CURRENT_VOLUME = 100_000;
const MIN_DOLLAR_LIQUIDITY = 200_000;
const MIN_ABS_CHANGE_PERCENT = 2.5;
const MIN_RELATIVE_VOLUME = 1.3;

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

function normalizeDiscoveredTicker(
  raw: MassiveSnapshotTicker,
  source: "gainers" | "losers",
): DiscoveredTicker | null {
  const ticker = toUpperTicker(raw.ticker);
  if (!ticker) return null;

  const price = parseNumber(raw.lastTrade?.p) ?? parseNumber(raw.day?.c);
  if (price === null) return null;

  const changePercent = getChangePercent(raw, price);
  if (changePercent === null) return null;

  const currentVolume = parseNumber(raw.day?.v) ?? 0;
  const previousVolume = parseNumber(raw.prevDay?.v) ?? null;
  const relativeVolume =
    previousVolume && previousVolume > 0 ? currentVolume / previousVolume : null;
  const dollarLiquidity = price * currentVolume;
  const absChange = Math.abs(changePercent);
  const passesMoveGate =
    absChange >= MIN_ABS_CHANGE_PERCENT ||
    (relativeVolume !== null && relativeVolume >= MIN_RELATIVE_VOLUME);

  if (!passesMoveGate) return null;
  if (price < MIN_PRICE || price > MAX_PRICE) return null;
  if (currentVolume < MIN_CURRENT_VOLUME) return null;
  if (dollarLiquidity < MIN_DOLLAR_LIQUIDITY) return null;

  const boundedRvol = Math.min(relativeVolume ?? 0, 5);
  const rankScore =
    absChange * 5 + boundedRvol * 10 + Math.log10(dollarLiquidity + 1) * 2;
  const reason = [
    `source=${source}`,
    `move=${changePercent.toFixed(2)}%`,
    `price=$${price.toFixed(2)}`,
    `vol=${Math.round(currentVolume)}`,
    `rvol=${relativeVolume !== null ? relativeVolume.toFixed(2) : "n/a"}`,
    `liq=${Math.round(dollarLiquidity)}`,
  ].join(" ");

  return {
    ticker,
    price,
    changePercent,
    currentVolume,
    relativeVolume,
    dollarLiquidity,
    source,
    rankScore,
    reason,
  };
}

async function fetchSnapshotList(source: "gainers" | "losers") {
  const key = getMassiveApiKey();
  if (!key) {
    throw new Error("MASSIVE_API_KEY missing for dynamic universe discovery.");
  }

  const url = `https://api.massive.com/v2/snapshot/locale/us/markets/stocks/${source}?apiKey=${key}`;
  const response = await fetch(url, {
    cache: "no-store",
  });

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

  const [gainers, losers] = await Promise.all([
    fetchSnapshotList("gainers"),
    fetchSnapshotList("losers"),
  ]);

  const normalized = [
    ...(gainers.tickers ?? []).map((ticker) => normalizeDiscoveredTicker(ticker, "gainers")),
    ...(losers.tickers ?? []).map((ticker) => normalizeDiscoveredTicker(ticker, "losers")),
  ].filter((ticker): ticker is DiscoveredTicker => Boolean(ticker));

  const dedupedByTicker = new Map<string, DiscoveredTicker>();
  for (const entry of normalized) {
    const existing = dedupedByTicker.get(entry.ticker);
    if (!existing || entry.rankScore > existing.rankScore) {
      dedupedByTicker.set(entry.ticker, entry);
    }
  }

  const ranked = [...dedupedByTicker.values()].sort((left, right) => {
    if (right.rankScore !== left.rankScore) {
      return right.rankScore - left.rankScore;
    }
    return right.changePercent - left.changePercent;
  });
  const selected = ranked.slice(0, cap);
  const result: DynamicMarketUniverseResult = {
    candidates: selected.map((entry) => toWatchlistTicker(entry.ticker)),
    discoveredCount: dedupedByTicker.size,
    selectedCount: selected.length,
    source: "live",
    topSymbols: selected.slice(0, 12).map((entry) => entry.ticker),
    reasonsBySymbol: Object.fromEntries(selected.map((entry) => [entry.ticker, entry.reason])),
  };

  cachedUniverse = {
    expiresAt: now + UNIVERSE_CACHE_TTL_MS,
    value: result,
  };

  return result;
}
