import { COMBO_LIMITS } from "open-sse/services/comboConfig.js";

const state = global._comboAdmissionState ??= { global: 0, principals: new Map() };

export function acquireComboAdmission(principalId) {
  const principal = principalId || "local";
  const current = state.principals.get(principal) || 0;
  if (current >= COMBO_LIMITS.maxConcurrentRunsPerPrincipal) {
    return { ok: false, status: 429, code: "combo_concurrency_exceeded", retryAfter: 1 };
  }
  if (state.global >= COMBO_LIMITS.maxConcurrentRunsGlobal) {
    return { ok: false, status: 503, code: "combo_capacity_exceeded", retryAfter: 1 };
  }
  state.global++;
  state.principals.set(principal, current + 1);
  let released = false;
  return {
    ok: true,
    release() {
      if (released) return;
      released = true;
      state.global = Math.max(0, state.global - 1);
      const next = Math.max(0, (state.principals.get(principal) || 1) - 1);
      if (next === 0) state.principals.delete(principal); else state.principals.set(principal, next);
    },
  };
}

export function wrapResponseWithAdmission(response, lease) {
  if (!lease?.ok || !response?.body) { lease?.release?.(); return response; }
  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { lease.release(); controller.close(); return; }
        controller.enqueue(value);
      } catch (error) {
        lease.release();
        controller.error(error);
      }
    },
    cancel(reason) {
      lease.release();
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export function getComboAdmissionStats() {
  return { activeGlobal: state.global, activePrincipals: state.principals.size };
}
