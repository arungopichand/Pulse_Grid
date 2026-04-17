import {
  createSignalAnalysisFingerprint,
  generateDeterministicSignalAnalysis,
  sanitizeSignalAnalysis,
  type SignalAnalysis,
  type SignalAnalysisFeatures,
} from "./signal-analysis";

type CachedClientAnalysis = {
  analysis: SignalAnalysis;
  expiresAt: number;
};

const CLIENT_ANALYSIS_TTL_MS = 20_000;
const clientAnalysisCache = new Map<string, CachedClientAnalysis>();
const clientInFlight = new Map<string, Promise<SignalAnalysis>>();

function pruneExpiredClientCache(nowMs = Date.now()) {
  for (const [key, value] of clientAnalysisCache.entries()) {
    if (value.expiresAt <= nowMs) {
      clientAnalysisCache.delete(key);
    }
  }
}

function readClientCachedAnalysis(key: string, nowMs = Date.now()) {
  const cached = clientAnalysisCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= nowMs) {
    clientAnalysisCache.delete(key);
    return null;
  }
  return cached.analysis;
}

function writeClientCachedAnalysis(key: string, analysis: SignalAnalysis, ttlMs = CLIENT_ANALYSIS_TTL_MS) {
  clientAnalysisCache.set(key, {
    analysis,
    expiresAt: Date.now() + ttlMs,
  });
}

export async function requestSignalAnalysis(
  features: SignalAnalysisFeatures,
  options?: { signal?: AbortSignal },
): Promise<SignalAnalysis> {
  pruneExpiredClientCache();
  const cacheKey = createSignalAnalysisFingerprint(features);
  const fallback = generateDeterministicSignalAnalysis(features);
  const cached = readClientCachedAnalysis(cacheKey);
  if (cached) {
    return cached;
  }

  const shared = clientInFlight.get(cacheKey);
  if (shared) {
    return shared;
  }

  const requestPromise = (async () => {
    try {
      const response = await fetch("/api/analysis/signal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: options?.signal,
        body: JSON.stringify({
          features,
        }),
      });

      if (!response.ok) {
        writeClientCachedAnalysis(cacheKey, fallback);
        return fallback;
      }

      const payload = (await response.json()) as {
        ok?: boolean;
        analysis?: Partial<SignalAnalysis>;
      };

      if (!payload.ok || !payload.analysis) {
        writeClientCachedAnalysis(cacheKey, fallback);
        return fallback;
      }

      const sanitized = sanitizeSignalAnalysis(payload.analysis, fallback, { features });
      writeClientCachedAnalysis(cacheKey, sanitized);
      return sanitized;
    } catch {
      writeClientCachedAnalysis(cacheKey, fallback);
      return fallback;
    }
  })();

  clientInFlight.set(cacheKey, requestPromise);

  try {
    return await requestPromise;
  } finally {
    clientInFlight.delete(cacheKey);
  }
}
