import { NextRequest, NextResponse } from "next/server";
import { getLiveSessionSnapshot } from "@/lib/live-session-runtime";

export const dynamic = "force-dynamic";

function stripSignalDebug<T extends { signals: Array<Record<string, unknown>> }>(snapshot: T): T {
  return {
    ...snapshot,
    signals: snapshot.signals.map((signal) =>
      Object.fromEntries(Object.entries(signal).filter(([key]) => key !== "qualityDebug")),
    ),
  };
}

export async function GET(request: NextRequest) {
  const snapshot = await getLiveSessionSnapshot();
  const debugRequested = request.nextUrl.searchParams.get("debug") === "1";
  const includeDebug = process.env.NODE_ENV !== "production" || debugRequested;
  const responsePayload = includeDebug ? snapshot : stripSignalDebug(snapshot);

  return NextResponse.json(responsePayload, {
    status: snapshot.ok ? 200 : 200,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
