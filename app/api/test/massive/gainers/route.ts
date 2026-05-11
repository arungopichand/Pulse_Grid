import { NextResponse } from "next/server";
import { getMassiveApiKey } from "@/lib/providers/massive";

export const dynamic = "force-dynamic";

export async function GET() {
  const apiKey = getMassiveApiKey();
  if (!apiKey) {
    return NextResponse.json({ ok: false, apiKeyConfigured: false, error: "MASSIVE_API_KEY missing" }, { status: 200 });
  }
  const gainersUrl = `https://api.massive.com/v2/snapshot/locale/us/markets/stocks/gainers?apiKey=${apiKey}`;
  const losersUrl = `https://api.massive.com/v2/snapshot/locale/us/markets/stocks/losers?apiKey=${apiKey}`;
  const [gainersRes, losersRes] = await Promise.all([fetch(gainersUrl, { cache: "no-store" }), fetch(losersUrl, { cache: "no-store" })]);
  const gainersPayload = await gainersRes.json().catch(() => ({}));
  const losersPayload = await losersRes.json().catch(() => ({}));
  return NextResponse.json({
    ok: gainersRes.ok && losersRes.ok,
    apiKeyConfigured: true,
    gainersStatus: gainersRes.status,
    losersStatus: losersRes.status,
    gainersCount: Array.isArray((gainersPayload as { tickers?: unknown[] }).tickers) ? ((gainersPayload as { tickers: unknown[] }).tickers.length) : 0,
    losersCount: Array.isArray((losersPayload as { tickers?: unknown[] }).tickers) ? ((losersPayload as { tickers: unknown[] }).tickers.length) : 0,
    sampleGainers: Array.isArray((gainersPayload as { tickers?: unknown[] }).tickers) ? (gainersPayload as { tickers: unknown[] }).tickers.slice(0, 5) : [],
    sampleLosers: Array.isArray((losersPayload as { tickers?: unknown[] }).tickers) ? (losersPayload as { tickers: unknown[] }).tickers.slice(0, 5) : [],
  });
}

