import { describe, it, expect } from "vitest";
import { PROVIDER_PRICING, getPricingForModel } from "../../open-sse/providers/pricing.js";

describe("TokenRouter provider pricing", () => {
  it("has a tokenrouter entry in PROVIDER_PRICING", () => {
    expect(PROVIDER_PRICING.tokenrouter).toBeDefined();
  });

  it("resolves vendor-prefixed model via getPricingForModel", () => {
    const pricing = getPricingForModel("tokenrouter", "anthropic/claude-sonnet-4.6");
    expect(pricing).toMatchObject({ input: 3.0, output: 15.0, cached: 0.3, reasoning: 15.0 });
  });

  it("resolves non-prefixed gateway model", () => {
    const pricing = getPricingForModel("tokenrouter", "MiniMax-M3");
    expect(pricing).toMatchObject({ input: 0.3, output: 1.2, cached: 0.06, reasoning: 1.2 });
  });

  it("covers the full model catalog (110+ entries)", () => {
    expect(Object.keys(PROVIDER_PRICING.tokenrouter).length).toBeGreaterThanOrEqual(110);
  });

  it("fallback: unlisted model falls through to canonical MODEL_PRICING", () => {
    // gpt-5.6-luna is listed in tokenrouter, but a made-up unlisted model
    // should fall through to the canonical pattern (not crash).
    const pricing = getPricingForModel("tokenrouter", "anthropic/claude-sonnet-9");
    expect(pricing).not.toBeNull();
  });
});