const { routeModule } = require("../.next/server/app/api/live-session/route.js");

const getLiveSessionRoute = routeModule.userland.GET;
const realFetch = global.fetch;
const realFinnhubKey = process.env.FINNHUB_API_KEY;
const realTwelveDataKey = process.env.TWELVE_DATA_API_KEY;

const NETWORK_LATENCY_MS = 35;
const fetchCalls = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildFinnhubPayload(url) {
  const parsed = new URL(url);
  const ticker = parsed.searchParams.get("symbol") ?? "UNK";
  const base = 100 + ticker.length;

  return {
    c: base + 1.25,
    dp: 3.4,
  };
}

function buildTwelveDataQuotePayload(url) {
  const parsed = new URL(url);
  const ticker = parsed.searchParams.get("symbol") ?? "UNK";
  const now = new Date().toISOString();

  return {
    close: String(100 + ticker.length + 1.25),
    percent_change: "3.4",
    volume: "480000",
    average_volume: "140000",
    datetime: now,
  };
}

function buildTwelveDataBarsPayload() {
  const now = Date.now();
  const volumes = [14000, 16000, 17000, 18000, 19000, 24000, 31000, 36000, 42000, 47000];

  return {
    values: volumes.map((volume, index) => ({
      datetime: new Date(now - (9 - index) * 60_000).toISOString(),
      open: "100.00",
      high: "102.00",
      low: "99.50",
      close: "101.25",
      volume: String(volume),
    })),
  };
}

async function mockedFetch(input) {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  fetchCalls.push(url);
  await sleep(NETWORK_LATENCY_MS);

  if (url.includes("finnhub.io")) {
    return new Response(JSON.stringify(buildFinnhubPayload(url)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (url.includes("twelvedata.com/quote")) {
    return new Response(JSON.stringify(buildTwelveDataQuotePayload(url)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (url.includes("twelvedata.com/time_series")) {
    return new Response(JSON.stringify(buildTwelveDataBarsPayload()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  throw new Error(`Unexpected provider URL: ${url}`);
}

async function timeRequest() {
  const startedAt = Date.now();
  const response = await getLiveSessionRoute();
  const payload = await response.json();

  return {
    latencyMs: Date.now() - startedAt,
    payload,
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  global.fetch = mockedFetch;
  process.env.FINNHUB_API_KEY = "verification-key";
  process.env.TWELVE_DATA_API_KEY = "verification-key";

  const first = await timeRequest();
  const providerCallsAfterFirst = fetchCalls.length;
  const second = await timeRequest();
  const third = await timeRequest();

  assert(first.payload.retryAfterMs === 4000, "Shared runtime should expose the fast live interval.");
  assert(fetchCalls.length === providerCallsAfterFirst, "Repeated shared snapshot reads should not trigger extra provider calls.");
  assert(second.latencyMs < first.latencyMs, "Shared snapshot reuse should lower end-to-end latency.");
  assert(third.latencyMs < first.latencyMs, "Repeated snapshot reuse should stay faster than the first provider-backed cycle.");
  assert(
    first.payload.watchlist.every((item) => item.price === null || typeof item.price === "number"),
    "Watchlist prices must remain honest numeric market fields or null.",
  );
  assert(
    first.payload.volumeMovers.every((item) => typeof item.currentVolume === "number" && typeof item.averageVolume === "number"),
    "Volume Movers must keep real numeric volume fields.",
  );

  const naiveBaselineProviderCalls = providerCallsAfterFirst * 3;

  console.log(
    JSON.stringify(
      {
        firstCycleLatencyMs: first.latencyMs,
        repeatedReadLatencyMs: {
          second: second.latencyMs,
          third: third.latencyMs,
        },
        providerCalls: {
          sharedRuntimeTotal: fetchCalls.length,
          firstCycle: providerCallsAfterFirst,
          naiveThreeConsumerBaseline: naiveBaselineProviderCalls,
          savedVsBaseline: naiveBaselineProviderCalls - fetchCalls.length,
        },
        streamCadenceMs: first.payload.retryAfterMs,
        degraded: first.payload.degraded,
        fastLaneSignals: first.payload.signals.map((signal) => signal.ticker),
        volumeMovers: first.payload.volumeMovers.map((mover) => mover.ticker),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    global.fetch = realFetch;
    process.env.FINNHUB_API_KEY = realFinnhubKey;
    process.env.TWELVE_DATA_API_KEY = realTwelveDataKey;
    process.exit();
  });
