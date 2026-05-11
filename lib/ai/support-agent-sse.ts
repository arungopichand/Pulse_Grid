import { chunkTextForStreaming } from "./support-agent-core.ts";

export type SupportAgentReply = {
  text: string;
  usedTools: string[];
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonSse(event: string, payload: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function createSupportAgentSseResponse(params: {
  requestSignal: AbortSignal;
  reply: SupportAgentReply;
  delayMs?: number;
}) {
  const encoder = new TextEncoder();
  const chunks = chunkTextForStreaming(params.reply.text);
  const delayMs = params.delayMs ?? 16;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (event: string, payload: unknown) => {
        controller.enqueue(encoder.encode(jsonSse(event, payload)));
      };

      push("meta", {
        usedTools: Array.from(new Set(params.reply.usedTools)),
      });

      for (const chunk of chunks) {
        if (params.requestSignal.aborted) {
          break;
        }

        push("delta", { text: chunk });
        if (delayMs > 0) {
          await sleep(delayMs);
        }
      }

      push("done", { text: params.reply.text });
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    },
  });
}
