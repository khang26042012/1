// A3 GC: idle CLOSED breaker entries are evicted so the in-memory map stays
// bounded on a long-lived process. Only entries idle past the threshold are
// removed; recently-active and open/half-open entries are preserved.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  recordBreakerFailure, getBreakerStates,
} from "open-sse/services/circuitBreaker.js";

const SETTINGS = {
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5, // 1 failure → stays CLOSED
    windowMs: 60000,
    cooldownMs: 60000,
    halfOpenMaxCalls: 1,
  },
};

afterEach(() => {
  vi.useRealTimers();
  global._circuitBreakers?.clear();
});

describe("circuit breaker GC (A3)", () => {
  it("evicts a CLOSED entry idle beyond the threshold", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000_000_000_000));
    recordBreakerFailure("gcprov", 500, SETTINGS); // 1 failure → closed, lastActivityAt = now
    expect(getBreakerStates().some((s) => s.provider === "gcprov")).toBe(true);

    // Advance far past the 10-min idle threshold, then trigger a read (sweep).
    vi.setSystemTime(new Date(1_000_000_000_000 + 11 * 60 * 1000));
    expect(getBreakerStates().some((s) => s.provider === "gcprov")).toBe(false);
  });

  it("keeps an entry made active again shortly before the sweep", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000_000_000_000));
    recordBreakerFailure("activeprov", 500, SETTINGS); // lastActivityAt = now

    // Advance just past a sweep interval (60s) but NOT the idle threshold (10 min),
    // then refresh activity so it should survive.
    vi.setSystemTime(new Date(1_000_000_000_000 + 61 * 1000));
    recordBreakerFailure("activeprov", 500, SETTINGS); // lastActivityAt = 61s
    expect(getBreakerStates().some((s) => s.provider === "activeprov")).toBe(true);
  });
});
