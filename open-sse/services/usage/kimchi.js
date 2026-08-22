/**
 * Kimchi usage handler — fetches credit balance + budget from the Kimchi
 * billing API (llm.kimchi.dev/v1/credits + /v1/budget).
 *
 * Credits payload (from the official Kimchi CLI billing/status.ts):
 *   { remaining?, tier?, is_paid_tier?, billing_status?: "ok"|"low"|"exhausted",
 *     has_credits?, serverless? }
 *
 * Budget payload:
 *   { period: { startTime, endTime }, budgets: [{ scope, budgetLimitUsd,
 *     totalSpendUsd, ... }] }
 */
import { proxyAwareFetch } from "../../utils/proxyFetch.js";

const KIMCHI_LLM_ROOT = "https://llm.kimchi.dev";
const CREDITS_URL = `${KIMCHI_LLM_ROOT}/v1/credits`;
const BUDGET_URL = `${KIMCHI_LLM_ROOT}/v1/budget`;

function toUsdNumber(value) {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseResetTimeIso(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Fetch Kimchi usage data for a connection.
 * @param {string} accessToken - Kimchi API token (OAuth access token)
 * @param {Object|null} proxyOptions - resolved connection proxy options
 * @returns {Promise<Object>} { quotas: { credits, budget } }
 */
export async function getKimchiUsage(accessToken, proxyOptions = null) {
  if (!accessToken) {
    return { message: "Kimchi connection is missing an access token. Re-authorize to view usage." };
  }

  const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };

  // Fetch credits + budget in parallel; each falls back gracefully.
  const [creditsRes, budgetRes] = await Promise.all([
    proxyAwareFetch(CREDITS_URL, { headers, signal: AbortSignal.timeout(8000) }, proxyOptions)
      .catch(() => null),
    proxyAwareFetch(BUDGET_URL, { headers, signal: AbortSignal.timeout(8000) }, proxyOptions)
      .catch(() => null),
  ]);

  const quotas = {};

  // ── Credits ───────────────────────────────────────────────────────────
  if (creditsRes?.ok) {
    const credits = await creditsRes.json().catch(() => ({}));
    const remaining = toUsdNumber(credits.remaining);
    const status = credits.billing_status || (credits.has_credits === false ? "exhausted" : undefined);
    quotas.credits = {
      used: 0,
      total: 0,
      remaining,                 // absolute credit count — UI treats as info
      remainingPercentage: null, // no total → no percentage
      resetAt: null,
      unit: "credits",
      status,
      unlimited: false,
    };
  }

  // ── Budget (USD) ──────────────────────────────────────────────────────
  if (budgetRes?.ok) {
    const budget = await budgetRes.json().catch(() => ({}));
    const period = budget.period || {};
    // Pick the API_KEY-scoped budget if present, else the first entry.
    const entries = Array.isArray(budget.budgets) ? budget.budgets : [];
    const entry = entries.find((b) => b.scope === "API_KEY") || entries[0];
    if (entry) {
      const limit = toUsdNumber(entry.budgetLimitUsd);
      const spend = toUsdNumber(entry.totalSpendUsd);
      const remaining = Math.max(0, limit - spend);
      quotas.budget = {
        used: spend,
        total: limit,
        remaining,
        remainingPercentage: limit > 0 ? Math.round((remaining / limit) * 100) : null,
        resetAt: parseResetTimeIso(period.endTime),
        unit: "usd",
        recurring: true,
      };
    }
  }

  // If neither endpoint returned data, surface a helpful message.
  if (Object.keys(quotas).length === 0) {
    const authFailed = creditsRes?.status === 401 || budgetRes?.status === 401;
    return { message: authFailed ? "Kimchi token expired. Re-authorize to view usage." : "Kimchi usage unavailable." };
  }

  return { quotas };
}
