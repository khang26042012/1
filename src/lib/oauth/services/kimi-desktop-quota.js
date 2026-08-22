/**
 * Kimi Desktop quota service.
 *
 * Two data sources:
 *   1. LIVE — Connect-RPC against www.kimi.com (same auth plane as the chat
 *      executor; uses the desktop JWT + kimi-auth cookie). Ground truth for
 *      tier, subscription + gift usage:
 *        POST /apiv2/kimi.gateway.membership.v2.MembershipService/ListSubscriptions
 *          → { subscriptions: [{ goods: { title, membershipLevel, ... },
 *                                currentStartTime, currentEndTime, status }] }
 *        POST /apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats
 *          → { subscriptionBalance: { feature, amountUsedRatio, expireTime, unit },
 *              giftBalances: [{ type: GIFT|SUBSCRIPTION, feature, unit,
 *                               amountUsedRatio, displayName, expireTime }] }
 *   2. LOCAL — desktop token store (%APPDATA%\kimi-desktop\bridge-store\
 *      token-store.json). Fallback only (no usage counters persisted there).
 *
 * Each request is plain JSON text ("{}") sent as an unary POST with
 * Bearer <JWT> AND Cookie: kimi-auth=<JWT>. The membership service is NOT the
 * streaming Connect envelope the chat executor uses.
 */
import { readKimiDesktopStore } from "./kimi-desktop.js";

const BASE_URL = "https://www.kimi.com";
const MEMBERSHIP_SVC =
  `${BASE_URL}/apiv2/kimi.gateway.membership.v2.MembershipService`;

const TIER_BY_LEVEL = {
  LEVEL_FREE: "Free",
  LEVEL_MODERATO: "Moderato",
  LEVEL_ALLEGRETTO: "Allegretto",
  LEVEL_ALLEGRO: "Allegro",
  LEVEL_VIVACE: "Vivace",
  LEVEL_KIMI_CODE: "Kimi Code",
};

// Numeric `membership.level` found in the desktop JWT. Only exact-known levels
// map to a named tier; everything else falls through to "Level N".
const TIER_BY_NUMERIC_LEVEL = {
  0: "Free",
  1: "Moderato",
  2: "Allegretto",
  3: "Allegro",
  4: "Vivace",
  10: "Kimi Code",
};

