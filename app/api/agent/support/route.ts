import { NextRequest } from "next/server";
import { normalizeSupportAgentMessages } from "@/lib/ai/support-agent-core";
import { generateSupportAgentReply } from "@/lib/ai/support-agent";
import { createSupportAgentSseResponse } from "@/lib/ai/support-agent-sse";
import {
  consumeSupportRateLimitToken,
  getSupportClientIdentifier,
  getSupportRateLimitConfig,
} from "@/lib/supportRateLimit";

export const dynamic = "force-dynamic";

type SupportAgentRequestPayload = {
  messages?: unknown;
};
const supportRateLimitConfig = getSupportRateLimitConfig();

export async function POST(request: NextRequest) {
  const body = (await request.json()) as SupportAgentRequestPayload;
  const messages = normalizeSupportAgentMessages(body.messages);

  if (!messages.length || messages[messages.length - 1]?.role !== "user") {
    return Response.json(
      {
        ok: false,
        error: "A user message is required.",
      },
      { status: 400 },
    );
  }

  const clientId = getSupportClientIdentifier(request);
  const rateLimit = consumeSupportRateLimitToken(clientId);
  if (!rateLimit.allowed) {
    return Response.json(
      {
        ok: false,
        error: "Rate limit exceeded. Please try again shortly.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSec),
          "X-RateLimit-Limit": String(supportRateLimitConfig.maxRequests),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  const reply = await generateSupportAgentReply(messages);
  const response = createSupportAgentSseResponse({
    requestSignal: request.signal,
    reply,
  });
  response.headers.set("X-RateLimit-Limit", String(supportRateLimitConfig.maxRequests));
  response.headers.set("X-RateLimit-Remaining", String(rateLimit.remaining));
  response.headers.set("X-RateLimit-Reset", String(rateLimit.retryAfterSec));
  return response;
}
