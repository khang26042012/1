/**
 * Headroom effective payload savings reporting:
 *  - captureSizeSnapshot breaks out tool schema / tool_choice / system /
 *    history / current-turn bytes (tool schema + history dominate outbound
 *    payloads and are exactly what compression targets)
 *  - formatEffectivePayloadSavings reports the ACTUAL outbound JSON byte
 *    delta as a percentage — independent of the proxy's reported token delta
 *  - backward compatible: old { bodyBytes, messageBytes } consumers keep working
 */

import { describe, it, expect } from "vitest";
import {
  captureSizeSnapshot,
  formatEffectivePayloadSavings,
  formatHeadroomSizeLog,
  formatHeadroomLog,
  buildHeadroomBytesSample,
} from "../../open-sse/rtk/headroom.js";

function sampleBody() {
  return {
    model: "gpt-5.6-sol",
    tools: [{ type: "function", function: { name: "search", parameters: { type: "object", properties: { q: { type: "string" } } } } }],
    tool_choice: { type: "function", function: { name: "search" } },
    system: "You are a helpful assistant.",
    messages: [
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
      { role: "user", content: "current question" },
    ],
  };
}

describe("captureSizeSnapshot breakdown", () => {
  it("breaks out tool schema, tool_choice, system, history and current turn", () => {
    const s = captureSizeSnapshot(sampleBody());
    expect(s.bodyBytes).toBeGreaterThan(0);
    expect(s.messageBytes).toBeGreaterThan(0);
    expect(s.toolsBytes).toBeGreaterThan(0);          // tool schema present
    expect(s.toolChoiceBytes).toBeGreaterThan(0);
    expect(s.systemBytes).toBeGreaterThan(0);
    expect(s.historyBytes).toBeGreaterThan(0);        // first two messages
    expect(s.currentTurnBytes).toBeGreaterThan(0);    // trailing user message
    expect(s.historyBytes).toBeLessThan(s.messageBytes);
  });

  it("history excludes the trailing user turn (current turn is separate)", () => {
    const s = captureSizeSnapshot(sampleBody());
    const firstUser = JSON.stringify({ role: "user", content: "old question" });
    const lastUser = JSON.stringify({ role: "user", content: "current question" });
    // history = messages minus current turn = firstUser + assistant message.
    expect(s.historyBytes).toBeGreaterThan(firstUser.length);
    expect(s.currentTurnBytes).toBe(lastUser.length);
  });

  it("returns zeros for empty/undefined pieces without throwing", () => {
    const s = captureSizeSnapshot({ model: "x", messages: [{ role: "user", content: "hi" }] });
    expect(s.toolsBytes).toBe(0);
    expect(s.toolChoiceBytes).toBe(0);
    expect(s.systemBytes).toBe(0);
    expect(s.historyBytes).toBe(0);
    expect(s.currentTurnBytes).toBeGreaterThan(0);
  });
});

describe("formatEffectivePayloadSavings", () => {
  it("reports the actual outbound byte delta as a percentage", () => {
    const line = formatEffectivePayloadSavings({
      before: { bodyBytes: 1000, toolsBytes: 400, historyBytes: 300 },
      after: { bodyBytes: 600, toolsBytes: 100, historyBytes: 150 },
    });
    expect(line).toContain("effectivePayloadSavings=40.0%");
    expect(line).toContain("body=1000B→600B");
    expect(line).toContain("tools=400B→100B");
    expect(line).toContain("history=300B→150B");
  });

  it("reports 0.0% when nothing shrank", () => {
    const line = formatEffectivePayloadSavings({
      before: { bodyBytes: 500 },
      after: { bodyBytes: 500 },
    });
    expect(line).toContain("effectivePayloadSavings=0.0%");
  });

  it("returns null when snapshots are missing", () => {
    expect(formatEffectivePayloadSavings(null)).toBe(null);
    expect(formatEffectivePayloadSavings({})).toBe(null);
    expect(formatEffectivePayloadSavings({ before: { bodyBytes: 10 } })).toBe(null);
  });

  it("omits breakdown segments when snapshot lacks the new fields (backward compat)", () => {
    const line = formatEffectivePayloadSavings({
      before: { bodyBytes: 1000 },
      after: { bodyBytes: 700 },
    });
    expect(line).toContain("effectivePayloadSavings=30.0%");
    expect(line).not.toContain("tools=");
    expect(line).not.toContain("history=");
  });
});

describe("backward compatibility", () => {
  it("formatHeadroomSizeLog still works with the old shape", () => {
    expect(formatHeadroomSizeLog({ before: { bodyBytes: 1000, messageBytes: 800 }, after: { bodyBytes: 700, messageBytes: 500 } }))
      .toBe("body=1000B→700B messages=800B→500B");
  });

  it("formatHeadroomLog (token delta) is untouched", () => {
    expect(formatHeadroomLog({ tokens_before: 100, tokens_after: 60, tokens_saved: 40 }))
      .toContain("(40.0%)");
  });
});

describe("buildHeadroomBytesSample", () => {
  it("maps before/after snapshots to a lifetime-aggregateable shape", () => {
    const sample = buildHeadroomBytesSample({
      before: { bodyBytes: 1000, toolsBytes: 400, historyBytes: 300 },
      after: { bodyBytes: 600, toolsBytes: 100, historyBytes: 150 },
    });
    expect(sample).toEqual({
      bodyBefore: 1000, bodyAfter: 600,
      toolsBefore: 400, toolsAfter: 100,
      historyBefore: 300, historyAfter: 150,
    });
  });

  it("defaults missing breakdown fields to 0 (old snapshots still aggregate)", () => {
    const sample = buildHeadroomBytesSample({
      before: { bodyBytes: 500 },
      after: { bodyBytes: 300 },
    });
    expect(sample).toEqual({
      bodyBefore: 500, bodyAfter: 300,
      toolsBefore: 0, toolsAfter: 0,
      historyBefore: 0, historyAfter: 0,
    });
  });

  it("returns null when snapshots are missing or body has no bytes", () => {
    expect(buildHeadroomBytesSample(null)).toBe(null);
    expect(buildHeadroomBytesSample({})).toBe(null);
    expect(buildHeadroomBytesSample({ before: { bodyBytes: 0 }, after: { bodyBytes: 0 } })).toBe(null);
    expect(buildHeadroomBytesSample({ before: { bodyBytes: 500 } })).toBe(null);
  });
});
