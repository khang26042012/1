import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// Claude Opus 4.6+ ships a 1M-token context window (GA, standard pricing).
// The registry exposes dashed ids (claude-opus-4-8, claude-opus-4-7), which
// must resolve to the 1M context + adaptive thinking caps rather than falling
// through to the generic *claude*opus* pattern (200k / budget thinking).
describe("Claude Opus 1M context capabilities", () => {
  const expected = {
    contextWindow: 1000000,
    maxOutput: 128000,
    thinkingFormat: "claude-adaptive",
    reasoning: true,
    vision: true,
    search: true,
  };

  for (const model of [
    "claude-opus-4-8",
    "claude-opus-4.8",
    "claude-opus-4-7",
    "claude-opus-4.7",
    "claude-opus-4-6",
  ]) {
    it(`resolves ${model} to a 1M context window`, () => {
      expect(getCapabilitiesForModel("cc", model)).toMatchObject(expected);
    });
  }

  it("keeps the older Opus 4.5 at the standard 200k context", () => {
    expect(getCapabilitiesForModel("cc", "claude-opus-4-5-20251101").contextWindow).toBe(200000);
  });
});

// Per-vendor window specs (vendor docs):
//   kimi-k3           ctx 1,048,576 / out 1,048,576
//   laguna-s-2.1      paid tier ctx 1,048,576 / out 131,072
//   step-3.7-flash    ctx 256,000 / out 256,000
describe("context/maxOutput windows for kimi-k3, laguna-s-2.1, step-3.7", () => {
  it("kimi-k3 → 1M context + 1M output", () => {
    expect(getCapabilitiesForModel("moonshot", "kimi-k3")).toMatchObject({ contextWindow: 1048576, maxOutput: 1048576 });
  });
  it("laguna-s-2.1 → 1M context + 131072 output (paid tier)", () => {
    expect(getCapabilitiesForModel("cline", "poolside/laguna-s-2.1:free")).toMatchObject({ contextWindow: 1048576, maxOutput: 131072 });
  });
  it("step-3.7-flash → 256k context + 256k output", () => {
    expect(getCapabilitiesForModel("stepfun", "step-3.7-flash")).toMatchObject({ contextWindow: 256000, maxOutput: 256000 });
  });
});

// CodeBuddy-family gateways (codebuddy-intl / workbuddy) resolve every model to
// OpenAI-style reasoning_effort — including WorkBuddy's flagship "hy3" model,
// which must NOT fall through to the generic *hy3* hunyuan pattern.
describe("codebuddy-intl + workbuddy capabilities", () => {
  it("workbuddy hy3 → openai reasoning, not hunyuan", () => {
    const c = getCapabilitiesForModel("workbuddy", "hy3");
    expect(c.reasoning).toBe(true);
    expect(c.thinkingFormat).toBe("openai");
    expect(c.thinkingCanDisable).toBe(false);
  });
  it("codebuddy-intl mirrors codebuddy-cn caps (glm-5.1 → 200k openai)", () => {
    const c = getCapabilitiesForModel("codebuddy-intl", "glm-5.1");
    expect(c.thinkingFormat).toBe("openai");
    expect(c.contextWindow).toBe(200000);
  });
});
