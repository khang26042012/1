import { describe, it, expect } from "vitest";

import { createComboBudget } from "../../open-sse/services/comboBudget.js";

// Budget limit toggle — default OFF. When off the combo runs uncapped, so a
// cost-budget that WOULD exceed its own max (enabled:true) passes here.
describe("combo budget limit toggle", () => {
  // 1 token-input estimate per ~4 chars of body → cheap normal prompt.
  // claude-opus output $25/M so the 4000-char default cap is ~$0.10 — set a
  // stricter max (enabled:true) to force a triple over budget.
  const leaves = [{ provider: "anthropic", model: "claude-opus-4-6" }];
  const configOff = { budgets: { enabled: false, maxEstimatedCostUsd: 0.01 } };
  const configOn = { budgets: { enabled: true, maxEstimatedCostUsd: 0.01 } };

  it("defaults budgets.enabled to false", () => {
    const b = createComboBudget({ body: { x: 1 }, config: {}, leaves, logicalCalls: 1 });
    expect(b.limits.enabled).toBe(false);
  });

  it("bypasses the cost guard when enabled is false", () => {
    const b = createComboBudget({ body: { x: 1 }, config: configOff, leaves, logicalCalls: 1 });
    expect(b.ok).toBe(true);
  });

  it("enforces maxEstimatedCostUsd when enabled is true", () => {
    const b = createComboBudget({ body: { x: 1 }, config: configOn, leaves, logicalCalls: 1 });
    expect(b.ok).toBe(false);
    expect(b.code).toBe("combo_cost_budget_exceeded");
  });
});