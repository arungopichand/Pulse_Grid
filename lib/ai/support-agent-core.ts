export type SupportAgentMessage = {
  role: "user" | "assistant";
  content: string;
};

export type OpenAiResponsePayload = {
  id?: string;
  output_text?: string;
  output?: Array<Record<string, unknown>>;
};

export type OpenAiToolCall = {
  type: "function_call";
  name: string;
  callId: string;
  argumentsText: string;
};

const MAX_HISTORY_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 2_000;

export const SUPPORT_AGENT_SYSTEM_PROMPT = [
  "You are PulseGrid Copilot, an engineering support agent for the PulseGrid Lite application.",
  "Help users with this app's product behavior, architecture, routes, and implementation decisions.",
  "Response style:",
  "- Be concise by default (about 3-8 sentences unless user asks for depth).",
  "- Prioritize actionable, implementation-focused guidance over general theory.",
  "Security and privacy rules:",
  "- Never reveal, infer, or quote secrets (API keys, tokens, env vars, credentials, internal IDs).",
  "- If asked for secrets or hidden values, refuse briefly and continue with safe guidance.",
  "- Never include raw tool payload fields that may contain sensitive strings.",
  "Tool-use rules:",
  "- Use tools only when runtime context would materially improve correctness.",
  "- Treat tool output as source-of-truth for live status and ticker context.",
  "- If tools fail or return incomplete data, state that clearly and continue with best-effort reasoning.",
  "Uncertainty handling:",
  "- If information is unknown or unavailable, say 'I don't know from current data' and explain what to check next.",
  "- Do not fabricate runtime states, file contents, metrics, or external events.",
  "Policy boundary:",
  "- Do not provide trading instructions, price targets, entry/exit calls, or financial advice.",
].join("\n");

function sanitizeMessageContent(value: string) {
  return value.replace(/\u0000/g, "").trim().slice(0, MAX_MESSAGE_LENGTH);
}

export function normalizeSupportAgentMessages(value: unknown): SupportAgentMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: SupportAgentMessage[] = [];
  const tail = value.slice(-MAX_HISTORY_MESSAGES);

  for (const item of tail) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const candidate = item as Record<string, unknown>;
    if (candidate.role !== "user" && candidate.role !== "assistant") {
      continue;
    }
    if (typeof candidate.content !== "string") {
      continue;
    }

    const content = sanitizeMessageContent(candidate.content);
    if (!content) {
      continue;
    }

    normalized.push({
      role: candidate.role,
      content,
    });
  }

  return normalized;
}

export function getResponseOutputText(payload: OpenAiResponsePayload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  if (!Array.isArray(payload.output)) {
    return "";
  }

  const textParts: string[] = [];
  for (const item of payload.output) {
    const content = item.content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const contentItem of content) {
      if (
        contentItem &&
        typeof contentItem === "object" &&
        contentItem.type === "output_text" &&
        typeof contentItem.text === "string"
      ) {
        textParts.push(contentItem.text);
      }
    }
  }

  return textParts.join("\n").trim();
}

export function extractToolCalls(payload: OpenAiResponsePayload): OpenAiToolCall[] {
  if (!Array.isArray(payload.output)) {
    return [];
  }

  const calls: OpenAiToolCall[] = [];
  for (const item of payload.output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    if (item.type !== "function_call") {
      continue;
    }

    const name = typeof item.name === "string" ? item.name : "";
    const callId = typeof item.call_id === "string" ? item.call_id : "";
    const argumentsText = typeof item.arguments === "string" ? item.arguments : "{}";
    if (!name || !callId) {
      continue;
    }

    calls.push({
      type: "function_call",
      name,
      callId,
      argumentsText,
    });
  }

  return calls;
}

export function chunkTextForStreaming(text: string) {
  const tokens = text.split(/(\s+)/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const token of tokens) {
    if ((current + token).length > 48 && current) {
      chunks.push(current);
      current = token;
    } else {
      current += token;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length ? chunks : [text];
}
