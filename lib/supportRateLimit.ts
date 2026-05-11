import { NextRequest } from "next/server";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const rateLimitStore = new Map<string, RateLimitEntry>();

export function getSupportRateLimitConfig() {
  return {
    maxRequests: RATE_LIMIT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_WINDOW_MS,
  };
}

export function getSupportClientIdentifier(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  return request.headers.get("x-real-ip")?.trim() || "local";
}

export function consumeSupportRateLimitToken(clientId: string, nowMs = Date.now()) {
  const existing = rateLimitStore.get(clientId);
  if (!existing || existing.resetAt <= nowMs) {
    const next: RateLimitEntry = {
      count: 1,
      resetAt: nowMs + RATE_LIMIT_WINDOW_MS,
    };
    rateLimitStore.set(clientId, next);
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS - 1,
      retryAfterSec: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
    };
  }

  if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1000)),
    };
  }

  existing.count += 1;
  rateLimitStore.set(clientId, existing);
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - existing.count,
    retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1000)),
  };
}

export function resetSupportAgentRateLimitForTests() {
  rateLimitStore.clear();
}
