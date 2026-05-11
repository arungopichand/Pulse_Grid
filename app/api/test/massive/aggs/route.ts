import { NextRequest, NextResponse } from "next/server";
import { fetchMassiveIntradayAggregates, getMassiveApiKey, isMassiveErrorPayload, normalizeMassiveAggregateBars } from "@/lib/providers/massive";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ticker = (request.nextUrl.searchParams.get("ticker") ?? "").trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ ok: false, error: "ticker query param required" }, { status: 400 });
  }
  const apiKeyConfigured = Boolean(getMassiveApiKey());
  if (!apiKeyConfigured) {
    return NextResponse.json({ ok: false, apiKeyConfigured: false, error: "MASSIVE_API_KEY missing" }, { status: 200 });
  }
  const now = Date.now();
  const from = now - 4 * 60 * 60_000;
  const { response, payload } = await fetchMassiveIntradayAggregates(ticker, {
    multiplier: 1,
    timespan: "minute",
    from,
    to: now,
    adjusted: true,
    sort: "asc",
    limit: 240,
  });
  const bars = normalizeMassiveAggregateBars(payload);
  return NextResponse.json({
    ok: response.ok && !isMassiveErrorPayload(payload),
    apiKeyConfigured: true,
    ticker,
    status: response.status,
    barsCount: bars.length,
    sampleBars: bars.slice(-10),
    rawError: isMassiveErrorPayload(payload) ? payload : null,
  });
}

