import assert from "node:assert/strict";
import { createSupportAgentSseResponse } from "../lib/ai/support-agent-sse.ts";

type ParsedEvent = {
  event: string;
  data: Record<string, unknown>;
};

function parseSseEvents(payload: string) {
  const events: ParsedEvent[] = [];
  const blocks = payload.split("\n\n").filter(Boolean);

  for (const block of blocks) {
    const lines = block.split("\n");
    const eventLine = lines.find((line) => line.startsWith("event: "));
    const dataLine = lines.find((line) => line.startsWith("data: "));
    if (!eventLine || !dataLine) {
      continue;
    }

    const event = eventLine.slice("event: ".length).trim();
    const dataText = dataLine.slice("data: ".length).trim();
    try {
      events.push({
        event,
        data: JSON.parse(dataText) as Record<string, unknown>,
      });
    } catch {
      // ignore parse failures
    }
  }

  return events;
}

async function readResponseBodyAsText(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }

  const decoder = new TextDecoder();
  let done = false;
  let content = "";
  while (!done) {
    const chunk = await reader.read();
    done = chunk.done;
    if (done) {
      break;
    }
    content += decoder.decode(chunk.value, { stream: true });
  }

  return content;
}

async function run() {
  const abort = new AbortController();
  const response = createSupportAgentSseResponse({
    requestSignal: abort.signal,
    reply: {
      text: "Copilot response for SSE flow verification.",
      usedTools: ["get_live_session_overview"],
    },
    delayMs: 0,
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");

  const text = await readResponseBodyAsText(response);
  const events = parseSseEvents(text);
  assert.ok(events.length >= 3);

  const meta = events.find((item) => item.event === "meta");
  assert.ok(meta);
  assert.deepEqual(meta.data.usedTools, ["get_live_session_overview"]);

  const deltas = events.filter((item) => item.event === "delta");
  assert.ok(deltas.length >= 1);
  assert.ok(deltas.every((item) => typeof item.data.text === "string"));

  const done = events.find((item) => item.event === "done");
  assert.ok(done);
  assert.equal(done.data.text, "Copilot response for SSE flow verification.");

  console.log("support-agent-sse-tests: ok");
}

void run();
