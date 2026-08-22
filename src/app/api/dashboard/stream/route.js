import { statsEmitter } from "@/lib/usageDb";
import { breakerEmitter } from "open-sse/services/circuitBreaker.js";
import { healthEmitter } from "open-sse/services/healthMonitor.js";
import { getMeta } from "@/lib/db/helpers/metaStore";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/stream — Unified SSE stream for the Live Dashboard.
 *
 * Subscribes to three event sources:
 *   - statsEmitter  → usage updates (request count, tokens, cost deltas)
 *   - breakerEmitter → circuit breaker state changes (provider down/recovered)
 *   - healthEmitter  → provider health updates (success rate, latency)
 *
 * Emits an initial snapshot on connect, then live delta events.
 * 25s keepalive prevents proxy/load-balancer idle timeout.
 */
export async function GET() {
  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null, onStats: null, onBreaker: null, onHealth: null };

  const stream = new ReadableStream({
    async start(controller) {
      // Initial snapshot — send current lifetime totals.
      try {
        const [requests, saved, costSaved] = await Promise.all([
          getMeta("totalRequestsLifetime", "0"),
          getMeta("tokensSavedLifetime", "0"),
          getMeta("costSavedLifetime", "0"),
        ]);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: "snapshot",
          stats: {
            totalRequests: parseInt(requests, 10) || 0,
            tokensSaved: parseInt(saved, 10) || 0,
            costSaved: parseFloat(costSaved) || 0,
          },
        })}\n\n`));
      } catch {
        // ignore
      }

      const emit = (payload) => {
        if (state.closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          cleanup();
        }
      };

      // Stats updates → usage deltas
      state.onStats = (payload) => emit({ type: "usage_update", ...payload });
      statsEmitter.on("update", state.onStats);

      // Breaker changes → provider down/recovered
      state.onBreaker = (payload) => emit({
        type: payload.state === "open" ? "provider_down" : "provider_recovered",
        provider: payload.provider,
        state: payload.state,
        failures: payload.failures,
      });
      breakerEmitter.on("breaker:update", state.onBreaker);

      // Health changes → health metric update
      state.onHealth = (payload) => emit({ type: "health_update", ...payload });
      healthEmitter.on("health:update", state.onHealth);

      // Health degradation → in-app notification (C1 fix: previously only webhooks)
      state.onHealthDegraded = (payload) => emit(payload);
      healthEmitter.on("health:degraded", state.onHealthDegraded);

      // Keepalive
      state.keepalive = setInterval(() => {
        if (state.closed) { clearInterval(state.keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 25000);
    },

    cancel() {
      cleanup();
    },
  });

  function cleanup() {
    state.closed = true;
    if (state.onStats) statsEmitter.off("update", state.onStats);
    if (state.onBreaker) breakerEmitter.off("breaker:update", state.onBreaker);
    if (state.onHealth) healthEmitter.off("health:update", state.onHealth);
    if (state.onHealthDegraded) healthEmitter.off("health:degraded", state.onHealthDegraded);
    if (state.keepalive) clearInterval(state.keepalive);
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
