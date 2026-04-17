import { NextRequest, NextResponse } from "next/server";
import {
  createSignalAnalysisFingerprint,
  generateDeterministicSignalAnalysis,
  sanitizeSignalAnalysis,
  type SignalAnalysis,
  type SignalAnalysisFeatures,
} from "@/lib/signal-analysis";

export const dynamic = "force-dynamic";

type SignalAnalysisResponse = {
  ok: boolean;
  analysis: SignalAnalysis;
};

type CachedAnalysisEntry = {
  analysis: SignalAnalysis;
  expiresAt: number;
};

const ANALYSIS_CACHE_TTL_MS = 20_000;
const analysisCache = new Map<string, CachedAnalysisEntry>();
const analysisInFlight = new Map<string, Promise<SignalAnalysis>>();

function isSignalAnalysisFeatures(value: unknown): value is SignalAnalysisFeatures {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.ticker === "string" &&
    typeof candidate.signalType === "string" &&
    typeof candidate.sessionStatus === "string" &&
    typeof candidate.degraded === "boolean" &&
    typeof candidate.rank === "number" &&
    typeof candidate.rankMovement === "string" &&
    typeof candidate.price === "number" &&
    typeof candidate.changePercent === "number" &&
    typeof candidate.confidenceScore === "number" &&
    typeof candidate.scannerScore === "number" &&
    typeof candidate.streakCount === "number" &&
    Array.isArray(candidate.reasonBadges) &&
    Array.isArray(candidate.riskFlags) &&
    typeof candidate.ageSeconds === "number"
  );
}

function pruneExpiredAnalysisCache(nowMs = Date.now()) {
  for (const [key, value] of analysisCache.entries()) {
    if (value.expiresAt <= nowMs) {
      analysisCache.delete(key);
    }
  }
}

function readCachedAnalysis(key: string, nowMs = Date.now()) {
  const cached = analysisCache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= nowMs) {
    analysisCache.delete(key);
    return null;
  }

  return cached.analysis;
}

function writeCachedAnalysis(key: string, analysis: SignalAnalysis, ttlMs = ANALYSIS_CACHE_TTL_MS) {
  analysisCache.set(key, {
    analysis,
    expiresAt: Date.now() + ttlMs,
  });
}

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

async function generateLlmGroundedAnalysis(features: SignalAnalysisFeatures, fallback: SignalAnalysis): Promise<SignalAnalysis | null> {
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
        max_output_tokens: 240,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "You are a grounded scanner analyst. Use only supplied fields. Never mention any external catalyst/news/filing/FDA/halts/borrow/CTB. Never include price targets or directional prediction. Never provide buy/sell/entry/stop advice. If degraded is true, be cautious and explicitly acknowledge reduced confidence.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Analyze these deterministic scanner features and return only strict JSON with keys summary, bullCase, risk, stage, confidence, tone. Allowed enums: stage=[Early, In play, Extended], confidence=[High conviction, Strong, Developing], tone=[Breaking out, Holding, Building, Fading, Reappearing]. Keep summary <= 2 short sentences, bullCase <= 1 short sentence, risk <= 1 short sentence. Features: ${JSON.stringify(features)}`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      output_text?: string;
    };

    if (!payload.output_text) {
      return null;
    }

    const parsedJson = extractJsonObject(payload.output_text);
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

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as {
    features?: unknown;
  };

  if (!isSignalAnalysisFeatures(payload.features)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid signal analysis payload.",
      },
      { status: 400 },
    );
  }

  const features = payload.features;
  pruneExpiredAnalysisCache();
  const cacheKey = createSignalAnalysisFingerprint(features);
  const cached = readCachedAnalysis(cacheKey);
  if (cached) {
    return NextResponse.json(
      {
        ok: true,
        analysis: cached,
      } satisfies SignalAnalysisResponse,
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }

  const inFlight = analysisInFlight.get(cacheKey);
  if (inFlight) {
    const sharedAnalysis = await inFlight;
    return NextResponse.json(
      {
        ok: true,
        analysis: sharedAnalysis,
      } satisfies SignalAnalysisResponse,
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }

  const fallback = generateDeterministicSignalAnalysis(features);
  const analysisPromise = (async () => {
    const llmAnalysis = await generateLlmGroundedAnalysis(features, fallback);
    const analysis = llmAnalysis ?? fallback;
    const sanitized = sanitizeSignalAnalysis(analysis, fallback, { features });
    writeCachedAnalysis(cacheKey, sanitized);
    return sanitized;
  })();
  analysisInFlight.set(cacheKey, analysisPromise);

  let analysis: SignalAnalysis;
  try {
    analysis = await analysisPromise;
  } finally {
    analysisInFlight.delete(cacheKey);
  }

  const response: SignalAnalysisResponse = {
    ok: true,
    analysis,
  };

  return NextResponse.json(response, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
