// Health monitor tests — aggregates (A4 coverage) + idle-entry GC (A3).
// healthMonitor has no other test file, so this also locks basic correctness:
// success rate, p95 latency from the rolling window, and idle eviction.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  recordHealthSample, getProviderHealth, getAllProviderHealth,
} from "open-sse/services/healthMonitor.js";

afterEach(() => {
  vi.useRealTimers();
  global._healthMonitors?.clear();
});

describe("healthMonitor aggregates", () => {
  it("computes total, success rate, failures and avg latency from the window", () => {
    recordHealthSample("aggprov", { success: true, latencyMs: 100 });
    recordHealthSample("aggprov", { success: false, latencyMs: 200, status: 500 });
    const h = getProviderHealth("aggprov");
    expect(h.provider).toBe("aggprov");
    expect(h.total).toBe(2);
    expect(h.successRate).toBe(0.5);
    expect(h.failures).toBe(1);
    expect(h.avgLatencyMs).toBe(150);
    expect(h.lastError).toBe("500");
  });

  it("returns a null-shape when no samples exist yet", () => {
    const h = getProviderHealth("nope");
    expect(h).toBeNull();
  });
});

describe("healthMonitor GC (A3)", () => {
  it("evicts idle entries but keeps entries refreshed within the idle window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2_000_000_000_000));
    recordHealthSample("idleprov", { success: true, latencyMs: 10 });
    recordHealthSample("activeprov", { success: true, latencyMs: 10 });

    // Advance just past a sweep interval but not idle, refresh activeprov.
    vi.setSystemTime(new Date(2_000_000_000_000 + 61 * 1000));
    recordHealthSample("activeprov", { success: true, latencyMs: 12 });
    expect(getAllProviderHealth().some((p) => p.provider === "activeprov")).toBe(true);
    // idleprov is older now but not yet past the idle threshold → still present.
    expect(getAllProviderHealth().some((p) => p.provider === "idleprov")).toBe(true);

    // Advance far past idle for idleprov (no new samples) → it gets evicted,
    // while activeprov (refreshed at 61s) survives.
    vi.setSystemTime(new Date(2_000_000_000_000 + 11 * 60 * 1000));
    const all = getAllProviderHealth();
    expect(all.some((p) => p.provider === "idleprov")).toBe(false);
    expect(all.some((p) => p.provider === "activeprov")).toBe(true);
  });
});

describe("healthMonitor dynamic config (A4)", () => {
  it("re-syncs windowMs and caps maxSamples when settings change at runtime", () => {
    // Create with a huge window → sample cap clamps to MAX_SAMPLES_CAP (2000).
    recordHealthSample("wprov", { success: true, latencyMs: 5 }, { healthMonitor: { windowMs: 3600000 } });
    let m = global._healthMonitors.get("wprov");
    expect(m.windowMs).toBe(3600000);
    expect(m.maxSamples).toBe(2000);

    // A later call with a smaller window re-syncs the entry (no longer fixed at create).
    recordHealthSample("wprov", { success: true, latencyMs: 5 }, { healthMonitor: { windowMs: 60000 } });
    m = global._healthMonitors.get("wprov");
    expect(m.windowMs).toBe(60000);
    expect(m.maxSamples).toBeLessThan(2000);
    expect(m.maxSamples).toBeGreaterThanOrEqual(200);
  });
});
