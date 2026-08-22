/**
 * Default-key provisioning (Option A): requireApiKey false→true transition
 * creates a "Default Key" when no keys exist, so /v1 keeps working with zero
 * dashboard steps. Tests the pure module with stubbed repo deps.
 */

import { describe, it, expect, vi } from "vitest";
import { shouldProvisionDefaultKey, provisionDefaultKey } from "../../src/lib/endpoint/defaultKey.js";

describe("shouldProvisionDefaultKey", () => {
  it("true only on a false→true transition", () => {
    expect(shouldProvisionDefaultKey(false, true)).toBe(true);
    expect(shouldProvisionDefaultKey(undefined, true)).toBe(true); // first enable
  });

  it("false on non-transitions", () => {
    expect(shouldProvisionDefaultKey(true, true)).toBe(false);
    expect(shouldProvisionDefaultKey(false, false)).toBe(false);
    expect(shouldProvisionDefaultKey(true, false)).toBe(false);
  });
});

describe("provisionDefaultKey", () => {
  it("creates the default key when no keys exist", async () => {
    const getApiKeys = vi.fn(async () => []);
    const createApiKey = vi.fn(async () => ({ key: "sk-default-123" }));

    const result = await provisionDefaultKey({ getApiKeys, createApiKey });

    expect(result).toEqual({ key: "sk-default-123", provisioned: true });
    expect(createApiKey).toHaveBeenCalledTimes(1);
    expect(createApiKey).toHaveBeenCalledWith("Default Key", "local", null);
  });

  it("does not provision when keys already exist (idempotent)", async () => {
    const getApiKeys = vi.fn(async () => [{ id: "k1", key: "sk-existing", isActive: true }]);
    const createApiKey = vi.fn();

    const result = await provisionDefaultKey({ getApiKeys, createApiKey });

    expect(result).toEqual({ provisioned: false });
    expect(createApiKey).not.toHaveBeenCalled();
  });

  it("re-provisions only after every key is deleted", async () => {
    let keys = [{ id: "k1", key: "sk-old" }];
    const getApiKeys = vi.fn(async () => keys);
    const createApiKey = vi.fn(async () => ({ key: "sk-new" }));

    // Keys exist → skip.
    expect((await provisionDefaultKey({ getApiKeys, createApiKey })).provisioned).toBe(false);
    // User deletes all keys → next enablement provisions again.
    keys = [];
    expect((await provisionDefaultKey({ getApiKeys, createApiKey })).provisioned).toBe(true);
    expect(createApiKey).toHaveBeenCalledTimes(1);
  });
});
