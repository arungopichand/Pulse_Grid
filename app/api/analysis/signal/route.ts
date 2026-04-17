import { NextRequest, NextResponse } from "next/server";
import { generateSignalAnalysisWithAi } from "@/lib/ai/signal-analysis-layer";
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
    const llmAnalysis = await generateSignalAnalysisWithAi(features, fallback);
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
