import { describe, it, expect } from "vitest";
import { PROVIDER_PRICING, getPricingForModel } from "../../open-sse/providers/pricing.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

describe("TokenHarbor provider pricing", () => {
  it("has a tokenharbor entry in PROVIDER_PRICING", () => {
    expect(PROVIDER_PRICING.tokenharbor).toBeDefined();
  });

  it("covers the full user price table (10 models)", () => {
    expect(Object.keys(PROVIDER_PRICING.tokenharbor)).toEqual([
      "claude-opus-5",
      "claude-fable-5",
      "gpt-5.6-sol",
      "kimi-k3",
      "qwen3.8-max",
      "gpt-5.6-terra",
      "grok-4.5",
      "claude-sonnet-5",
      "glm-5.2",
      "gemini-3.6-flash",
    ]);
  });

  it("resolves flagship Claude models at listed prices", () => {
    expect(getPricingForModel("tokenharbor", "claude-opus-5")).toMatchObject({
      input: 5, output: 25, reasoning: 25,
    });
    expect(getPricingForModel("tokenharbor", "claude-fable-5")).toMatchObject({
      input: 10, output: 50, reasoning: 50,
    });
    expect(getPricingForModel("tokenharbor", "claude-sonnet-5")).toMatchObject({
      input: 2, output: 10, reasoning: 10,
    });
  });

  it("resolves OpenAI-format gateway models", () => {
    expect(getPricingForModel("tokenharbor", "gpt-5.6-sol")).toMatchObject({
      input: 5, output: 30,
    });
    expect(getPricingForModel("tokenharbor", "gpt-5.6-terra")).toMatchObject({
      input: 2, output: 12,
    });
  });

  it("resolves third-party gateway models", () => {
    expect(getPricingForModel("tokenharbor", "kimi-k3")).toMatchObject({ input: 3, output: 15 });
    expect(getPricingForModel("tokenharbor", "qwen3.8-max")).toMatchObject({ input: 2, output: 6 });
    expect(getPricingForModel("tokenharbor", "grok-4.5")).toMatchObject({ input: 2, output: 6 });
    expect(getPricingForModel("tokenharbor", "glm-5.2")).toMatchObject({ input: 1.4, output: 4.4 });
    expect(getPricingForModel("tokenharbor", "gemini-3.6-flash")).toMatchObject({ input: 1.5, output: 7.5 });
  });
});

describe("TokenHarbor provider capabilities", () => {
  it("is registered in the registry with dual-format transports", () => {
    const entry = REGISTRY.find((r) => r.id === "tokenharbor");
    expect(entry).toBeDefined();
    expect(entry.alias).toBe("th");
    expect(entry.transports.map((t) => t.format)).toEqual(["openai", "claude"]);
    expect(entry.pricing).toBe("tokenharbor");
  });

  it("pins Claude flagships to claude-adaptive 1M/128k", () => {
    for (const m of ["claude-opus-5", "claude-fable-5"]) {
      expect(getCapabilitiesForModel("tokenharbor", m)).toMatchObject({
        thinkingFormat: "claude-adaptive",
        contextWindow: 1000000,
        maxOutput: 128000,
        reasoning: true,
      });
    }
  });

  it("keeps claude-sonnet-5 on the canonical claude-adaptive block", () => {
    expect(getCapabilitiesForModel("tokenharbor", "claude-sonnet-5")).toMatchObject({
      thinkingFormat: "claude-adaptive",
      contextWindow: 1000000,
    });
  });
});
