import { createLiveSignalEngineState, evaluateLiveSignals } from "../lib/live-signal-engine.ts";
import { fetchFinnhubQuotes } from "../lib/market-data.ts";
import { watchlistUniverse } from "../lib/watchlist.ts";

const QUOTE_CACHE_TTL_MS = 20_000;
const STALE_QUOTE_AFTER_MS = 60_000;
const REFRESH_BATCH_SIZE = 4;
const ITERATIONS = 6;
const NETWORK_LATENCY_MS = 80;
const TICKERS = watchlistUniverse.map((ticker) => ticker.ticker);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chooseTickersToRefresh(tickers, cursor) {
  if (tickers.length <= REFRESH_BATCH_SIZE) {
    return { tickers: [...tickers], nextCursor: cursor };
  }

  const start = cursor % tickers.length;
  const selected = [];

  for (let offset = 0; offset < REFRESH_BATCH_SIZE; offset += 1) {
    selected.push(tickers[(start + offset) % tickers.length]);
  }

  return {
    tickers: selected,
    nextCursor: (start + REFRESH_BATCH_SIZE) % tickers.length,
  };
}

async function simulateBaselineCycle(state) {
  const cycleStartedAt = Date.now();
  const now = Date.now();
  const servedQuotes = new Map();
  let primaryCalls = 0;
  let fallbackCalls = 0;

  const rotation = chooseTickersToRefresh(TICKERS, state.refreshCursor);
  state.refreshCursor = rotation.nextCursor;
  const tickersToRefresh = rotation.tickers;

  for (const ticker of TICKERS) {
    const cached = state.quoteCache.get(ticker);
    if (!cached) continue;

    const freshness = now - new Date(cached.timestamp).getTime() > STALE_QUOTE_AFTER_MS ? "stale" : "cached";

    servedQuotes.set(ticker, {
      ticker,
      price: cached.price,
      changePercent: cached.changePercent,
      timestamp: cached.timestamp,
      freshness,
    });
  }

  if (tickersToRefresh.length) {
    primaryCalls += tickersToRefresh.length;
    await sleep(NETWORK_LATENCY_MS);

    fallbackCalls += tickersToRefresh.length;
    await sleep(NETWORK_LATENCY_MS);
  }

  return {
    latencyMs: Date.now() - cycleStartedAt,
    primaryCalls,
    fallbackCalls,
    cacheHits: servedQuotes.size,
  };
}

async function benchmarkBaseline() {
  const baselineState = {
    quoteCache: new Map(),
    refreshCursor: 0,
  };

  const latencies = [];
  let primaryCalls = 0;
  let fallbackCalls = 0;
  let cacheHits = 0;

  for (let index = 0; index < ITERATIONS; index += 1) {
    const cycle = await simulateBaselineCycle(baselineState);
    latencies.push(cycle.latencyMs);
    primaryCalls += cycle.primaryCalls;
    fallbackCalls += cycle.fallbackCalls;
    cacheHits += cycle.cacheHits;
  }

  return {
    avgLatencyMs: Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
    primaryCalls,
    fallbackCalls,
    cacheHits,
  };
}

async function benchmarkOptimized() {
  const originalFetch = globalThis.fetch;
  const originalFinnhubKey = process.env.FINNHUB_API_KEY;
  const originalTwelveDataKey = process.env.TWELVE_DATA_API_KEY;
  const latencies = [];
  let primaryCalls = 0;
  let fallbackCalls = 0;
  let cacheHits = 0;
  const engineState = createLiveSignalEngineState();

  process.env.FINNHUB_API_KEY = "benchmark";
  process.env.TWELVE_DATA_API_KEY = "benchmark";

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    await sleep(NETWORK_LATENCY_MS);

    if (url.includes("finnhub.io")) {
      primaryCalls += 1;
      return new Response(JSON.stringify({ error: "rate limited" }), { status: 429 });
    }

    if (url.includes("twelvedata.com")) {
      fallbackCalls += 1;
      return new Response(JSON.stringify({ status: "error", code: 429, message: "rate limited" }), { status: 200 });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    for (let index = 0; index < ITERATIONS; index += 1) {
      const cycleStartedAt = Date.now();
      const quotesResult = await fetchFinnhubQuotes(TICKERS);
      evaluateLiveSignals({
        state: engineState,
        watchlist: watchlistUniverse,
        quotes: quotesResult.quotes,
        observedAt: new Date().toISOString(),
      });
      latencies.push(Date.now() - cycleStartedAt);
      cacheHits += quotesResult.summary.servedFromCache;
    }
  } finally {
    globalThis.fetch = originalFetch;
    process.env.FINNHUB_API_KEY = originalFinnhubKey;
    process.env.TWELVE_DATA_API_KEY = originalTwelveDataKey;
  }

  return {
    avgLatencyMs: Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
    primaryCalls,
    fallbackCalls,
    cacheHits,
  };
}

const baseline = await benchmarkBaseline();
const optimized = await benchmarkOptimized();

console.log(
  JSON.stringify(
    {
      scenario: "provider_rate_limited_rotation",
      iterations: ITERATIONS,
      baseline,
      optimized,
      avgLatencyImprovementMs: baseline.avgLatencyMs - optimized.avgLatencyMs,
      providerCallReduction: {
        primary: baseline.primaryCalls - optimized.primaryCalls,
        fallback: baseline.fallbackCalls - optimized.fallbackCalls,
        totalPercent:
          Math.round(
            ((baseline.primaryCalls + baseline.fallbackCalls - optimized.primaryCalls - optimized.fallbackCalls) /
              (baseline.primaryCalls + baseline.fallbackCalls)) *
              100,
          ) || 0,
      },
    },
    null,
    2,
  ),
);
