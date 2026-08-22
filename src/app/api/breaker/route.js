import { getBreakerStates, resetBreaker } from "open-sse/services/circuitBreaker.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/breaker — one-shot snapshot of all circuit breaker states.
 */
export async function GET() {
  return Response.json({ breakers: getBreakerStates() });
}

/**
 * POST /api/breaker — manually reset a circuit breaker.
 * Body: { provider: string, key?: string }
 *   - key omitted  → reset the provider AND all its proxy variants.
 *   - key provided → reset only that specific (provider:proxy) entry.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const provider = body?.provider;
  if (typeof provider !== "string" || !provider) {
    return Response.json({ error: "provider is required" }, { status: 400 });
  }

  const key = typeof body?.key === "string" && body.key ? body.key : null;
  const resets = resetBreaker(provider, key);
  return Response.json({ success: true, resets, provider, key });
}
