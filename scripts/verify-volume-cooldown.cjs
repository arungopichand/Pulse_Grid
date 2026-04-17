const { routeModule } = require("../.next/server/app/api/market/volume/route.js");

const getVolumeRoute = routeModule.userland.GET;
const realFetch = global.fetch;
const realDateNow = Date.now;
const realApiKey = process.env.TWELVE_DATA_API_KEY;

let fakeNow = realDateNow();
let mode = "success";
const fetchCalls = [];

function isoAt(offsetMinutes) {
  return new Date(fakeNow + offsetMinutes * 60_000).toISOString();
}

function buildSuccessQuote() {
  return {
    close: "101.25",
    percent_change: "4.2",
    volume: "540000",
    average_volume: "160000",
    datetime: isoAt(0),
  };
}

function buildSuccessBars() {
  const baseVolumes = [12000, 14000, 15000, 16000, 18000, 26000, 32000, 36000, 40000, 46000];

  return {
    values: baseVolumes.map((volume, index) => ({
      datetime: isoAt(-(9 - index)),
      open: "100.00",
      high: "102.10",
      low: "99.80",
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

  fetchCalls.push({ mode, url, at: fakeNow });

  if (mode === "unexpected_fetch") {
    throw new Error(`Provider should not have been called: ${url}`);
  }

  if (mode === "success") {
    if (url.includes("/quote?")) {
      return new Response(JSON.stringify(buildSuccessQuote()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/time_series?")) {
      return new Response(JSON.stringify(buildSuccessBars()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  if (mode === "rate_limited") {
    return new Response(JSON.stringify({ status: "error", code: 429, message: "rate limited" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  throw new Error(`Unexpected mocked fetch mode or URL: ${mode} ${url}`);
}

async function callRoute(tickers) {
  const response = await getVolumeRoute({
    nextUrl: new URL(`http://localhost/api/market/volume?tickers=${tickers.join(",")}`),
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  global.fetch = mockedFetch;
  Date.now = () => fakeNow;
  process.env.TWELVE_DATA_API_KEY = "verification-key";

  const tickerWithFallback = "AAPL";
  const uncachedTicker = "AMD";

  const firstResponse = await callRoute([tickerWithFallback]);
  const fetchCountAfterFirst = fetchCalls.length;
  assert(firstResponse.status === 200 && firstResponse.body.ok, "Initial live volume fetch should succeed.");
  assert(fetchCountAfterFirst === 2, "Initial live volume fetch should make quote and time-series requests.");

  fakeNow += 5_000;
  mode = "unexpected_fetch";
  const ttlCacheResponse = await callRoute([tickerWithFallback]);
  assert(ttlCacheResponse.status === 200 && ttlCacheResponse.body.ok, "Short-TTL cached volume response should stay available.");
  assert(fetchCalls.length === fetchCountAfterFirst, "Short-TTL repeat call should not hit Twelve Data again.");

  fakeNow += 20_000;
  mode = "rate_limited";
  const cooldownTriggerResponse = await callRoute([tickerWithFallback]);
  const fetchCountAfterCooldownTrigger = fetchCalls.length;
  assert(
    cooldownTriggerResponse.status === 200 && cooldownTriggerResponse.body.ok,
    "After a 429, the route should fall back to the last honest real dataset when available.",
  );
  assert(
    fetchCountAfterCooldownTrigger === fetchCountAfterFirst + 2,
    "Cooldown-triggering call should make exactly one quote request and one time-series request.",
  );

  fakeNow += 100;
  const cooldownCachedResponse = await callRoute([tickerWithFallback]);
  assert(
    cooldownCachedResponse.status === 200 && cooldownCachedResponse.body.ok,
    "During cooldown, cached real volume data should still be served when honest.",
  );
  assert(fetchCalls.length === fetchCountAfterCooldownTrigger, "Cooldown repeat call should not spam Twelve Data.");

  const degradedCooldownResponse = await callRoute([uncachedTicker]);
  assert(
    degradedCooldownResponse.status === 429 && !degradedCooldownResponse.body.ok,
    "During cooldown, uncached tickers should return the honest degraded state.",
  );
  assert(fetchCalls.length === fetchCountAfterCooldownTrigger, "Cooldown degraded call should also avoid provider spam.");

  console.log(
    JSON.stringify(
      {
        verifiedAt: new Date(fakeNow).toISOString(),
        ttlCacheVerified: true,
        cooldownVerified: true,
        degradedStateVerified: true,
        providerCalls: {
          total: fetchCalls.length,
          firstSuccess: fetchCountAfterFirst,
          afterCooldownTrigger: fetchCountAfterCooldownTrigger,
          afterCooldownRepeat: fetchCalls.length,
        },
        statuses: {
          first: firstResponse.status,
          ttlCache: ttlCacheResponse.status,
          cooldownTrigger: cooldownTriggerResponse.status,
          cooldownRepeat: cooldownCachedResponse.status,
          degradedCooldown: degradedCooldownResponse.status,
        },
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
    Date.now = realDateNow;
    process.env.TWELVE_DATA_API_KEY = realApiKey;
  });
