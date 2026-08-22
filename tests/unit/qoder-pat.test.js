/**
 * Qoder PAT (Personal Access Token) support — port of VansRouter.
 *
 * PATs (pt-...) cannot sign COSY requests: they are exchanged for short-lived
 * job tokens (jt-...) via openapi.qoder.sh, with a cached + deduplicated
 * in-flight map. Non-PAT credentials pass through untouched.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { proxyAwareFetchMock } = vi.hoisted(() => ({ proxyAwareFetchMock: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: proxyAwareFetchMock }));

import { isQoderPat, resolveQoderCredentials } from "../../open-sse/services/qoderModels.js";

function okJson(data) {
  return { ok: true, status: 200, json: async () => data, text: async () => "" };
}
function errRes(status, text) {
  return { ok: false, status, json: async () => ({}), text: async () => text };
}

beforeEach(() => {
  proxyAwareFetchMock.mockReset();
});

describe("isQoderPat", () => {
  it("recognizes pt- prefixed tokens only", () => {
    expect(isQoderPat("pt-abc123")).toBe(true);
    expect(isQoderPat("jt-abc123")).toBe(false);
    expect(isQoderPat("sk-abc123")).toBe(false);
    expect(isQoderPat("")).toBe(false);
    expect(isQoderPat(null)).toBe(false);
  });
});

describe("resolveQoderCredentials", () => {
  it("passes through non-PAT credentials unchanged", async () => {
    const creds = { apiKey: "sk-x", providerSpecificData: { machineId: "m1" } };
    const out = await resolveQoderCredentials(creds);
    expect(out).toBe(creds);
    expect(proxyAwareFetchMock).not.toHaveBeenCalled();
  });

  it("exchanges a PAT for a job token + resolves the user id", async () => {
    proxyAwareFetchMock
      .mockResolvedValueOnce(okJson({ token: "jt-123", expires_in: 3600 })) // exchange
      .mockResolvedValueOnce(okJson({ id: "user-1" }));                       // userinfo

    const out = await resolveQoderCredentials(
      { apiKey: "pt-abc", displayName: "Tester", providerSpecificData: { machineId: "m1" } },
      null,
      null,
    );

    // Exchange request shape: POST { personal_token }.
    const [url, opts] = proxyAwareFetchMock.mock.calls[0];
    expect(url).toContain("/jobToken/exchange");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body).personal_token).toBe("pt-abc");

    // Resolved credential is device-token-shaped for COSY signing.
    expect(out.accessToken).toBe("jt-123");
    expect(out.apiKey).toBeUndefined();
    expect(out.providerSpecificData.authMethod).toBe("pat");
    expect(out.providerSpecificData.userId).toBe("user-1");
    expect(out.providerSpecificData.machineId).toBe("m1"); // preserved
  });

  it("caches the exchange per PAT (dedup — one upstream call)", async () => {
    proxyAwareFetchMock
      .mockResolvedValueOnce(okJson({ token: "jt-1", expires_in: 3600 }))
      .mockResolvedValueOnce(okJson({ id: "u1" }));

    const creds = { apiKey: "pt-same", providerSpecificData: {} };
    await resolveQoderCredentials(creds);
    await resolveQoderCredentials(creds);

    // exchange + userinfo exactly once (subsequent call hits the cache).
    expect(proxyAwareFetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces a clean fail on exchange error", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(errRes(401, "invalid pat"));
    await expect(
      resolveQoderCredentials({ apiKey: "pt-bad", providerSpecificData: {} }),
    ).rejects.toThrow(/PAT exchange failed: 401/);
  });
});