import { NextResponse } from "next/server";
import { getMarketStreamHealth } from "@/lib/market-stream";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = getMarketStreamHealth();
  const status =
    health.status === "idle"
      ? "disconnected"
      : health.status;

  return NextResponse.json(
    {
      status,
      mode: health.mode,
      lastMessageAt: health.lastMessageAt,
      lastBootstrapAt: health.lastBootstrapAt,
      lastForcedDisconnectAt: health.lastForcedDisconnectAt,
      messagesPerMinute: health.messagesPerMinute,
      reconnectCount: health.reconnectCount,
      reconnectScheduled: health.reconnectScheduled,
      universeSize: health.activeUniverseSize,
      subscribedSymbolCount: health.subscribedSymbolCount,
      isStale: health.stale,
      isDegraded: health.degraded,
      uptimeMs: health.uptimeMs,
      streamStarted: health.streamStarted,
      snapshotSymbolCount: health.snapshotSymbolCount,
      serverTime: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
