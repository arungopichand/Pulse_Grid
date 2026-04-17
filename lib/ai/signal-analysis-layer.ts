import type { SignalAnalysis, SignalAnalysisFeatures } from "@/lib/signal-analysis";
import { sanitizeSignalAnalysis } from "@/lib/signal-analysis";

function getOpenAiApiKey() {
  return process.env.OPENAI_API_KEY?.trim() ?? "";
}

function getOpenAiModel() {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
}

function getResponseOutputText(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const candidate = payload as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  if (typeof candidate.output_text === "string" && candidate.output_text.trim()) {
    return candidate.output_text.trim();
  }

  if (!Array.isArray(candidate.output)) {
    return "";
  }

  const textParts: string[] = [];
  for (const item of candidate.output) {
    if (!Array.isArray(item.content)) {
      continue;
    }
    for (const contentItem of item.content) {
      if (contentItem.type === "output_text" && typeof contentItem.text === "string") {
        textParts.push(contentItem.text);
      }
    }
  }

  return textParts.join("\n").trim();
}

function isLikelyCompleteAnalysisCandidate(value: Partial<SignalAnalysis>) {
  return (
    typeof value.summary === "string" &&
    value.summary.trim().length > 0 &&
    typeof value.bullCase === "string" &&
    value.bullCase.trim().length > 0 &&
    typeof value.risk === "string" &&
    value.risk.trim().length > 0
  );
}

export async function generateSignalAnalysisWithAi(
  features: SignalAnalysisFeatures,
  fallback: SignalAnalysis,
): Promise<SignalAnalysis | null> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: getOpenAiModel(),
        max_output_tokens: 260,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "You are a grounded scanner analyst. Use only provided deterministic fields. Mention news/catalyst context only when newsScore > 0 and hasNews is true. If newsScore is 0, do not mention news. Never invent headlines or catalysts. Never provide buy/sell/entry/stop/target advice. Do not override deterministic score, confidence, signalType, freshness, or ranking. If degraded is true, acknowledge lower confidence.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Return strict JSON with keys summary, bullCase, risk, stage, confidence, tone. Allowed enums: stage=[Early, In play, Extended], confidence=[High conviction, Strong, Developing], tone=[Breaking out, Holding, Building, Fading, Reappearing]. Keep summary <= 2 short sentences; bullCase <= 1 sentence; risk <= 1 sentence. Use confidenceLevel/factorCount/final scores and deterministic news fields as source-of-truth context. Features: ${JSON.stringify(features)}`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as unknown;
    const outputText = getResponseOutputText(payload);
    if (!outputText) {
      return null;
    }

    const parsedJson = extractJsonObject(outputText);
    if (!parsedJson || typeof parsedJson !== "object") {
      return null;
    }

    const parsed = parsedJson as Partial<SignalAnalysis>;
    if (!isLikelyCompleteAnalysisCandidate(parsed)) {
      return null;
    }

    const sanitized = sanitizeSignalAnalysis(
      {
        ...parsed,
        source: "llm",
        generatedAt: new Date().toISOString(),
      },
      fallback,
      { features },
    );

    if (!isLikelyCompleteAnalysisCandidate(sanitized)) {
      return null;
    }

    return sanitized;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