function decodeJwtPayload(token) {
  if (typeof token !== "string") return null;
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Parse `msh_user_subscription_data` — may be a JSON string, an object, or null.
 * Always returns a (possibly empty) object.
 */
export function parseMshUserSubscriptionData(raw) {
  if (raw == null) return {};
  if (typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Resolve tier label from a membership level string (LEVEL_* or numeric), with
 * graceful fallback.
 */
export function membershipLevelToTier(level) {
  if (level == null) return "Unknown";
  const s = String(level).toUpperCase();
  if (TIER_BY_LEVEL[s]) return TIER_BY_LEVEL[s];
  const n = Number(level);
  if (Number.isFinite(n)) return TIER_BY_NUMERIC_LEVEL[n] ?? `Level ${n}`;
  return `Unknown (${level})`;
}

function ratioToPercent(ratio) {
  const n = Number(ratio);
  if (!Number.isFinite(n)) return null;
  return `${Math.round(n * 100)}%`;
}

/** Call one membership RPC method (plain JSON over POST). Returns parsed body. */
async function callConnectRpc(path, jwt, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${MEMBERSHIP_SVC}/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
        Cookie: `kimi-auth=${jwt}`,
        "connect-protocol-version": "1",
        "x-msh-version": "2.0.0",
        "x-msh-platform": "web",
      },
      // Unary, NOT the streaming Connect envelope: the membership service
      // expects a plain JSON body (web client sends content-length: 2, "{}").
      body: "{}",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * LIVE quota lookup: hit www.kimi.com with the desktop JWT. Returns the shaped
 * quota object, or null when the token is missing/invalid or the upstream call
 * fails (caller falls back to the local store).
 */
export async function fetchKimiDesktopQuotaLive(store) {
  const raw = store?.tokens?.access_token;
  if (!raw || !String(raw).startsWith("eyJ")) return null;
  const jwt = String(raw);
  try {
    const [subs, stats] = await Promise.all([
      callConnectRpc("ListSubscriptions", jwt),
      callConnectRpc("GetSubscriptionStats", jwt),
    ]);
    return buildKimiDesktopQuotaFromLive(subs, stats);
  } catch {
    return null;
  }
}

/** Shape the two live responses into the UI quota object. */
export function buildKimiDesktopQuotaFromLive(subs, stats) {
  const activeSub =
    (subs?.subscriptions || []).find((s) => s.active) ||
    (subs?.subscriptions || [])[0] ||
    null;

  const tier = activeSub?.goods?.title
    ? String(activeSub.goods.title)
    : membershipLevelToTier(activeSub?.goods?.membershipLevel);

  const sub = stats?.subscriptionBalance || null;
  const gifts = Array.isArray(stats?.giftBalances) ? stats.giftBalances : [];

  // Usage Detail: subscription + gift quotas. amountUsedRatio is fraction used.
  const usageDetail = {
    subscriptionQuota: sub ? ratioToPercent(sub.amountUsedRatio) : null,
    giftQuota: gifts.length
      ? gifts
          .map((g) => {
            const label = g.displayName || "Gift";
            return `${label}: ${ratioToPercent(g.amountUsedRatio)} used`;
          })
          .join(" · ")
      : null,
  };

  // My Quota: aggregate total + gift usage.
  const totalRatio = gifts.reduce((acc, g) => {
    const n = Number(g.amountUsedRatio);
    return Number.isFinite(n) ? acc + n : acc;
  }, Number(sub?.amountUsedRatio) || 0);
  const giftRatio = gifts.reduce((acc, g) => {
    const n = Number(g.amountUsedRatio);
    return Number.isFinite(n) ? acc + n : acc;
  }, 0);

  const myQuota = {
    totalUsage: ratioToPercent(totalRatio),
    giftUsage: ratioToPercent(giftRatio),
  };

  return {
    tier,
    source: "live",
    expiresAt: sub?.expireTime || activeSub?.currentEndTime || null,
    status: activeSub?.status || null,
    usageDetail,
    myQuota,
    raw: { subscriptions: subs?.subscriptions || [], stats },
  };
}

/**
 * LOCAL fallback: derive tier from the desktop store (JWT claims +
 * msh_user_subscription_data). No usage counters persisted there.
 */
export function buildKimiDesktopQuotaFromStore(store) {
  const tokens = store?.tokens || {};
  const claims = decodeJwtPayload(tokens.access_token);
  const membershipLevel =
    claims?.membership?.level != null ? Number(claims.membership.level) : null;

  const sub = parseMshUserSubscriptionData(store?.msh_user_subscription_data);
  const currentLevel =
    membershipLevel ?? (sub.currentMembershipLevel != null ? Number(sub.currentMembershipLevel) : null);

  const fmt = (v) => (v == null ? "N/A (desktop store)" : String(v));
  return {
    tier: membershipLevelToTier(currentLevel),
    membershipLevel: currentLevel,
    source: "store",
    usageDetail: {
      subscriptionQuota: fmt(sub.subscriptionQuota ?? sub.subscription_quota ?? sub.currentMembershipLevel),
      giftQuota: fmt(sub.giftQuota ?? sub.gift_quota),
    },
    myQuota: {
      totalUsage: fmt(sub.totalUsage ?? sub.total_usage),
      giftUsage: fmt(sub.giftUsage ?? sub.gift_usage),
    },
    subscriptionData: sub,
    tokenValid: !!claims,
  };
}

/**
 * Quota lookup for kimi-desktop: prefer LIVE (www.kimi.com Connect-RPC),
 * fall back to the desktop token store. Returns null when neither works.
 */
export async function getKimiDesktopQuota() {
  const store = await readKimiDesktopStore();
  if (!store) return null;

  const live = await fetchKimiDesktopQuotaLive(store);
  if (live) return live;

  return buildKimiDesktopQuotaFromStore(store);
}
