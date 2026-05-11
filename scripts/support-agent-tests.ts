import assert from "node:assert/strict";
import {
  chunkTextForStreaming,
  extractToolCalls,
  getResponseOutputText,
  normalizeSupportAgentMessages,
} from "../lib/ai/support-agent-core.ts";

function run() {
  const messages = normalizeSupportAgentMessages([
    { role: "user", content: "  hello  " },
    { role: "assistant", content: "done" },
    { role: "system", content: "skip me" },
    { role: "user", content: 123 },
    null,
  ]);

  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], { role: "user", content: "hello" });
  assert.deepEqual(messages[1], { role: "assistant", content: "done" });

  const calls = extractToolCalls({
    output: [
      {
        type: "function_call",
        name: "get_ticker_context",
        call_id: "call_1",
        arguments: "{\"ticker\":\"PLUG\"}",
      },
      {
        type: "message",
      },
    ],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.name, "get_ticker_context");
  assert.equal(calls[0]?.callId, "call_1");

  const direct = getResponseOutputText({
    output_text: "direct",
  });
  assert.equal(direct, "direct");

  const fallback = getResponseOutputText({
    output: [
      {
        content: [
          {
            type: "output_text",
            text: "from",
          },
          {
            type: "output_text",
            text: "tool",
          },
        ],
      },
    ],
  });
  assert.equal(fallback, "from\ntool");

  const chunks = chunkTextForStreaming(
    "This is a sentence that should be split into multiple small chunks for incremental streaming.",
  );
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.length > 0));
  assert.equal(
    chunks.join(""),
    "This is a sentence that should be split into multiple small chunks for incremental streaming.",
  );

  console.log("support-agent-tests: ok");
}

run();
