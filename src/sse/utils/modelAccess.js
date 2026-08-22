import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { getApiKeyByKey } from "@/lib/localDb";

/**
 * Check if a model string is allowed by a single ACL rule.
 * Rule forms: exact match ("openai/gpt-4o") or prefix wildcard ("openai/").
 */
export function allowedByRule(allowed, model) {
  return allowed.some((rule) => rule === model || (rule.endsWith("/") && model.startsWith(rule)));
}

/**
 * Look up keyObj for ACL enforcement. Returns null if no key or lookup fails.
 */
export async function resolveKeyForAcl(apiKey) {
  if (!apiKey) return null;
  try {
    return await getApiKeyByKey(apiKey);
  } catch {
    return null;
  }
}

/**
 * Check whether keyObj is allowed to access modelStr.
 *
 * Returns null (allowed / skip) or { allowed: false, denied: string }.
 *   - keyObj null → skip (no key presented)
 *   - keyObj.isActive false → deny
 *   - allowedModels null/empty → allow-all (backward compat)
 *   - otherwise → match against allowedModels rules
 */
export function checkModelAllowed(keyObj, modelStr) {
  if (!keyObj) return null;
  if (keyObj.isActive === false) {
    return { allowed: false, denied: "(key inactive)" };
  }
  const allowed = keyObj.allowedModels;
  if (!Array.isArray(allowed) || allowed.length === 0) return null;
  if (allowedByRule(allowed, modelStr)) return null;
  return { allowed: false, denied: modelStr };
}

/**
 * Convenience: return an error Response if denied, null if allowed.
 *   - inactive key → 401 (same as invalid key)
 *   - model not allowed → 403
 */
export function assertModelAllowed(keyObj, modelStr) {
  const result = checkModelAllowed(keyObj, modelStr);
  if (!result) return null;
  if (!result.allowed) {
    if (result.denied === "(key inactive)") {
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "API key is inactive");
    }
    return errorResponse(HTTP_STATUS.FORBIDDEN, `Model "${modelStr}" is not allowed for this API key`);
  }
  return null;
}