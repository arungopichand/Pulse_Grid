import { allWatchlistCandidates } from "@/lib/watchlist";
import { getLiveSessionSnapshot, getSharedLiveStateStore } from "@/lib/live-session-runtime";
import {
  extractToolCalls,
  getResponseOutputText,
  SUPPORT_AGENT_SYSTEM_PROMPT,
  type OpenAiResponsePayload,
  type OpenAiToolCall,
  type SupportAgentMessage,
} from "./support-agent-core";

type ExecutedToolCall = {
  callId: string;
  name: string;
  output: string;
};

const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_SUPPORT_AGENT_MODEL = "gpt-5.5";
const MAX_TOOL_STEPS = 3;
const SUPPORT_AGENT_TIMEOUT_MS = 20_000;

const SUPPORT_AGENT_TOOLS = [
  {
    type: "function",
    name: "get_live_session_overview",
    description: "Returns current PulseGrid live-session health, top active signals, and session metadata.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_ticker_context",
    description: "Returns latest known context for a ticker symbol from watchlist, signals, and quote state.",
    parameters: {
      type: "object",
      properties: {
        ticker: {
          type: "string",
          description: "Uppercase US stock ticker symbol like PLUG or CLOV.",
        },
      },
      required: ["ticker"],
      additionalProperties: false,
    },
  },
] as const;

function getOpenAiApiKey() {
  return process.env.OPENAI_API_KEY?.trim() ?? "";
}

function getSupportAgentModel() {
  return process.env.OPENAI_SUPPORT_AGENT_MODEL?.trim() || DEFAULT_SUPPORT_AGENT_MODEL;
}

function toOpenAiInput(messages: SupportAgentMessage[]) {
  return [
    {
      role: "system",
      content: [{ type: "input_text", text: SUPPORT_AGENT_SYSTEM_PROMPT }],
    },
    ...messages.map((message) => ({
      role: message.role,
      content: [{ type: "input_text", text: message.content }],
    })),
  ];
}


function parseJsonObject(text: string) {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function sanitizeTicker(raw: unknown) {
  if (typeof raw !== "string") {
    return "";
  }

  return raw.trim().toUpperCase().replace(/[^A-Z.]/g, "").slice(0, 8);
}

async function getLiveSessionOverviewToolOutput() {
  const cached = getSharedLiveStateStore();
  const snapshot = cached.snapshot ?? (await getLiveSessionSnapshot());
  const topSignals = [...snapshot.signals]
    .sort((left, right) => right.finalScore - left.finalScore)
    .slice(0, 5)
    .map((signal) => ({
      ticker: signal.ticker,
      signalType: signal.signalType,
      finalScore: signal.finalScore,
      confidence: signal.confidence,
      changePercent: signal.changePercent,
      quoteFreshness: signal.quoteFreshness,
      explanation: signal.explanationLine,
    }));

  return {
    ok: snapshot.ok,
    degraded: snapshot.degraded,
    sessionDate: snapshot.sessionDate,
    sessionStatus: snapshot.sessionStatus,
    sessionLabel: snapshot.sessionLabel,
    message: snapshot.message,
    lastUpdated: snapshot.lastUpdated,
    signalCount: snapshot.signals.length,
    liveAlertsNowCount: snapshot.liveAlertsNow.length,
    topSignals,
    volumeMovers: snapshot.volumeMovers.slice(0, 5).map((mover) => ({
      ticker: mover.ticker,
      relativeVolume: mover.relativeVolume,
      changePercent: mover.changePercent,
    })),
  };
}

async function getTickerContextToolOutput(args: Record<string, unknown>) {
  const ticker = sanitizeTicker(args.ticker);
  if (!ticker) {
    return {
      ok: false,
      error: "Ticker is required.",
    };
  }

  const cached = getSharedLiveStateStore();
  const snapshot = cached.snapshot ?? (await getLiveSessionSnapshot());
  const signal = snapshot.signals.find((item) => item.ticker === ticker) ?? null;
  const watchlist = snapshot.watchlist.find((item) => item.ticker === ticker) ?? null;
  const quote = cached.latestQuotes.find((item) => item.ticker === ticker) ?? null;
  const staticMeta = allWatchlistCandidates.find((item) => item.ticker === ticker) ?? null;

  return {
    ok: true,
    ticker,
    signal: signal
      ? {
          signalType: signal.signalType,
          finalScore: signal.finalScore,
          confidence: signal.confidence,
          confidenceScore: signal.confidenceScore,
          changePercent: signal.changePercent,
          price: signal.price,
          explanation: signal.explanationLine,
          reasonBadges: signal.reasonBadges.slice(0, 8),
        }
      : null,
    watchlist: watchlist
      ? {
          hasActiveSignal: watchlist.hasActiveSignal,
          scannerStatus: watchlist.scannerStatus ?? null,
          scannerScore: watchlist.scannerScore ?? null,
          freshness: watchlist.freshness,
          exclusionReason: watchlist.exclusionReason ?? null,
          price: watchlist.price,
          changePercent: watchlist.changePercent,
        }
      : null,
    quote: quote
      ? {
          price: quote.price,
          changePercent: quote.changePercent,
          lastUpdated: quote.lastUpdated,
          provider: quote.provider,
          freshness: quote.freshness,
        }
      : null,
    metadata: staticMeta
      ? {
          company: staticMeta.company,
          sector: staticMeta.sector,
          exchange: staticMeta.exchange,
          instrumentType: staticMeta.instrumentType,
          country: staticMeta.country,
          floatShares: staticMeta.floatShares ?? null,
          riskFlags: staticMeta.riskFlags ?? [],
        }
      : null,
  };
}

async function executeToolCall(call: OpenAiToolCall): Promise<ExecutedToolCall> {
  const args = parseJsonObject(call.argumentsText);

  try {
    let output: unknown;
    switch (call.name) {
      case "get_live_session_overview":
        output = await getLiveSessionOverviewToolOutput();
        break;
      case "get_ticker_context":
        output = await getTickerContextToolOutput(args);
        break;
      default:
        output = {
          ok: false,
          error: `Unknown tool '${call.name}'.`,
        };
        break;
    }

    return {
      callId: call.callId,
      name: call.name,
      output: JSON.stringify(output),
    };
  } catch (error) {
    return {
      callId: call.callId,
      name: call.name,
      output: JSON.stringify({
        ok: false,
        error: "Tool execution failed.",
        detail: error instanceof Error ? error.message : "unknown_error",
      }),
    };
  }
}

async function callOpenAiResponseApi(payload: Record<string, unknown>, signal: AbortSignal) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    return null;
  }

  const response = await fetch(OPENAI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as OpenAiResponsePayload;
}

