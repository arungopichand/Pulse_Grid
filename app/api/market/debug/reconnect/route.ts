import { NextResponse } from "next/server";
import { forceMarketStreamReconnectForDebug, getMarketStreamHealth } from "@/lib/market-stream";

export const dynamic = "force-dynamic";

function denyInProduction() {
  return NextResponse.json(
    { ok: false, error: "Not found" },
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}

function runReconnectHook() {
  if (process.env.NODE_ENV === "production") {
    return denyInProduction();
  }

  const before = getMarketStreamHealth();
  const result = forceMarketStreamReconnectForDebug();

  return NextResponse.json(
    {
      ok: result.ok,
      reason: result.reason,
      before,
      after: result.health,
      serverTime: new Date().toISOString(),
    },
    {
      status: result.ok ? 200 : 409,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}

export async function GET() {
  return runReconnectHook();
}

export async function POST() {
  return runReconnectHook();
}
