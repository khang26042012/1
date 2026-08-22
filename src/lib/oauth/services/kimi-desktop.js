/**
 * Kimi Desktop token-store service.
 *
 * Reads the Kimi desktop app's local session store — plain JSON written by the
 * app's bridge on login. Cross-platform path resolution matches the other
 * OAuth import providers (cursor/zed).
 *
 * Store shape (verified against a live install):
 *   {
 *     "origin": "https://www.kimi.com",
 *     "tokens": {
 *       "access_token": "eyJ...",   // JWT, iss=user-center, app_id=kimi, ~30d
 *       "refresh_token": "eyJ...",  // JWT, ~60d
 *       "msh_user_id": "..."
 *     },
 *     "msh_user_subscription_data": ...
 *   }
 *
 * The access_token JWT is the same kimi-auth session the web client uses, so
 * the kimi-web executor consumes it directly (Bearer + Cookie).
 */
import { access, readFile } from "fs/promises";
import { constants } from "fs";
import { homedir } from "os";
import { join } from "path";

const APP_PATH = "kimi-desktop/bridge-store/token-store.json";

export function getTokenStoreCandidates() {
  const home = homedir();
  const platform = process.platform;
  return [
    // Windows: %APPDATA%\kimi-desktop\bridge-store\token-store.json
    ...(platform === "win32"
      ? [join(process.env.APPDATA || join(home, "AppData", "Roaming"), APP_PATH)]
      : []),
    // macOS: ~/Library/Application Support/kimi-desktop/bridge-store/token-store.json
    ...(platform === "darwin"
      ? [join(home, "Library", "Application Support", APP_PATH)]
      : []),
    // Linux/fallback best-efforts
    join(home, ".config", APP_PATH),
  ];
}

/**
 * Read + parse the first readable token store. Returns raw store or null.
 */
export async function readKimiDesktopStore() {
  const candidates = getTokenStoreCandidates();
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.R_OK);
      const raw = await readFile(candidate, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed?.tokens?.access_token) return parsed;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

/**
 * Best-effort decode of a JWT payload (no signature check — display only).
 */
function decodeJwtPayload(token) {
  if (typeof token !== "string") return null;
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Pull the shared account name out of the JWT claims (best-effort; falls back
 * to the msh_user_id, then to "Kimi Desktop").
 */
export function getAccountLabel(store) {
  const claims = decodeJwtPayload(store?.tokens?.access_token);
  const phone = claims?.phone;
  const email = claims?.email;
  const userId = store?.tokens?.msh_user_id;
  return phone || email || userId || null;
}

export class KimiDesktopService {
  /**
   * Validate a token store shape enough to be useful (access_token present and
   * parseable). Does NOT hit the network — the executor handles live auth
   * failure at request time.
   */
  static validateStore(store) {
    const accessToken = store?.tokens?.access_token;
    if (!accessToken) return { valid: false, error: "No access_token in Kimi desktop token store" };
    const claims = decodeJwtPayload(accessToken);
    if (!claims) return { valid: false, error: "access_token is not a valid JWT" };
    return { valid: true, claims };
  }
}