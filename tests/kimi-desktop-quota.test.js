import { describe, it, expect } from "vitest";
import { readKimiDesktopStore } from "../src/lib/oauth/services/kimi-desktop.js";
import {
  parseMshUserSubscriptionData,
  membershipLevelToTier,
  buildKimiDesktopQuotaFromStore,
  buildKimiDesktopQuotaFromLive,
  fetchKimiDesktopQuotaLive,
  getKimiDesktopQuota,
} from "../src/lib/oauth/services/kimi-desktop-quota.js";

describe("kimi-desktop-quota helpers", () => {
  it("parseMshUserSubscriptionData: string -> object", () => {
    expect(parseMshUserSubscriptionData("{\"currentMembershipLevel\":10}")).toEqual({ currentMembershipLevel: 10 });
  });
  it("parseMshUserSubscriptionData: object -> passthrough", () => {
    expect(parseMshUserSubscriptionData({ a: 1 })).toEqual({ a: 1 });
  });
  it("parseMshUserSubscriptionData: null/garbage -> {}", () => {
    expect(parseMshUserSubscriptionData(null)).toEqual({});
    expect(parseMshUserSubscriptionData("x")).toEqual({});
  });

  it("buildKimiDesktopQuotaFromLive normalizes ratio -> percent", () => {
    const q = buildKimiDesktopQuotaFromLive(
      { subscriptions: [{ goods: { title: "Kimi Code", membershipLevel: 10 }, active: true }] },
      {
        subscriptionBalance: { amountUsedRatio: 0.42, expireTime: "2026-09-01T00:00:00Z" },
        giftBalances: [{ displayName: "Gift 7d", amountUsedRatio: 0.1 }],
      },
    );
    expect(q.tier).toBe("Kimi Code");
    expect(q.usageDetail.subscriptionQuota).toBe("42%");
    expect(q.usageDetail.giftQuota).toContain("Gift 7d: 10% used");
  });

  it("membershipLevelToTier maps known levels", () => {
    expect(membershipLevelToTier(0)).toBe("Free");
    expect(membershipLevelToTier(10)).toBe("Kimi Code");
    expect(membershipLevelToTier(99)).toBe("Level 99");
    expect(membershipLevelToTier("x")).toBe("Unknown (x)");
  });

  it("buildKimiDesktopQuotaFromStore: no token -> unknown", () => {
    const q = buildKimiDesktopQuotaFromStore({ tokens: {}, msh_user_subscription_data: null });
    expect(q.tier).toBe("Unknown");
    expect(q.membershipLevel).toBeNull();
    expect(q.tokenValid).toBe(false);
  });

  it("buildKimiDesktopQuotaFromStore: membership.level in JWT + subscriptionData", () => {
    const enc = (obj) =>
      Buffer.from(JSON.stringify(obj)).toString("base64url");
    const jwt = `h.${enc({ membership: { level: 2 } })}.s`;
    const q = buildKimiDesktopQuotaFromStore({
      tokens: { access_token: jwt },
      msh_user_subscription_data: JSON.stringify({ giftQuota: 500 }),
    });
    expect(q.tier).toBe("Allegretto");
    expect(q.membershipLevel).toBe(2);
    expect(q.tokenValid).toBe(true);
    expect(q.usageDetail.giftQuota).toBe("500");
  });
});

// Live tests hit www.kimi.com. Without the desktop token store on this
// machine they early-return (pass trivially) so CI stays green; with a store
// they assert the real responses.
describe("kimi-desktop-quota live", () => {
  it("fetchKimiDesktopQuotaLive hits www.kimi.com and returns shaped quota", async () => {
    const store = await readKimiDesktopStore();
    if (!store) {
      console.log("[skip live] Kimi Desktop token store not found");
      return;
    }
    const quota = await fetchKimiDesktopQuotaLive(store);
    expect(quota).toBeTruthy();
    expect(quota.tier).toBeTruthy();
    expect(quota.source).toBe("live");
    expect(typeof quota.usageDetail.subscriptionQuota).toBe("string");
    expect(Array.isArray(quota.raw.stats.giftBalances)).toBe(true);
  });

  it("getKimiDesktopQuota prefers live and falls back to store", async () => {
    const store = await readKimiDesktopStore();
    if (!store) {
      console.log("[skip desktop] Kimi Desktop token store not found");
      return;
    }
    const quota = await getKimiDesktopQuota();
    expect(quota).toBeTruthy();
    expect(["live", "store"]).toContain(quota.source);
  });
});