// Ollama Cloud usage handler — real quota tracker for ollama.com.
//
// Hitting:
//   GET /api/usage   → session (5h) + weekly (7d) usage windows with 0..1 ratio
//   GET /api/me      → plan label (Free / Pro / Max)
//
// Auth: `Authorization: Bearer <apiKey>` — the same key used for chat
// (ollama.com/settings/keys). No separate management key needed.
import { proxyAwareFetch } from "../../utils/proxyFetch.js";

const OLLAMA_API_ROOT = "https://ollama.com/api";
const USAGE_URL = `${OLLAMA_API_ROOT}/usage`;
const ME_URL = `${OLLAMA_API_ROOT}/me`;

function toRatioNumber(value) {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fetch Ollama Cloud usage for a connection.
 * @param {string} apiKey - Ollama API key (ollama.com/settings/keys)
 * @param {Object|null} proxyOptions - resolved connection proxy options
 * @returns {Promise<Object>} { quotas: { session, weekly }, plan }
 */
export async function getOllamaUsage(apiKey, proxyOptions = null) {
  if (!apiKey) {
    return { message: "Ollama connection is missing an API key. Add one to view usage." };
  }

  const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };

  // Fetch usage + plan in parallel; each falls back gracefully.
  const [usageRes, meRes] = await Promise.all([
    proxyAwareFetch(USAGE_URL, { headers, signal: AbortSignal.timeout(8000) }, proxyOptions)
      .catch(() => null),
    proxyAwareFetch(ME_URL, { headers, signal: AbortSignal.timeout(8000) }, proxyOptions)
      .catch(() => null),
  ]);

  const quotas = {};

  // ── Usage windows (session 5h + weekly 7d, ratio 0..1) ────────────────
  if (usageRes?.ok) {
    const data = await usageRes.json().catch(() => ({}));

    const buildWindow = (key, raw, label, unit) => {
      if (raw === undefined || raw === null) return;
      const ratio = toRatioNumber(raw);
      quotas[key] = {
        used: Math.round(ratio * 1000),
        total: 1000,
        remaining: Math.round((1 - ratio) * 1000),
        remainingPercentage: Math.round((1 - ratio) * 100),
        resetAt: null,
        unit,
        unlimited: false,
        displayName: label,
      };
    };

    buildWindow("session", data.session, "Session (5h)", "ratio");
    buildWindow("weekly", data.weekly, "Weekly (7d)", "ratio");
  }

  // ── Plan label ─────────────────────────────────────────────────────────
  let plan = null;
  if (meRes?.ok) {
    const me = await meRes.json().catch(() => ({}));
    plan = me.plan || null;
  }

  if (Object.keys(quotas).length === 0) {
    const authFailed = usageRes?.status === 401 || meRes?.status === 401;
    return {
      message: authFailed
        ? "Ollama API key invalid or expired. Check your key at ollama.com/settings/keys."
        : "Ollama usage unavailable.",
    };
  }

  return { quotas, plan };
}
