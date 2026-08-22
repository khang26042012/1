// Verify strategy resolution: settings.comboStrategies[comboName] fields
// MERGE over combo.strategyConfig (base). Fixes both "Fusion shows as
// fallback" AND "thinking-only edit resets strategy to fallback".
import { describe, it, expect, vi } from "vitest";

vi.mock("./model.js", () => ({
  getModelInfo: vi.fn(async (ref) => {
    const [provider, model] = ref.split("/");
    return { provider, model };
  }),
}));

import { buildComboExecutionGraph } from "@/sse/services/comboExecutionPolicy.js";

const comboWithSwarm = {
  name: "test-combo",
  id: "c1",
  models: ["oc/a", "kimchi/b"],
  strategyConfig: { fallbackStrategy: "swarm", managerModel: "cc/manager", thinking: { type: "auto" } },
};

const comboWithFallback = {
  name: "glm-free",
  id: "c2",
  models: ["oc/a", "kimchi/b"],
  strategyConfig: { fallbackStrategy: "fallback", thinking: { type: "auto" } },
};

describe("combo strategy resolution (merge)", () => {
  it("settings fusion overrides combo fallback", async () => {
    const graph = await buildComboExecutionGraph(comboWithFallback, { fallbackStrategy: "fusion" });
    expect(graph.config.fallbackStrategy).toBe("fusion");
  });

  it("thinking-only settings entry does NOT reset strategy (keeps swarm)", async () => {
    const graph = await buildComboExecutionGraph(comboWithSwarm, { thinking: { type: "effort", effort: "high" } });
    expect(graph.config.fallbackStrategy).toBe("swarm");
    expect(graph.config.thinking.effort).toBe("high"); // thinking override applied
  });

  it("no settings entry → combo.strategyConfig used", async () => {
    const graph = await buildComboExecutionGraph(comboWithSwarm, undefined);
    expect(graph.config.fallbackStrategy).toBe("swarm");
  });

  it("empty settings entry → combo.strategyConfig used", async () => {
    const graph = await buildComboExecutionGraph(comboWithFallback, {});
    expect(graph.config.fallbackStrategy).toBe("fallback");
  });
});
