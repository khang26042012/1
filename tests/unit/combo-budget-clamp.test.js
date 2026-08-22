/**
 * Regression tests for createComboBudget.clampOutput.
 *
 * Bug: `value.slice(0, remaining || limits.maxOutputChars)` — when remaining
 * reached 0 (aggregate cap exhausted), `0 || fallback` reverted to the per-call
 * cap, so a 3rd+ output breached maxAggregateOutputChars. Reproduced original:
 * cap 5000, three 4000-char answers → 4000+1000+4000 = 9000.
 *
 * Fix: slice to `remaining` directly; at 0 the output is dropped ("") so
 * callers (fusion/swarm) treat it as over-budget.
 */

import { describe, it, expect } from "vitest";
import { createComboBudget } from "../../open-sse/services/comboBudget.js";

function budget() {
  return createComboBudget({
    body: { messages: [{ role: "user", content: "x" }] },
    config: {
      budgets: { enabled: true, maxOutputChars: 4000, maxAggregateOutputChars: 5000, maxLogicalCalls: 99, maxEstimatedCostUsd: 99 },
    },
    leaves: [],
    logicalCalls: 2,
  });
}

describe("combo budget aggregate clamp", () => {
  it("skips the call cap entirely when budgets are disabled (unlimited legacy)", () => {
    const b = createComboBudget({
      body: { messages: [{ role: "user", content: "x" }] },
      config: { budgets: { enabled: false } }, // default: unlimited
      leaves: [],
      logicalCalls: 40,
    });
    expect(b.ok).toBe(true);
  });

  it("enforces the call cap when budgets are enabled", () => {
    const b = createComboBudget({
      body: { messages: [{ role: "user", content: "x" }] },
      config: { budgets: { enabled: true, maxLogicalCalls: 16, maxEstimatedCostUsd: 99 } },
      leaves: [],
      logicalCalls: 17,
    });
    expect(b.ok).toBe(false);
    expect(b.code).toBe("combo_call_budget_exceeded");
  });

  it("never lets aggregate output exceed maxAggregateOutputChars", () => {
    const b = budget();
    expect(b.clampOutput("A".repeat(4000)).length).toBe(4000); // A1: 4000
    expect(b.clampOutput("B".repeat(4000)).length).toBe(1000); // A2: remaining 1000
    // A3: aggregate already at cap → remaining 0 → dropped, NOT 4000.
    expect(b.clampOutput("C".repeat(4000))).toBe("");
    expect(b.snapshot().aggregateOutputChars).toBe(5000);
    expect(b.snapshot().aggregateOutputChars <= 5000).toBe(true);
  });

  it("drops output entirely once the aggregate cap is exhausted (fusion/swarm drop contract)", () => {
    const b = budget();
    b.clampOutput("A".repeat(4000));
    b.clampOutput("B".repeat(4000));
    const dropped = b.clampOutput("C".repeat(4000));
    // Truthiness contract relied on by combo.js:652 (falsy → skip panel)
    // and swarm.js:368 (`rawText && !text` → over_budget failure).
    expect(!!dropped).toBe(false);
  });

  it("still clamps a single oversized answer to maxOutputChars", () => {
    const b = budget();
    expect(b.clampOutput("Z".repeat(9000)).length).toBe(4000);
    expect(b.snapshot().aggregateOutputChars).toBe(4000);
  });
});