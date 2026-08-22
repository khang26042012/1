import { ZED_CONFIG } from "../constants/oauth.js";

/**
 * Zed Hosted AI OAuth Service.
 *
 * Import credentials from the Zed Editor (user_id + access_token), then mint a
 * short-lived LLM bearer token used for /completions calls.
 *
 * Credential format (from Zed keychain / development_credentials):
 *   Authorization: "{userId} {accessToken}"
 *
 * LLM calls use: Authorization: Bearer {llm_token}
 *
 * The LLM token has a 1-hour lifetime; the executor auto-refreshes it when it
 * expires via refreshCredentials (POST /client/llm_tokens).
 */
export class ZedService {
  constructor() {
    this.config = ZED_CONFIG;
  }

  get baseUrl() {
    return (this.config.apiEndpoint || "https://cloud.zed.dev").replace(/\/$/, "");
  }

  /**
   * Build the Zed user-auth header value: "{userId} {accessToken}".
   */
  userAuthHeader(userId, accessToken) {
    return `${userId} ${accessToken}`;
  }

  /**
   * Probe the account with Zed user credentials.
   * @returns {Promise<object>} user profile JSON
   */
  async fetchUserMe(userId, accessToken) {
    const res = await fetch(`${this.baseUrl}${this.config.usersMePath || "/client/users/me"}`, {
      method: "GET",
      headers: {
        Authorization: this.userAuthHeader(userId, accessToken),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Zed auth failed (${res.status}): ${text.slice(0, 200) || res.statusText}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Zed /client/users/me returned invalid JSON");
    }
  }

  /**
   * Mint a short-lived LLM bearer token using Zed user credentials.
   * @param {string} userId
   * @param {string} accessToken - Zed user access token
   * @param {string|null} organizationId
   * @returns {Promise<string>} llm_token
   */
  async fetchLlmToken(userId, accessToken, organizationId) {
    const body = organizationId ? { organization_id: organizationId } : {};
    const res = await fetch(`${this.baseUrl}${this.config.llmTokensPath || "/client/llm_tokens"}`, {
      method: "POST",
      headers: {
        Authorization: this.userAuthHeader(userId, accessToken),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Zed LLM token failed (${res.status}): ${text.slice(0, 200) || res.statusText}`);
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Zed /client/llm_tokens returned invalid JSON");
    }
    // Response may be { token: "..." } or { token: { "0": "..." } } (CBOR-ish unwrap).
    const raw = data?.token;
    const token =
      typeof raw === "string"
        ? raw
        : raw && typeof raw === "object"
          ? raw["0"] || raw.token || Object.values(raw)[0]
          : null;
    if (!token || typeof token !== "string") {
      throw new Error("Zed LLM token response missing token");
    }
    return token;
  }

  /**
   * Extract the default organization id from a /client/users/me response.
   * Handles CBOR-ish wrapped ids ({ "0": "org_..." }).
   */
  extractOrganizationId(userMe) {
    const def = userMe?.default_organization_id;
    if (typeof def === "string" && def.length > 1) return def;
    if (def && typeof def === "object") {
      const wrapped = def["0"] || def.id;
      if (typeof wrapped === "string" && wrapped.length > 1) return wrapped;
    }
    const orgs = userMe?.organizations;
    if (Array.isArray(orgs) && orgs[0]) {
      const id = orgs[0].id;
      if (typeof id === "string" && id.length > 1) return id;
      if (id && typeof id === "object") {
        const wrapped = id["0"];
        if (typeof wrapped === "string" && wrapped.length > 1) return wrapped;
      }
    }
    return null;
  }

  /**
   * Extract email or github login from a /client/users/me response.
   */
  extractEmail(userMe) {
    return (
      userMe?.user?.email ||
      userMe?.user?.github_login ||
      userMe?.email ||
      userMe?.github_login ||
      null
    );
  }

  /**
   * Validate import credentials and mint an LLM token.
   * @param {string} userId
   * @param {string} accessToken - Zed user access token (plain or keyring JSON v2 blob)
   * @returns {Promise<object>} { llmToken, userId, accessToken, organizationId, email, expiresIn, userMe }
   */
  async validateImportToken(userId, accessToken) {
    if (!userId || typeof userId !== "string") {
      throw new Error("User ID is required");
    }
    if (!accessToken || typeof accessToken !== "string") {
      throw new Error("Access token is required");
    }

    const trimmedUserId = userId.trim();
    const trimmedToken = accessToken.trim();
    if (!/^\d+$/.test(trimmedUserId) && !/^[a-zA-Z0-9_-]+$/.test(trimmedUserId)) {
      throw new Error("Invalid user ID format");
    }
    if (trimmedToken.length < 16) {
      throw new Error("Invalid access token format. Token appears too short.");
    }

    let userMe;
    try {
      userMe = await this.fetchUserMe(trimmedUserId, trimmedToken);
    } catch (firstErr) {
      const msg = String(firstErr?.message || firstErr);
      if (msg.includes("401") && !trimmedToken.trimStart().startsWith("{")) {
        throw new Error(
          `${msg}. For Zed keyring v2 credentials, paste the full JSON secret ` +
            `(starts with {"version":2,...}), not only the inner token field.`,
        );
      }
      throw firstErr;
    }

    const organizationId = this.extractOrganizationId(userMe);
    const llmToken = await this.fetchLlmToken(trimmedUserId, trimmedToken, organizationId);

    return {
      llmToken,
      userId: trimmedUserId,
      accessToken: trimmedToken,
      organizationId,
      email: this.extractEmail(userMe),
      expiresIn: 3600,
      userMe,
    };
  }

  /**
   * Refresh the LLM bearer token using stored Zed user credentials.
   * Called by the executor when the current LLM token expires.
   */
  async refreshLlmToken(userId, zedAccessToken, organizationId) {
    const llmToken = await this.fetchLlmToken(userId, zedAccessToken, organizationId);
    return {
      accessToken: llmToken,
      expiresIn: 3600,
      providerSpecificData: {
        llmToken,
        lastLlmTokenAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Per-platform instructions for locating Zed credentials.
   */
  getTokenStorageInstructions() {
    return {
      linux: "Zed credentials are typically in the system keyring (libsecret) or ~/.local/share/zed/ development credentials when ZED_DEVELOPMENT_USE_KEYCHAIN is set.",
      macos: "Zed credentials are stored in the macOS Keychain (search for zed).",
      windows: "Zed credentials are stored via the Windows Credential Manager.",
      manual:
        'From a Zed session, copy your user_id and access_token (format used as Authorization: "{user_id} {access_token}").',
    };
  }
}
