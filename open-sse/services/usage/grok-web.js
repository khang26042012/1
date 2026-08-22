// Grok Web (Subscription) usage handler for Quota Tracker.
//
// Uses the grok.com web rate-limits endpoint, authenticated via the SSO
// cookie stored as the provider's apiKey. Returns per-tier usage:
//   POST https://grok.com/rest/rate-limits
//   Body: { "modelName": "fast" | "thinking" | "heavy" }
//   Cookie: sso=<token>
//
// Response shape:
//   { windowSizeSeconds, remainingQueries, totalQueries,
//     lowEffortRateLimits, highEffortRateLimits }
//
// We poll 3 tiers (fast/thinking/heavy) in parallel and map each to a quota
// entry showing remaining/total queries in the 2-hour window. The reset time
// is computed from windowSizeSeconds (rolling window → reset = now + window).

import { U } from "./shared.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

// Model tiers to poll. Each maps to a quota row in the tracker card. The
// endpoint returns null for tiers the account doesn't have access to.
const TIERS = [
  { model: "fast", label: "Fast" },
  { model: "thinking", label: "Thinking" },
  { model: "heavy", label: "Heavy" },
];

export async function getGrokWebUsage(credentials, proxyOptions = null) {
  // The SSO cookie is stored as apiKey. Strip "sso=" prefix if present.
  let token = credentials?.apiKey;
  if (!token) return null;
  if (token.startsWith("sso=")) token = token.slice(4);

  const cfg = U("grok-web");
  const url = cfg.rateLimitsUrl || "https://grok.com/rest/rate-limits";

  const headers = {
    "Content-Type": "application/json",
    Accept: "*/*",
    Cookie: `sso=${token}`,
    Origin: "https://grok.com",
    Referer: "https://grok.com/?_s=usage",
    "User-Agent": USER_AGENT,
  };

  // Poll all tiers in parallel.
  const results = await Promise.allSettled(
    TIERS.map(async (tier) => {
      const res = await proxyAwareFetch(
        url,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ modelName: tier.model }),
          signal: AbortSignal.timeout(10000),
        },
        proxyOptions,
      );
      if (!res?.ok) return null;
      const data = await res.json().catch(() => null);
      if (!data || data.remainingQueries === undefined) return null;
      return { tier, data };
    }),
  );

  const quotas = {};
  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value) continue;
    const { tier, data } = r.value;
    const remaining = data.remainingQueries || 0;
    const total = data.totalQueries || 0;
    const used = total - remaining;
    const windowSeconds = data.windowSizeSeconds || 7200;

    quotas[tier.label] = {
      used,
      total,
      remaining,
      remainingPercentage: total > 0 ? Math.round((remaining / total) * 100) : null,
      // Rolling window: reset approximation is now + windowSizeSeconds.
      resetAt: new Date(Date.now() + windowSeconds * 1000).toISOString(),
    };
  }

  if (Object.keys(quotas).length === 0) {
    return {
      quotas: {},
      plan: null,
      message: "Grok rate-limits returned no data — SSO cookie may be expired.",
    };
  }

  return {
    quotas,
    plan: null,
  };
}
