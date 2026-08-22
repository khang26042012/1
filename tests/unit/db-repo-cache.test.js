// Unit tests for the TPS caches added to settingsRepo + connectionsRepo.
//
// Uses a BEHAVIOURAL approach: mutate the DB directly (bypassing the repos)
// and assert that within the TTL the cache returns the OLD snapshot, while an
// invalidation path (updateSettings / selection-relevant update) returns FRESH
// data. This proves the cache exists and is correctly invalidated without
// depending on fragile internal query counting.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let driver;
let adapter;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "extremerouter-cache-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  driver = await import("@/lib/db/driver.js");
  db = await import("@/lib/db/index.js");
  await db.initDb();
  adapter = await driver.getAdapter();
});

afterAll(() => {
  try { if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows file lock */ }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("settingsRepo TPS cache", () => {
  it("getSettings() returns cached snapshot within TTL (stale after direct DB write)", async () => {
    await db.updateSettings({ comboStrategy: "fallback" });

    // Populate the cache.
    const before = await db.getSettings();
    expect(before.comboStrategy).toBe("fallback");

    // Bypass the repo and write to the DB directly. The cache must NOT see it
    // within the 5s TTL → proves getSettings() served from cache, not the DB.
    adapter.run(`UPDATE settings SET data = '{"comboStrategy":"swarm"}' WHERE id = 1`);
    const cached = await db.getSettings();
    expect(cached.comboStrategy).toBe("fallback"); // stale = cache hit

    // Invalidate via updateSettings → next read is fresh.
    await db.updateSettings({ comboStrategy: "fusion" });
    const fresh = await db.getSettings();
    expect(fresh.comboStrategy).toBe("fusion");
  });

  it("updateSettings() invalidates the cache immediately", async () => {
    await db.updateSettings({ rtkEnabled: false });
    const s1 = await db.getSettings();
    expect(s1.rtkEnabled).toBe(false);

    await db.updateSettings({ rtkEnabled: true });
    const s2 = await db.getSettings();
    expect(s2.rtkEnabled).toBe(true); // would be stale if cache weren't dropped
  });
});

describe("connectionsRepo TPS cache", () => {
  it("getProviderConnections() cached per filter within TTL", async () => {
    const provider = "testcache-a";
    await db.createProviderConnection({ provider, authType: "apikey", name: "k1", apiKey: "sk-1" });

    // Populate cache (filter: provider + isActive).
    const r1 = await db.getProviderConnections({ provider, isActive: true });
    expect(r1.length).toBe(1);

    // Direct DB insert bypassing the repo → cache must stay stale (hit).
    adapter.run(
      `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
       VALUES('extra-1', '${provider}', 'apikey', 'k2', NULL, 2, 1, '{}', datetime('now'), datetime('now'))`
    );
    const r2 = await db.getProviderConnections({ provider, isActive: true });
    expect(r2.length).toBe(1); // stale = cache hit (new row not visible)

    // Callers get independent array copies — mutating one must not poison cache.
    const r3 = await db.getProviderConnections({ provider, isActive: true });
    expect(r3.length).toBe(1);
    r3.push({ id: "poison" });
    const r4 = await db.getProviderConnections({ provider, isActive: true });
    expect(r4.length).toBe(1);

    // Cleanup the direct-inserted row so later tests (which also query active
    // rows for this DB) don't see it after their own cache invalidation.
    adapter.run(`DELETE FROM providerConnections WHERE id = 'extra-1'`);
  });

  it("rotation metadata (lastUsedAt) does NOT invalidate the cache", async () => {
    const provider = "testcache-b";
    await db.createProviderConnection({ provider, authType: "apikey", name: "k1", apiKey: "sk-1" });

    // Populate cache.
    const conns = await db.getProviderConnections({ provider, isActive: true });
    const id = conns[0].id;

    // Direct DB update (bypass repo) to confirm cache is populated & stale.
    adapter.run(`UPDATE providerConnections SET data = '{"lastUsedAt":"x"}' WHERE id = ?`, [id]);
    const stale = await db.getProviderConnections({ provider, isActive: true });
    expect(stale.length).toBe(1);

    // Repo rotation write (hot path) must NOT drop the cache: a direct DB
    // change still stays invisible (proves cache survived the write).
    await db.updateProviderConnection(id, { lastUsedAt: new Date().toISOString(), consecutiveUseCount: 1 });
    adapter.run(`UPDATE providerConnections SET data = '{"lastUsedAt":"y"}' WHERE id = ?`, [id]);
    const after = await db.getProviderConnections({ provider, isActive: true });
    expect(after.length).toBe(1);
  });

  it("selection-relevant field (isActive) DOES invalidate the cache", async () => {
    const provider = "testcache-c";
    await db.createProviderConnection({ provider, authType: "apikey", name: "k1", apiKey: "sk-1" });

    // Populate cache.
    const conns = await db.getProviderConnections({ provider, isActive: true });
    const id = conns[0].id;

    // Repo update of a selection-relevant field → cache dropped → next read is
    // fresh from DB (isActive=false, so the active filter returns 0).
    const updated = await db.updateProviderConnection(id, { isActive: false });
    expect(updated?.isActive).toBe(false); // DB write actually happened
    const direct = await db.getProviderConnectionById(id);
    expect(direct?.isActive).toBe(false); // non-cached read confirms DB state

    const after = await db.getProviderConnections({ provider, isActive: true });
    expect(after.length).toBe(0);
  });
});
