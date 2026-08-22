import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetchWithTimeout = vi.fn();
vi.mock("open-sse/services/usage/shared.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchWithTimeout: (...args) => mockFetchWithTimeout(...args),
  };
});

function jsonResponse(status, data) {
  return { ok: status < 400, status, json: async () => data };
}

describe("getAntigravityUsage — Gemini 3.6 Flash in importantModels", () => {
  beforeEach(() => {
    mockFetchWithTimeout.mockReset();
  });

  it("returns quotas for Gemini 3.6 Flash tiers alongside existing models", async () => {
    const { getAntigravityUsage } = await import("open-sse/services/usage/google.js");

    // subscription info call → cloudaicompanionProject
    mockFetchWithTimeout.mockResolvedValueOnce(jsonResponse(200, {
      cloudaicompanionProject: "project-1",
      currentTier: { name: "Pro" },
    }));
    // quota API call
    mockFetchWithTimeout.mockResolvedValueOnce(jsonResponse(200, {
      models: {
        "gemini-3.6-flash-high": {
          displayName: "Gemini 3.6 Flash (High)",
          quotaInfo: { remainingFraction: 0.8, resetTime: "2026-07-25T12:00:00Z" },
        },
        "gemini-3.6-flash-medium": {
          displayName: "Gemini 3.6 Flash (Medium)",
          quotaInfo: { remainingFraction: 0.5, resetTime: "2026-07-25T12:00:00Z" },
        },
        "gemini-3.6-flash-low": {
          displayName: "Gemini 3.6 Flash (Low)",
          quotaInfo: { remainingFraction: 0.2, resetTime: "2026-07-25T12:00:00Z" },
        },
        "gemini-3.5-flash-low": {
          displayName: "Gemini 3.5 Flash (Medium)",
          quotaInfo: { remainingFraction: 0.9, resetTime: "2026-07-25T12:00:00Z" },
        },
        "internal-model": {
          displayName: "Internal",
          isInternal: true,
        },
      },
    }));

    const usage = await getAntigravityUsage("access-token", {}, {});

    expect(usage.quotas["gemini-3.6-flash-high"]).toMatchObject({
      used: 200, total: 1000, remainingPercentage: 80,
    });
    expect(usage.quotas["gemini-3.6-flash-medium"]).toMatchObject({
      used: 500, total: 1000, remainingPercentage: 50,
    });
    expect(usage.quotas["gemini-3.6-flash-low"]).toMatchObject({
      used: 800, total: 1000, remainingPercentage: 20,
    });
  });

  it("filters out non-important and internal models", async () => {
    const { getAntigravityUsage } = await import("open-sse/services/usage/google.js");

    mockFetchWithTimeout.mockResolvedValueOnce(jsonResponse(200, {
      cloudaicompanionProject: "project-1",
      currentTier: { name: "Pro" },
    }));
    mockFetchWithTimeout.mockResolvedValueOnce(jsonResponse(200, {
      models: {
        "gemini-3.6-flash-high": {
          displayName: "Gemini 3.6 Flash (High)",
          quotaInfo: { remainingFraction: 0.8, resetTime: "2026-07-25T12:00:00Z" },
        },
        "gemini-3.6-flash-medium": {
          displayName: "Gemini 3.6 Flash (Medium)",
          quotaInfo: { remainingFraction: 0.5, resetTime: "2026-07-25T12:00:00Z" },
        },
        "gemini-3.6-flash-low": {
          displayName: "Gemini 3.6 Flash (Low)",
          quotaInfo: { remainingFraction: 0.2, resetTime: "2026-07-25T12:00:00Z" },
        },
        "gemini-3.5-flash-low": {
          displayName: "Gemini 3.5 Flash (Medium)",
          quotaInfo: { remainingFraction: 0.9, resetTime: "2026-07-25T12:00:00Z" },
        },
        "internal-model": {
          displayName: "Internal",
          isInternal: true,
        },
      },
    }));

    const usage = await getAntigravityUsage("access-token", {}, {});

    expect(usage.quotas).not.toHaveProperty("internal-model");
    expect(Object.keys(usage.quotas)).toEqual([
      "gemini-3.6-flash-high",
      "gemini-3.6-flash-medium",
      "gemini-3.6-flash-low",
      "gemini-3.5-flash-low",
    ]);
  });
});