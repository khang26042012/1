import { getModelInfo } from "./model.js";
import { normalizeComboStrategyConfig, estimateLogicalCalls } from "open-sse/services/comboConfig.js";
import { allowedByRule } from "../utils/modelAccess.js";

// Resolve the effective strategy config for a combo: MERGE, not pick-one.
//   base: combo.strategyConfig — the persisted combo definition (always
//     non-empty: create fills in normalized defaults).
//   override: legacyConfig (settings.comboStrategies[comboName]) — the
//     location the ComboCard editor writes to (live user changes).
// Settings fields win field-by-field. This avoids two bugs:
//   - picking combo.strategyConfig only → UI edits "don't stick" (Fusion
//     shown as fallback);
//   - picking settings entry only → a partial entry ({ thinking } only,
//     written when the user changes thinking without touching strategy)
//     silently resets the strategy to fallback.
// Exported so dispatch sites (chat.js capability adapter) read the same merged
// config the execution graph uses — one source of truth, no duplicated merge.
export function resolveComboStrategyConfig(combo, legacyConfig = {}) {
  const base = combo?.strategyConfig && typeof combo?.strategyConfig === "object" ? combo.strategyConfig : {};
  const override = legacyConfig && typeof legacyConfig === "object" ? legacyConfig : {};
  return normalizeComboStrategyConfig({ ...base, ...override });
}

export async function buildComboExecutionGraph(combo, legacyConfig = {}) {
  const members = Array.isArray(combo?.models) ? [...combo.models] : [];
  const config = resolveComboStrategyConfig(combo, legacyConfig);
  const first = members[0] || "";
  const roleModels = config.fallbackStrategy === "fusion"
    ? { judge: config.judgeModel || first }
    : config.fallbackStrategy === "swarm"
      ? {
          manager: config.managerModel || first,
          staff: config.staffModel || config.managerModel || first,
          audit: config.auditModel || config.staffModel || config.managerModel || first,
        }
      : {};

  const refs = [...members, ...Object.values(roleModels)].filter(Boolean);
  const resolved = [];
  for (const ref of refs) {
    const info = await getModelInfo(ref);
    if (!info?.provider || !info?.model) throw new Error(`Unresolved combo model: ${ref}`);
    resolved.push({ ref, provider: info.provider, model: info.model, canonical: `${info.provider}/${info.model}` });
  }

  return Object.freeze({
    comboName: combo.name,
    comboId: combo.id,
    members: Object.freeze(members),
    config: Object.freeze(config),
    roleModels: Object.freeze(roleModels),
    leaves: Object.freeze(resolved),
    logicalCalls: estimateLogicalCalls(config, members.length),
  });
}

export function authorizeComboExecution(keyObj, graph) {
  const allowed = keyObj?.allowedModels;
  if (!Array.isArray(allowed) || allowed.length === 0) return { allowed: true, denied: [] };

  const denied = [];
  if (!allowedByRule(allowed, graph.comboName)) denied.push(graph.comboName);
  for (const leaf of graph.leaves) {
    if (!allowedByRule(allowed, leaf.ref) && !allowedByRule(allowed, leaf.canonical)) denied.push(leaf.ref);
  }
  return { allowed: denied.length === 0, denied: [...new Set(denied)] };
}
