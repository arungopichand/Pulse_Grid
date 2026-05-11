import { NextResponse } from "next/server";
import { getMarketStreamHealth } from "@/lib/market-stream";
import { getSignalRuntimeConfig } from "@/lib/signal-runtime-config";
import { getLiveSessionRuntimeStatus } from "@/lib/live-session-runtime";
import { buildMarketHealthPayload } from "@/lib/market-health";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = getMarketStreamHealth();
  const runtimeConfig = getSignalRuntimeConfig();
  const runtimeStatus = getLiveSessionRuntimeStatus();
  const payload = buildMarketHealthPayload({
    health,
    runtimeConfig,
    runtimeStatus,
  });

  return NextResponse.json(
    payload,
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
