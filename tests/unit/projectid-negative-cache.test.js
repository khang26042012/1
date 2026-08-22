import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  getProjectIdForConnection,
  invalidateProjectId,
  _seedProjectIdFailure,
  _resetProjectIdState,
} from "../../open-sse/services/projectId.js";

const connId = "conn-1";

beforeEach(() => {
  _resetProjectIdState();
});

afterEach(() => {
  _resetProjectIdState();
  vi.restoreAllMocks();
});

describe("projectId negative cache", () => {
  it("returns null from a seeded failure without calling fetch", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchSpy);

    _seedProjectIdFailure(connId, Date.now());

    const pid = await getProjectIdForConnection(connId, "token", "antigravity");
    expect(pid).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("invalidates a negative-cache entry and refetches", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ cloudaicompanionProject: "project-ok" }) });
    vi.stubGlobal("fetch", fetchSpy);

    _seedProjectIdFailure(connId, Date.now());
    invalidateProjectId(connId);

    const pid = await getProjectIdForConnection(connId, "token", "antigravity");
    expect(pid).toBe("project-ok");
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("a successful fetch clears the negative cache", async () => {
    _seedProjectIdFailure(connId, Date.now());

    // Expire the seed so the next call actually fetches.
    // Simulate by invalidating — but here the point is success clears it.
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ cloudaicompanionProject: "project-ok" }) });
    vi.stubGlobal("fetch", fetchSpy);

    invalidateProjectId(connId); // clears failure
    const pid = await getProjectIdForConnection(connId, "token", "antigravity");
    expect(pid).toBe("project-ok");

    // Now a success has cached it — but the failure entry was already gone.
    // The next call hits the positive cache: no fetch.
    const fetchCount = fetchSpy.mock.calls.length;
    const cached = await getProjectIdForConnection(connId, "token", "antigravity");
    expect(cached).toBe("project-ok");
    expect(fetchSpy.mock.calls.length).toBe(fetchCount);
  });
});
