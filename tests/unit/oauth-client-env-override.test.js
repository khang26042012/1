/**
 * Scenario A regression tests: OAuth client credentials are env-overridable via
 * open-sse/providers/shared.js, falling back to the packaged defaults.
 *
 * Keeping the defaults UNCHANGED is what preserves backward compatibility with
 * existing OAuth connections (their refresh tokens stay bound to the packaged
 * client identity). These tests lock that contract.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const ENV_KEYS = [
  "ANTIGRAVITY_OAUTH_CLIENT_ID",
  "ANTIGRAVITY_OAUTH_CLIENT_SECRET",
  "GEMINI_OAUTH_CLIENT_ID",
  "GEMINI_OAUTH_CLIENT_SECRET",
  "IFLOW_OAUTH_CLIENT_ID",
  "IFLOW_OAUTH_CLIENT_SECRET",
];

const SAVED = {};
for (const k of ENV_KEYS) SAVED[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
  vi.resetModules(); // re-evaluate modules next test so constants reflect current env
});

describe("OAuth client env override (Scenario A)", () => {
  it("uses env override when set", async () => {
    process.env.GEMINI_OAUTH_CLIENT_SECRET = "custom-gemini-secret";
    process.env.ANTIGRAVITY_OAUTH_CLIENT_ID = "custom-antigravity-id";
    process.env.IFLOW_OAUTH_CLIENT_SECRET = "custom-iflow-secret";
    vi.resetModules();
    const shared = await import("../../open-sse/providers/shared.js");
    expect(shared.GOOGLE_OAUTH_CLIENT.clientSecret).toBe("custom-gemini-secret");
    expect(shared.ANTIGRAVITY_OAUTH_CLIENT.clientId).toBe("custom-antigravity-id");
    expect(shared.IFLOW_OAUTH_CLIENT.clientSecret).toBe("custom-iflow-secret");
  });

  it("falls back to packaged defaults when env is not set", async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    vi.resetModules();
    const shared = await import("../../open-sse/providers/shared.js");
    expect(shared.GOOGLE_OAUTH_CLIENT.clientId).toBe("REDACTED_CLIENT_ID_2");
    expect(shared.GOOGLE_OAUTH_CLIENT.clientSecret).toBe("REDACTED_SECRET_2");
    expect(shared.ANTIGRAVITY_OAUTH_CLIENT.clientSecret).toBe("REDACTED_SECRET_1");
    expect(shared.IFLOW_OAUTH_CLIENT.clientId).toBe("10009311001");
    expect(shared.IFLOW_OAUTH_CLIENT.clientSecret).toBe("4Z3YjXycVsQvyGF1etiNlIBB4RsqSDtW");
  });

  it("registry transport + oauth derive from the shared (env-aware) constants", async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.GEMINI_OAUTH_CLIENT_SECRET = "custom-gemini-secret";
    process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET = "custom-antigravity-secret";
    process.env.IFLOW_OAUTH_CLIENT_SECRET = "custom-iflow-secret";
    vi.resetModules();
    const [gemini, geminiCli, antigravity, iflow] = await Promise.all([
      import("../../open-sse/providers/registry/gemini.js"),
      import("../../open-sse/providers/registry/gemini-cli.js"),
      import("../../open-sse/providers/registry/antigravity.js"),
      import("../../open-sse/providers/registry/iflow.js"),
    ]);
    expect(gemini.default.transport.clientSecret).toBe("custom-gemini-secret");
    expect(geminiCli.default.transport.clientSecret).toBe("custom-gemini-secret");
    expect(antigravity.default.transport.clientSecret).toBe("custom-antigravity-secret");
    expect(iflow.default.oauth.clientSecret).toBe("custom-iflow-secret");
  });
});