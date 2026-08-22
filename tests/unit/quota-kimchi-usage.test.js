// Unit tests for Kimchi usage tracking (/dashboard/quota integration).
//
// Verifies getKimchiUsage():
//   1. Parses credits (remaining, status) + budget (used/total/percentage/reset)
//   2. Handles missing token gracefully
//   3. Handles both endpoints failing gracefully
//   4. 401 → auth-expired message
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock proxyAwareFetch (used by the handler).
const mockFetch = vi.fn();
vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => mockFetch(...args),
}));

function jsonResponse(status, data) {
  return { ok: status < 400, status, json: async () => data };
}

describe("getKimchiUsage", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("parses credits + budget into quota rows", async () => {
    const { getKimchiUsage } = await import("open-sse/services/usage/kimchi.js");
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { remaining: 250, billing_status: "ok", tier: "Community" }))
      .mockResolvedValueOnce(jsonResponse(200, {
        period: { startTime: "2026-08-01T00:00:00Z", endTime: "2026-08-02T00:00:00Z" },
        budgets: [{ scope: "API_KEY", budgetLimitUsd: "10.00", totalSpendUsd: "4.00" }],
      }));

    const result = await getKimchiUsage("test-token", null);

    expect(result.quotas.credits.remaining).toBe(250);
    expect(result.quotas.credits.status).toBe("ok");
    expect(result.quotas.credits.remainingPercentage).toBeNull(); // no total

    expect(result.quotas.budget.used).toBe(4);
    expect(result.quotas.budget.total).toBe(10);
    expect(result.quotas.budget.remainingPercentage).toBe(60); // (10-4)/10*100
    expect(result.quotas.budget.resetAt).toBe("2026-08-02T00:00:00.000Z");
    expect(result.quotas.budget.unit).toBe("usd");
  });

  it("handles missing token", async () => {
    const { getKimchiUsage } = await import("open-sse/services/usage/kimchi.js");
    const result = await getKimchiUsage("", null);
    expect(result.message).toMatch(/access token/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("both endpoints fail → graceful message", async () => {
    const { getKimchiUsage } = await import("open-sse/services/usage/kimchi.js");
    mockFetch
      .mockResolvedValueOnce(jsonResponse(500, {}))
      .mockResolvedValueOnce(jsonResponse(500, {}));
    const result = await getKimchiUsage("test-token", null);
    expect(result.message).toMatch(/unavailable/i);
  });

  it("401 → auth-expired message (triggers re-auth flow)", async () => {
    const { getKimchiUsage } = await import("open-sse/services/usage/kimchi.js");
    mockFetch
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(401, {}));
    const result = await getKimchiUsage("expired-token", null);
    expect(result.message).toMatch(/expired/i);
  });

  it("uses API_KEY budget entry when multiple scopes exist", async () => {
    const { getKimchiUsage } = await import("open-sse/services/usage/kimchi.js");
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { remaining: 100 }))
      .mockResolvedValueOnce(jsonResponse(200, {
        period: { endTime: "2026-08-03T00:00:00Z" },
        budgets: [
          { scope: "USER", budgetLimitUsd: "50", totalSpendUsd: "25" },
          { scope: "API_KEY", budgetLimitUsd: "20", totalSpendUsd: "5" },
        ],
      }));
    const result = await getKimchiUsage("test-token", null);
    expect(result.quotas.budget.total).toBe(20); // API_KEY preferred over USER
    expect(result.quotas.budget.remainingPercentage).toBe(75);
  });
});
