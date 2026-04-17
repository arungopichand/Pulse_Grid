import { NextRequest, NextResponse } from "next/server";
import { fetchVolumeSnapshots } from "@/lib/volume-data";

export async function GET(request: NextRequest) {
  const tickersParam = request.nextUrl.searchParams.get("tickers") ?? "";
  const tickers = Array.from(
    new Set(
      tickersParam
        .split(",")
        .map((ticker) => ticker.trim().toUpperCase())
        .filter(Boolean),
    ),
  ).slice(0, 8);

  const result = await fetchVolumeSnapshots(tickers);

  const status = result.ok
    ? 200
    : result.reason === "invalid_request"
      ? 400
      : result.reason === "missing_api_key" || result.reason === "invalid_api_key"
        ? 503
        : result.reason === "rate_limited"
          ? 429
          : 502;

  return NextResponse.json(result, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
