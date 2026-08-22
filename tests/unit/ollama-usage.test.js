import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => mockFetch(...args),
}));

function jsonResponse(status, data) {
  return { ok: status < 400, status, json: async () => data };
}

describe("getOllamaUsage — real quota tracker", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("parses session + weekly usage windows and plan label", async () => {
    const { getOllamaUsage } = await import("open-sse/services/usage/ollama.js");

    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { session: 0.25, weekly: 0.6 }))
      .mockResolvedValueOnce(jsonResponse(200, { plan: "Pro" }));

    const result = await getOllamaUsage("test-key", null);

    expect(result.quotas.session).toMatchObject({
      used: 250, total: 1000, remainingPercentage: 75,
    });
    expect(result.quotas.weekly).toMatchObject({
      used: 600, total: 1000, remainingPercentage: 40,
    });
    expect(result.plan).toBe("Pro");
  });

  it("returns graceful message when API key missing", async () => {
    const { getOllamaUsage } = await import("open-sse/services/usage/ollama.js");
    const result = await getOllamaUsage("", null);
    expect(result.message).toMatch(/API key/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("auth failure → helpful message, no crash", async () => {
    const { getOllamaUsage } = await import("open-sse/services/usage/ollama.js");
    mockFetch
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(401, {}));

    const result = await getOllamaUsage("bad-key", null);
    expect(result.message).toMatch(/invalid or expired/i);
  });

  it("endpoints unreachable → graceful fallback", async () => {
    const { getOllamaUsage } = await import("open-sse/services/usage/ollama.js");
    mockFetch.mockRejectedValueOnce(new Error("network down")).mockRejectedValueOnce(new Error("network down"));

    const result = await getOllamaUsage("test-key", null);
    expect(result.message).toMatch(/unavailable/i);
  });
});
