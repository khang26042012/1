/**
 * Provider Capability Layer — resolves per-provider capability flags and gates
 * combo strategy roles (Manager, Staff, Audit, Judge) based on them.
 *
 * Web cookie providers (category "webCookie") cannot serve as control roles in
 * swarm/fusion strategies because they lack tool use and file access — they're
 * reverse-engineered browser chat endpoints (text in → text out). This module
 * provides the resolution + validation logic so the UI can block invalid
 * selections and the runtime can defensively reject broken combos.
 *
 * Capability resolution order (highest priority first):
 *   1. Explicit `capabilities` field on the registry entry
 *   2. Category-derived defaults (webCookie → limited, everything else → full)
 *   3. FULL_CAPS fallback (all true)
 */
import REGISTRY from "../providers/registry/index.js";
import { resolveProviderAlias } from "./model.js";

// ── Default capability sets ─────────────────────────────────────────────

/** All capabilities enabled — the default for API/OAuth providers. */
const FULL_CAPS = Object.freeze({
  toolUse: true,
  fileAccess: true,
  streaming: true,
  multiTurn: true,
  controlRole: true,
  reliableJson: true,
});

const UNKNOWN_CAPS = Object.freeze({
  toolUse: false,
  fileAccess: false,
  streaming: false,
  multiTurn: false,
  controlRole: false,
  reliableJson: false,
});

/** Limited capabilities — web cookie providers (browser chat endpoints). */
const WEB_COOKIE_CAPS = Object.freeze({
  toolUse: false,
  fileAccess: false,
  streaming: true,
  multiTurn: true,
  controlRole: false,
  reliableJson: false,
});

/** Per-category default capability sets. Categories not listed get FULL_CAPS. */
const DEFAULT_CAPS_BY_CATEGORY = {
  webCookie: WEB_COOKIE_CAPS,
};

// ── Role requirements ───────────────────────────────────────────────────

/**
 * Control roles in combo strategies that require tool use + file access.
 * These roles need to read files, use tools, and inspect code — capabilities
 * that web cookie providers fundamentally lack.
 *
 * Workers (swarm) and panels (fusion) have no capability requirements — any
 * provider can serve in those roles.
 */
const CONTROL_ROLE_REQUIREMENTS = Object.freeze({
  manager: { controlRole: true, reliableJson: true, multiTurn: true },
  staff: { controlRole: true, reliableJson: true, multiTurn: true },
  audit: { controlRole: true, reliableJson: true, multiTurn: true },
  judge: { controlRole: true, reliableJson: true, multiTurn: true },
});

/** Check if a role is a control role (requires tool use + file access). */
export function isControlRole(role) {
  return Object.prototype.hasOwnProperty.call(CONTROL_ROLE_REQUIREMENTS, role);
}

// ── Resolution (memoized) ───────────────────────────────────────────────

/**
 * Pre-built capability map for O(1) lookup by provider id.
 * Resolved once at module load — the registry is static.
 * @type {Map<string, Object>}
 */
const PROVIDER_CAPS_CACHE = new Map();
for (const entry of REGISTRY) {
  if (entry.capabilities && typeof entry.capabilities === "object") {
    PROVIDER_CAPS_CACHE.set(entry.id, { ...FULL_CAPS, ...entry.capabilities });
  } else {
    const byCat = DEFAULT_CAPS_BY_CATEGORY[entry.category];
    PROVIDER_CAPS_CACHE.set(entry.id, byCat ? { ...byCat } : { ...FULL_CAPS });
  }
}

/**
 * Resolve capabilities for a provider id.
 *
 * @param {string} providerId - registry provider id
 * @returns {Object} capability flags { toolUse, fileAccess, streaming, multiTurn }
 */
export function getProviderCaps(providerId) {
  const canonical = resolveProviderAlias(providerId);
  return PROVIDER_CAPS_CACHE.get(canonical) || { ...UNKNOWN_CAPS };
}

/**
 * Resolve capabilities for a "provider/model" string (combo model format).
 *
 * @param {string} modelStr - e.g. "glm/glm-5" or "claude-web/claude-sonnet-4"
 * @returns {Object} capability flags
 */
