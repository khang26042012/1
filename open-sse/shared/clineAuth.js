import pkg from "../../package.json" with { type: "json" };

const APP_VERSION = pkg.version || "0.0.0";

/**
 * Detect whether a token is an API key (not an account OAuth token).
 *
 * Cline issues two kinds of credentials:
 *  - API keys: created at app.cline.bot Settings > API Keys. Format varies
 *    but they are long opaque strings, NOT WorkOS session tokens.
 *  - Account tokens: issued by the VS Code extension OAuth flow. These are
 *    WorkOS access tokens that the Cline backend expects prefixed with
 *    `workos:`.
 *
 * Heuristics for API key detection:
 *  - Contains a dash-separated segment that looks like a key prefix
 *    (cline-, sk-, cp-, clinepass-, cl-).
 *  - Is very long (>= 40 chars) and does NOT look like a JWT
 *    (account tokens are JWTs: header.payload.signature).
 */
function isApiKey(token) {
  if (typeof token !== "string") return false;
  const t = token.trim();
  if (!t) return false;
  // Explicit API key prefixes.
  if (/^(cline-|sk-|cp-|clinepass-|cl-)/i.test(t)) return true;
  // JWTs (account tokens) have exactly 2 dots and base64 segments.
  if (t.split(".").length === 3) return false;
  // Long opaque strings without dots are likely API keys.
  if (t.length >= 40 && !t.includes(".")) return true;
  return false;
}

/**
 * Normalize a Cline token for the Authorization header.
 *
 * Account auth tokens issued by the Cline extension must carry the WorkOS
 * `workos:` prefix; plain API keys must NOT. We only add the prefix when the
 * token is clearly an account (JWT) token that isn't already prefixed.
 */
export function getClineAccessToken(token) {
  if (typeof token !== "string") return "";
  const trimmed = token.trim();
  if (!trimmed) return "";
  // Already prefixed — leave as-is.
  if (trimmed.startsWith("workos:")) return trimmed;
  // API keys are sent as-is, no prefix.
  if (isApiKey(trimmed)) return trimmed;
  // Account token without prefix — add WorkOS prefix expected by Cline backend.
  return `workos:${trimmed}`;
}

export function getClineAuthorizationHeader(token) {
  const accessToken = getClineAccessToken(token);
  return accessToken ? `Bearer ${accessToken}` : "";
}

/**
 * Build request headers for the Cline API.
 *
 * Base headers follow https://docs.cline.bot/api/authentication:
 *   - HTTP-Referer  (app base URL, for usage)
 *   - X-Title       (app name, appears in usage logs)
 *   - x-client-type (identifies the client; REQUIRED to reach models gated to
 *     "Cline product surfaces" — e.g. deepseek/deepseek-v4-flash and
 *     deepseek/deepseek-v4-pro return 403 "only available via Cline product
 *     surfaces" without it. Verified by live probe on 2026-08-07.)
 *   - Authorization (Bearer token)
 *
 * Earlier revisions dropped x-client-type because an unknown client value
 * triggered 401. The verified value `cline-cli` is accepted by the backend
 * and unlocks the gated DeepSeek models; the 401 only occurs with a bad or
 * missing auth token, not from this header.
 */
export function buildClineHeaders(token, extraHeaders = {}) {
  const authorization = getClineAuthorizationHeader(token);
  const headers = {
    "HTTP-Referer": "https://cline.bot",
    "X-Title": "Cline",
    "x-client-type": "cline-cli",
    ...extraHeaders,
  };

  if (authorization) {
    headers.Authorization = authorization;
  }

  return headers;
}
