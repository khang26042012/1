// Unit tests for Kimchi quota detection + auto-reactivation.
//
// Verifies:
//   1. isKimchiQuotaExhaustedError detects 402 + credit/quota message patterns
//   2. buildKimchiQuotaExhaustedUpdate sets quota_exhausted + next-day reset
//   3. buildKimchiQuotaReactivatedUpdate clears quota state
//   4. reactivateExpiredKimchiAccounts reactivates only expired cooldowns
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isKimchiQuotaExhaustedError,
  buildKimchiQuotaExhaustedUpdate,
  buildKimchiQuotaReactivatedUpdate,
  getNextDayReset,
} from "open-sse/services/accountFallback.js";

// Mock the DB layer used by the sweep (dynamic import inside the function).
const mockGet = vi.fn();
const mockUpdate = vi.fn();
vi.mock("@/lib/localDb.js", () => ({
  getProviderConnections: (...a) => mockGet(...a),
  updateProviderConnection: (...a) => mockUpdate(...a),
}));

describe("isKimchiQuotaExhaustedError", () => {
  it("detects 402 status", () => {
    expect(isKimchiQuotaExhaustedError(402, "anything")).toBe(true);
  });

  it("detects 'out of credits' message", () => {
    expect(isKimchiQuotaExhaustedError(429, "You ran out of credits. Top up at https://app.kimchi.dev/billing")).toBe(true);
  });

  it("detects quota exhausted text", () => {
    expect(isKimchiQuotaExhaustedError(429, '{"error":{"message":"Your quota has been exhausted"}}')).toBe(true);
  });

  it("does NOT false-positive on plain rate limits", () => {
    expect(isKimchiQuotaExhaustedError(429, "rate limit exceeded, retry in 30s")).toBe(false);
    expect(isKimchiQuotaExhaustedError(500, "internal server error")).toBe(false);
  });
});

describe("buildKimchiQuotaExhaustedUpdate", () => {
  it("deactivates with quota_exhausted status + next-day reset", () => {
    const now = new Date("2026-08-02T10:00:00Z");
    const update = buildKimchiQuotaExhaustedUpdate(now);
    expect(update.isActive).toBe(false);
    expect(update.testStatus).toBe("quota_exhausted");
    expect(update.errorCode).toBe(402);
    expect(update.quotaExhaustedAt).toBe("2026-08-02T10:00:00.000Z");
    // Reset = 00:00 UTC next day (2026-08-03)
    expect(update.quotaResetsAt).toBe("2026-08-03T00:00:00.000Z");
    expect(update.rateLimitedUntil).toBe("2026-08-03T00:00:00.000Z");
  });

  it("getNextDayReset is 00:00 UTC next day", () => {
    const reset = getNextDayReset(new Date("2026-08-02T23:59:59Z"));
    expect(reset.toISOString()).toBe("2026-08-03T00:00:00.000Z");
  });
});

describe("buildKimchiQuotaReactivatedUpdate", () => {
  it("reactivates + clears quota state", () => {
    const update = buildKimchiQuotaReactivatedUpdate();
    expect(update.isActive).toBe(true);
    expect(update.testStatus).toBe("active");
    expect(update.rateLimitedUntil).toBeNull();
    expect(update.quotaExhaustedAt).toBeNull();
    expect(update.quotaResetsAt).toBeNull();
  });
});

describe("reactivateExpiredKimchiAccounts sweep", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGet.mockReset();
    mockUpdate.mockReset();
  });

  it("reactivates accounts whose cooldown has passed", async () => {
    const { reactivateExpiredKimchiAccounts } = await import("@/sse/services/kimchiQuotaReactivation.js");
    mockGet.mockResolvedValue([
      { id: "expired-1", name: "acc1", testStatus: "quota_exhausted", rateLimitedUntil: "2026-08-01T00:00:00.000Z" },
      { id: "future-1", name: "acc2", testStatus: "quota_exhausted", rateLimitedUntil: "2099-01-01T00:00:00.000Z" },
      { id: "manual-1", name: "acc3", testStatus: "unavailable", rateLimitedUntil: "2026-07-01T00:00:00.000Z" },
    ]);

    const count = await reactivateExpiredKimchiAccounts();

    expect(count).toBe(1); // only expired-1 reactivated
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith("expired-1", expect.objectContaining({ isActive: true, testStatus: "active" }));
  });

  it("returns 0 when no connections or none expired", async () => {
    const { reactivateExpiredKimchiAccounts } = await import("@/sse/services/kimchiQuotaReactivation.js");
    mockGet.mockResolvedValue([]);
    expect(await reactivateExpiredKimchiAccounts()).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("handles query errors gracefully", async () => {
    const { reactivateExpiredKimchiAccounts } = await import("@/sse/services/kimchiQuotaReactivation.js");
    mockGet.mockRejectedValue(new Error("db down"));
    expect(await reactivateExpiredKimchiAccounts()).toBe(0);
  });
});
