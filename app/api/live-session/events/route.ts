import { getLiveSessionSnapshot, subscribeToLiveSessionSnapshots } from "@/lib/live-session-runtime";

export const dynamic = "force-dynamic";

function stripSignalDebug<T extends { signals: Array<Record<string, unknown>> }>(snapshot: T): T {
  return {
    ...snapshot,
    signals: snapshot.signals.map((signal) =>
      Object.fromEntries(Object.entries(signal).filter(([key]) => key !== "qualityDebug")),
    ),
  };
}

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sendEvent = (event: string, payload: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };

      const cleanup = () => {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }

        unsubscribe?.();
        unsubscribe = null;
      };

      request.signal.addEventListener("abort", () => {
        cleanup();
        controller.close();
      });

      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, 15_000);

      const initialSnapshot = await getLiveSessionSnapshot();
      sendEvent("snapshot", stripSignalDebug(initialSnapshot));

      unsubscribe = subscribeToLiveSessionSnapshots((snapshot) => {
        sendEvent("snapshot", stripSignalDebug(snapshot));
      });
    },
    cancel() {
      if (heartbeat) {
        clearInterval(heartbeat);
      }

      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    },
  });
}
