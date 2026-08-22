// Guards P0 (activity) retention: maybePruneUsageHistory deletes usageHistory +
// requestDetails rows older than the retention window, throttles to once per
// interval, tolerates a missing requestDetails table, and never throws so the
// saveRequestUsage hot path stays healthy.
import { describe, it, expect, vi, beforeEach } from "vitest";

const runMock = vi.fn();
const allMock = vi.fn();

vi.mock("../../src/lib/db/driver.js", () => ({
  getAdapter: vi.fn(async () => ({ run: runMock, all: allMock })),
}));

import { maybePruneUsageHistory } from "../../src/lib/db/repos/usageRepo.js";

const RETENTION_DAYS = 90;
const DAY_MS = 86400000;
const isoAgo = (ms, days) => new Date(ms - days * DAY_MS).toISOString();

describe("usage prune (P0 retention)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allMock.mockReturnValue([]);
    global._usagePrune.lastAt = 0; // reset throttle for each case
  });

  it("deletes usageHistory rows older than the retention window", async () => {
    const t0 = Date.now();
    await maybePruneUsageHistory();
    expect(runMock).toHaveBeenCalledTimes(1);
    const [sql, params] = runMock.mock.calls[0];
    expect(sql.startsWith("DELETE FROM usageHistory WHERE timestamp < ?")).toBe(true);
    const cutoff = params[0];
    expect(cutoff >= isoAgo(t0 - 2000, RETENTION_DAYS)).toBe(true);
    expect(cutoff <= isoAgo(t0 + 2000, RETENTION_DAYS)).toBe(true);
  });

  it("deletes requestDetails when the table exists", async () => {
    allMock.mockReturnValue([{ name: "requestDetails" }]);
    await maybePruneUsageHistory();
    expect(allMock).toHaveBeenCalledTimes(1);
    expect(allMock.mock.calls[0][0]).toContain("requestDetails");
    const sqls = runMock.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => s.startsWith("DELETE FROM requestDetails"))).toBe(true);
  });

  it("skips requestDetails delete when table is missing", async () => {
    await maybePruneUsageHistory();
    const sqls = runMock.mock.calls.map((c) => c[0]);
    expect(sqls.every((s) => s.startsWith("DELETE FROM usageHistory"))).toBe(true);
  });

  it("throttles to at most one prune per interval", async () => {
    await maybePruneUsageHistory(); // first call sets lastAt
    const afterFirst = runMock.mock.calls.length;
    expect(afterFirst).toBe(1);
    await maybePruneUsageHistory(); // immediate retry must be a no-op
    expect(runMock.mock.calls.length).toBe(afterFirst);
  });

  it("swallows adapter failures so the save path survives", async () => {
    const { getAdapter } = await import("../../src/lib/db/driver.js");
    getAdapter.mockRejectedValue(new Error("db down"));
    await expect(maybePruneUsageHistory()).resolves.toBeUndefined();
  });
});
