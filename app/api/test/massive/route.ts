import { NextResponse } from "next/server";
import { getMassiveApiKey } from "@/lib/providers/massive";
import { getMarketClock } from "@/lib/market-session";

export const dynamic = "force-dynamic";

type MassiveSnapshotResponse = {
  status?: string;
  error?: string;
  message?: string;
  tickers?: Array<Record<string, unknown>>;
};

async function fetchSnapshot(kind: "gainers" | "losers", apiKey: string) {
  const url = `https://api.massive.com/v2/snapshot/locale/us/markets/stocks/${kind}?apiKey=${apiKey}`;
  const response = await fetch(url, { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as MassiveSnapshotResponse;
  return {
    ok: response.ok && !payload.error,
    status: response.status,
    payload,
  };
}

export async function GET() {
  const apiKey = getMassiveApiKey();
  const apiKeyConfigured = Boolean(apiKey);
  const marketClock = getMarketClock();
  const currentEasternTime = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date());

  if (!apiKeyConfigured) {
    return NextResponse.json(
      {
        apiKeyConfigured: false,
        currentEasternTime,
        sessionStatus: marketClock.sessionStatus,
        gainersStatus: "not_called",
        losersStatus: "not_called",
        gainersCount: 0,
        losersCount: 0,
        sampleGainers: [],
        sampleLosers: [],
        error: "MASSIVE_API_KEY is missing.",
        note: "Massive top movers may be empty until exchange data populates.",
      },
      { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const [gainers, losers] = await Promise.all([
    fetchSnapshot("gainers", apiKey),
    fetchSnapshot("losers", apiKey),
  ]);

  return NextResponse.json(
    {
      apiKeyConfigured: true,
      currentEasternTime,
      sessionStatus: marketClock.sessionStatus,
      gainersStatus: gainers.ok ? "ok" : `failed_${gainers.status}`,
      losersStatus: losers.ok ? "ok" : `failed_${losers.status}`,
      gainersCount: Array.isArray(gainers.payload.tickers) ? gainers.payload.tickers.length : 0,
      losersCount: Array.isArray(losers.payload.tickers) ? losers.payload.tickers.length : 0,
      sampleGainers: Array.isArray(gainers.payload.tickers) ? gainers.payload.tickers.slice(0, 5) : [],
      sampleLosers: Array.isArray(losers.payload.tickers) ? losers.payload.tickers.slice(0, 5) : [],
      error:
        !gainers.ok || !losers.ok
          ? {
              gainers: gainers.payload.error ?? gainers.payload.message ?? null,
              losers: losers.payload.error ?? losers.payload.message ?? null,
            }
          : null,
      note:
        (Array.isArray(gainers.payload.tickers) ? gainers.payload.tickers.length : 0) === 0 &&
        (Array.isArray(losers.payload.tickers) ? losers.payload.tickers.length : 0) === 0
          ? "Massive top movers may be empty until exchange data populates."
          : null,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
