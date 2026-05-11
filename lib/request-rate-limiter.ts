type RateLimitBucket = {
  windowStartedAt: number;
  count: number;
};

const buckets = new Map<string, RateLimitBucket>();

export function consumeRateLimitToken(key: string, maxCalls: number, windowMs: number, nowMs = Date.now()) {
  const safeMaxCalls = Number.isFinite(maxCalls) ? Math.max(1, Math.floor(maxCalls)) : 1;
  const safeWindowMs = Number.isFinite(windowMs) ? Math.max(1, Math.floor(windowMs)) : 60_000;
  const normalizedKey = key.trim().toLowerCase();
  const existing = buckets.get(normalizedKey);

  if (!existing || nowMs - existing.windowStartedAt >= safeWindowMs) {
    const next: RateLimitBucket = {
      windowStartedAt: nowMs,
      count: 1,
    };
    buckets.set(normalizedKey, next);
    return {
      allowed: true,
      remaining: Math.max(0, safeMaxCalls - 1),
      retryAfterMs: safeWindowMs,
    };
  }

  if (existing.count >= safeMaxCalls) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, existing.windowStartedAt + safeWindowMs - nowMs),
    };
  }

  existing.count += 1;
  buckets.set(normalizedKey, existing);
  return {
    allowed: true,
    remaining: Math.max(0, safeMaxCalls - existing.count),
    retryAfterMs: Math.max(0, existing.windowStartedAt + safeWindowMs - nowMs),
  };
}

export function resetRequestRateLimiterForTests() {
  buckets.clear();
}
