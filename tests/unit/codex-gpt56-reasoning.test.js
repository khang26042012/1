/**
 * Codex GPT-5.6 Max/Ultra reasoning overrides (port of decolua/9router design).
 *
 * Matrix: Sol/Terra → full range + ultra; Luna → max ceiling; Kiro retains its
 * own native set (provider-scoped — the codex overrides must NOT leak onto
 * kiro/gpt-5.6-* and vice versa).
 */

import { describe, it, expect } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { parseSuffix, applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";

describe("codex GPT-5.6 thinking levels (getThinkingLevels)", () => {
  it("Sol supports the full range plus ultra", () => {
    const levels = getThinkingLevels("codex", "gpt-5.6-sol");
    expect(levels).toContain("max");
    expect(levels).toContain("ultra");
  });

  it("Terra supports the full range plus ultra", () => {
    const levels = getThinkingLevels("codex", "gpt-5.6-terra");
    expect(levels).toContain("max");
    expect(levels).toContain("ultra");
  });

  it("Luna tops out at max — no ultra", () => {
    const levels = getThinkingLevels("codex", "gpt-5.6-luna");
    expect(levels).toContain("max");
    expect(levels).not.toContain("ultra");
  });

  it("older codex models keep the xhigh ceiling (no max/ultra)", () => {
    const levels = getThinkingLevels("codex", "gpt-5.5");
    expect(levels).not.toContain("max");
    expect(levels).not.toContain("ultra");
  });

  it("review variants inherit the base model levels (wildcard)", () => {
    const solReview = getThinkingLevels("codex", "gpt-5.6-sol-review");
    expect(solReview).toContain("ultra");
    const lunaReview = getThinkingLevels("codex", "gpt-5.6-luna-review");
    expect(lunaReview).not.toContain("ultra");
  });

  it("Kiro GPT-5.6 is provider-isolated — no ultra leaks", () => {
    const kiroLevels = getThinkingLevels("kiro", "gpt-5.6-sol");
    expect(kiroLevels).toContain("max");
    expect(kiroLevels).not.toContain("ultra");
  });
});

describe("codex GPT-5.6 suffix parsing + level clamping (translator)", () => {
  it("parses the (ultra) suffix as a level override", () => {
    const { cleanModel, override } = parseSuffix("cx/gpt-5.6-sol(ultra)");
    expect(cleanModel).toBe("cx/gpt-5.6-sol");
    expect(override).toEqual({ mode: "level", level: "ultra" });
  });

  it("preserves ultra for Sol (openai wire format)", () => {
    const body = applyThinking("openai", "cx/gpt-5.6-sol(ultra)", { messages: [] }, "codex");
    expect(body.reasoning_effort).toBe("ultra");
  });

  it("collapses ultra → max for Luna (highest supported)", () => {
    const body = applyThinking("openai", "cx/gpt-5.6-luna(ultra)", { messages: [] }, "codex");
    expect(body.reasoning_effort).toBe("max");
  });

  it("collapses unsupported max → xhigh for older codex models", () => {
    const body = applyThinking("openai", "cx/gpt-5.5(max)", { messages: [] }, "codex");
    expect(body.reasoning_effort).toBe("xhigh");
  });

  it("preserves max for Sol", () => {
    const body = applyThinking("openai", "cx/gpt-5.6-sol(max)", { messages: [] }, "codex");
    expect(body.reasoning_effort).toBe("max");
  });
});

describe("codex GPT-5.6 capabilities + registry", () => {
  it("Sol advertises the 372k window; Terra/Luna 272k", () => {
    expect(getCapabilitiesForModel("codex", "gpt-5.6-sol").contextWindow).toBe(372000);
    expect(getCapabilitiesForModel("codex", "gpt-5.6-terra").contextWindow).toBe(272000);
    expect(getCapabilitiesForModel("codex", "gpt-5.6-luna").contextWindow).toBe(272000);
  });

  it("registers all six models in the codex model list", () => {
    // PROVIDER_MODELS is keyed by ALIAS (cx), not provider id.
    const ids = (PROVIDER_MODELS.cx || []).map((m) => m.id);
    for (const id of ["gpt-5.6-sol", "gpt-5.6-sol-review", "gpt-5.6-terra", "gpt-5.6-terra-review", "gpt-5.6-luna", "gpt-5.6-luna-review"]) {
      expect(ids).toContain(id);
    }
  });
});