export function getProviderCapsByModelStr(modelStr) {
  if (!modelStr || typeof modelStr !== "string") return { ...FULL_CAPS };
  const slashIdx = modelStr.indexOf("/");
  const providerId = slashIdx >= 0 ? modelStr.slice(0, slashIdx) : modelStr;
  return getProviderCaps(resolveProviderAlias(providerId));
}

/**
 * Check if a provider can serve a specific combo role.
 *
 * @param {string} providerId - registry provider id
 * @param {string} role - "manager"|"staff"|"audit"|"judge"|"worker"|"panel"
 * @returns {boolean} true if the provider's capabilities satisfy the role
 */
export function canServeRole(providerId, role) {
  const requirements = CONTROL_ROLE_REQUIREMENTS[role];
  if (!requirements) return true; // non-control roles (worker/panel) always pass

  const caps = getProviderCaps(providerId);
  for (const [key, required] of Object.entries(requirements)) {
    if (required && !caps[key]) return false;
  }
  return true;
}

/**
 * Check if a "provider/model" string can serve a role.
 *
 * @param {string} modelStr - e.g. "glm/glm-5"
 * @param {string} role
 * @returns {boolean}
 */
export function canModelStrServeRole(modelStr, role) {
  if (!modelStr || typeof modelStr !== "string") return true; // empty = auto, allow
  const slashIdx = modelStr.indexOf("/");
  const providerId = slashIdx >= 0 ? modelStr.slice(0, slashIdx) : modelStr;
  return canServeRole(resolveProviderAlias(providerId), role);
}

// ── Combo validation ────────────────────────────────────────────────────

/**
 * Validate that all control-role models in a combo strategy config meet the
 * capability requirements. Returns an array of violations (empty = valid).
 *
 * IMPORTANT: empty/unset control-role models fall back to `panel[0]` at runtime
 * (swarm.js: `manager = managerModel || panel[0]`, fusion: `judge = judgeModel || panel[0]`).
 * To catch the common "Auto" case where panel[0] is a web cookie, pass the
 * `panelFallback` array — empty role models will be validated against panel[0].
 *
 * @param {string} strategy - "swarm"|"fusion"
 * @param {Object} config - the combo strategy config ({ managerModel, staffModel, auditModel, judgeModel, ... })
 * @param {string[]} [panelFallback] - combo.models array, used to resolve empty role models
 * @returns {Array<{role:string, model:string, reason:string}>} violations
 */
export function validateComboRoles(strategy, config, panelFallback = []) {
  const violations = [];
  const firstPanel = Array.isArray(panelFallback) && panelFallback.length > 0 ? panelFallback[0] : "";

  if (strategy === "swarm") {
    // Resolve each control role: explicit model → panel[0] fallback.
    // Staff/Audit have their own cascading fallbacks (staff→manager→panel[0],
    // audit→staff→manager→panel[0]) but for capability validation we only need
    // to check panel[0] as the worst-case fallback for ALL empty roles.
    const rolesToCheck = [
      { role: "manager", model: config?.managerModel || firstPanel },
      { role: "staff", model: config?.staffModel || firstPanel },
      { role: "audit", model: config?.auditModel || firstPanel },
    ];
    for (const { role, model } of rolesToCheck) {
      if (model && !canModelStrServeRole(model, role)) {
        const providerId = model.split("/")[0];
        violations.push({
          role,
          model,
          reason: `Provider "${providerId}" cannot serve as ${role} — web cookie providers lack tool use and file access required for control roles.`,
        });
      }
    }
  } else if (strategy === "fusion") {
    const judgeModel = config?.judgeModel || firstPanel;
    if (judgeModel && !canModelStrServeRole(judgeModel, "judge")) {
      const providerId = judgeModel.split("/")[0];
      violations.push({
        role: "judge",
        model: judgeModel,
        reason: `Provider "${providerId}" cannot serve as judge — web cookie providers lack tool use and file access required for the judge role.`,
      });
    }
  }

  return violations;
}
