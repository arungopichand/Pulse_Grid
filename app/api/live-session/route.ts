import { NextResponse } from "next/server";
import { getLiveSessionSnapshot } from "@/lib/live-session-runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getLiveSessionSnapshot();

  return NextResponse.json(snapshot, {
    status: snapshot.ok ? 200 : 200,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
