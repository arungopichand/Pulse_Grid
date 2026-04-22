import { NextRequest, NextResponse } from "next/server";
import { QuoteFetchResult, getMarketDataThresholds, marketDataProvider } from "@/lib/market-data";
import { getQuoteFetchResultFromStream, startMarketStream } from "@/lib/market-stream";

export async function GET(request: NextRequest) {
  await startMarketStream();
  const tickersParam = request.nextUrl.searchParams.get("tickers") ?? "";
  const tickers = Array.from(
    new Set(
      tickersParam
        .split(",")
        .map((ticker) => ticker.trim().toUpperCase())
        .filter(Boolean),
    ),
  ).slice(0, 8);

  if (!tickers.length) {
    const thresholds = getMarketDataThresholds();
    const invalidRequest: QuoteFetchResult = {
      ok: false,
      quotes: [],
      degraded: true,
      reason: "invalid_request",
      message: "No tickers were provided for the market quote request.",
      retryAfterMs: marketDataProvider.pollIntervalMs,
      summary: {
        requested: 0,
        fresh: 0,
        cached: 0,
        stale: 0,
        failed: 0,
        servedFromCache: 0,
        fetchedFromMassive: 0,
        fetchedFromFinnhub: 0,
        fetchedFromTwelveData: 0,
      },
      quoteStates: {},
      cacheTtlMs: thresholds.cacheTtlMs,
      staleAfterMs: thresholds.staleAfterMs,
      refreshBatchSize: thresholds.refreshBatchSize,
    };

    return NextResponse.json(invalidRequest, { status: 400 });
  }

  const result = getQuoteFetchResultFromStream(tickers);
  const status = result.ok
    ? 200
    : result.reason === "invalid_request"
      ? 400
      : result.reason === "rate_limited"
        ? 429
        : result.reason === "missing_api_key" || result.reason === "invalid_api_key"
          ? 503
          : result.reason === "upstream_error"
            ? 502
            : 200;

  return NextResponse.json(result, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
