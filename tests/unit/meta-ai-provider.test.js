import { describe, it, expect } from "vitest";
import { PROVIDER_PRICING, getPricingForModel } from "../../open-sse/providers/pricing.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

describe("Meta AI provider pricing", () => {
  it("has a meta-ai entry in PROVIDER_PRICING", () => {
    expect(PROVIDER_PRICING["meta-ai"]).toBeDefined();
  });

  it("covers the full Muse Spark price table (3 models)", () => {
    expect(Object.keys(PROVIDER_PRICING["meta-ai"])).toEqual([
      "muse-spark-1.2",
      "muse-spark-1.2-contributor",
      "muse-spark-1.1",
    ]);
  });

  it("resolves standard-tier pricing (1.2 / 1.1)", () => {
    for (const m of ["muse-spark-1.2", "muse-spark-1.1"]) {
      expect(getPricingForModel("meta-ai", m)).toMatchObject({
        input: 1.25, output: 4.25, cached: 0.15, reasoning: 4.25,
      });
    }
  });

  it("resolves contributor-tier pricing (data-sharing)", () => {
    expect(getPricingForModel("meta-ai", "muse-spark-1.2-contributor")).toMatchObject({
      input: 0.10, output: 0.20, cached: 0.15, reasoning: 0.20,
    });
  });
});

describe("Meta AI provider capabilities", () => {
  it("is registered in the registry with dual-format transports", () => {
    const entry = REGISTRY.find((r) => r.id === "meta-ai");
    expect(entry).toBeDefined();
    expect(entry.alias).toBe("ma");
    expect(entry.transports.map((t) => t.format)).toEqual(["openai", "claude"]);
    expect(entry.pricing).toBe("meta-ai");
  });

  it("resolves Muse Spark 1M/131K reasoning caps for all models", () => {
    for (const m of ["muse-spark-1.2", "muse-spark-1.2-contributor", "muse-spark-1.1"]) {
      expect(getCapabilitiesForModel("meta-ai", m)).toMatchObject({
        reasoning: true,
        thinkingFormat: "openai",
        thinkingCanDisable: false,
        thinkingLevels: ["minimal", "low", "medium", "high", "xhigh"],
        contextWindow: 1048576,
        maxOutput: 131072,
      });
    }
  });
});