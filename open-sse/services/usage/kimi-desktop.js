/**
 * Kimi Desktop usage handler — hits the www.kimi.com membership RPC the
 * desktop app uses. Requires the kimi-auth JWT, stored as the connection
 * `apiKey` by the oauth import route (NOT an OAuth access token).
 *
 * Endpoints (plain JSON POST "{}", NOT the Connect envelope):
 *   POST /apiv2/kimi.gateway.membership.v2.MembershipService/ListSubscriptions
 *     → { subscriptions: [{ goods: { title, membershipLevel },
 *                           currentStartTime, currentEndTime, status }] }
 *   POST .../MembershipService/GetSubscriptionStats
 *     → { subscriptionBalance: { feature, amountUsedRatio, expireTime, unit },
 *         giftBalances: [{ type: GIFT, feature, unit, amountUsedRatio,
 *                          displayName, expireTime }] }
 */
import { proxyAwareFetch } from "../../utils/proxyFetch.js";

const BASE_URL = "https://www.kimi.com";
const MEMBERSHIP_SVC =
  `${BASE_URL}/apiv2/kimi.gateway.membership.v2.MembershipService`;

function toPercent(ratio) {
  const n = Number(ratio);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Call one membership RPC method (plain JSON over POST). Throws with .status. */
async function callRpc(path, jwt, proxyOptions) {
  const res = await proxyAwareFetch(
    `${MEMBERSHIP_SVC}/${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${jwt}`,
        Cookie: `kimi-auth=${jwt}`,
        "connect-protocol-version": "1",
        "x-msh-version": "2.0.0",
        "x-msh-platform": "web",
      },
      body: "{}",
      signal: AbortSignal.timeout(8000),
    },
    proxyOptions
  );
  if (!res.ok) {
    const err = new Error(`kimi-desktop ${path} HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Shape the two RPC responses into { tier, quotas, raw }. */
export function buildQuotaPayload(subs, stats) {
  const activeSub =
    (subs.subscriptions || []).find((s) => s.active) ||
    (subs.subscriptions || [])[0] ||
    null;

  const sub = stats.subscriptionBalance || null;
  const gifts = Array.isArray(stats.giftBalances) ? stats.giftBalances : [];

  const quotas = {};
  if (sub) {
    const used = toPercent(sub.amountUsedRatio);
    quotas.subscription = {
      used: used ?? 0,
      total: 100,
      remainingPercentage: used != null ? 100 - used : null,
      resetAt: sub.expireTime || null,
      unit: "percent",
      recurring: true,
    };
  }
  gifts.forEach((g, i) => {
    const used = toPercent(g.amountUsedRatio);
    quotas[`gift-${i + 1}`] = {
      name: g.displayName || "Gift",
      used: used ?? 0,
      total: 100,
      remainingPercentage: used != null ? 100 - used : null,
      resetAt: g.expireTime || null,
      unit: "percent",
      recurring: false,
    };
  });

  return {
    tier:
      activeSub?.goods?.title ||
      String(activeSub?.goods?.membershipLevel ?? "?"),
    quotas,
    raw: { subscriptions: subs.subscriptions || [], stats },
  };
}

/**
 * Fetch Kimi Desktop usage for a connection.
 * @param {string} jwt - kimi-auth JWT (stored as apiKey)
 * @param {Object|null} proxyOptions
 * @returns {Promise<Object>} { tier, quotas, message? }
 */
export async function getKimiDesktopUsage(jwt, proxyOptions = null) {
  if (!jwt || !String(jwt).startsWith("eyJ")) {
    return {
      message:
        "Kimi Desktop connection is missing a kimi-auth JWT. Re-import the session to view usage.",
    };
  }

  const results = await Promise.all([
    callRpc("ListSubscriptions", jwt, proxyOptions).catch((e) => e),
    callRpc("GetSubscriptionStats", jwt, proxyOptions).catch((e) => e),
  ]);
  const [listResult, statsResult] = results;

  // Treat a 401/403 on either call as an expired session, not a generic error.
  if (listResult?.status === 401 || listResult?.status === 403) {
    return {
      message:
        "Kimi Desktop session expired. Re-open the app and re-import the session.",
    };
  }
  if (listResult instanceof Error || statsResult instanceof Error) {
    return { message: "Kimi Desktop usage unavailable." };
  }

  return buildQuotaPayload(listResult || {}, statsResult || {});
}