function redactLikelySecrets(text: string) {
  return text.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[redacted-api-key]");
}

export async function generateSupportAgentReply(messages: SupportAgentMessage[]) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    return {
      text: "Support agent is unavailable because OPENAI_API_KEY is not configured on the server.",
      usedTools: [] as string[],
    };
  }

  if (!messages.length || messages[messages.length - 1]?.role !== "user") {
    return {
      text: "Please send a user message so I can help.",
      usedTools: [] as string[],
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUPPORT_AGENT_TIMEOUT_MS);

  try {
    const model = getSupportAgentModel();
    let response = await callOpenAiResponseApi(
      {
        model,
        input: toOpenAiInput(messages),
        tools: SUPPORT_AGENT_TOOLS,
        tool_choice: "auto",
        max_output_tokens: 700,
      },
      controller.signal,
    );

    if (!response) {
      return {
        text: "Support agent is temporarily unavailable. Please try again in a moment.",
        usedTools: [],
      };
    }

    const usedTools: string[] = [];
    let steps = 0;
    while (steps < MAX_TOOL_STEPS) {
      const toolCalls = extractToolCalls(response);
      if (!toolCalls.length) {
        break;
      }

      const toolOutputs = await Promise.all(toolCalls.map((call) => executeToolCall(call)));
      usedTools.push(...toolOutputs.map((item) => item.name));
      steps += 1;

      if (!response.id) {
        break;
      }

      response = await callOpenAiResponseApi(
        {
          model,
          previous_response_id: response.id,
          input: toolOutputs.map((item) => ({
            type: "function_call_output",
            call_id: item.callId,
            output: item.output,
          })),
          tools: SUPPORT_AGENT_TOOLS,
          tool_choice: "auto",
          max_output_tokens: 700,
        },
        controller.signal,
      );

      if (!response) {
        return {
          text: "Support agent was interrupted while running tools. Please retry.",
          usedTools,
        };
      }
    }

    const outputText = redactLikelySecrets(getResponseOutputText(response));
    if (!outputText) {
      return {
        text: "I could not generate a useful response for that request. Please rephrase and try again.",
        usedTools,
      };
    }

    return {
      text: outputText,
      usedTools,
    };
  } catch {
    return {
      text: "Support agent request failed due to a temporary server issue.",
      usedTools: [] as string[],
    };
  } finally {
    clearTimeout(timeout);
  }
}
