import { NextRequest, NextResponse } from "next/server";
import { fetchMassiveNewsForTicker } from "@/lib/news-service";
import { getMassiveApiKey } from "@/lib/providers/massive";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ticker = (request.nextUrl.searchParams.get("ticker") ?? "").trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ ok: false, error: "ticker query param required" }, { status: 400 });
  }
  const apiKeyConfigured = Boolean(getMassiveApiKey());
  const items = await fetchMassiveNewsForTicker(ticker);
  return NextResponse.json({
    ok: true,
    apiKeyConfigured,
    ticker,
    count: items.length,
    items: items.slice(0, 20),
  });
}

