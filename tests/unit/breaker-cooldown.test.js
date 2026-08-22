import { describe, it, expect, vi, afterEach } from "vitest";
import {
  recordBreakerFailure,
  getBreakerCooldownEndsAt,
  getBreakerStates,
} from "open-sse/services/circuitBreaker.js";

const SETTINGS = {
  circuitBreaker: {
    enabled: true,
    failureThreshold: 1,
    windowMs: 60000,
    cooldownMs: 30000,
    halfOpenMaxCalls: 1,
  },
};

afterEach(() => {
  vi.useRealTimers();
  global._circuitBreakers?.clear();
});

describe("getBreakerCooldownEndsAt", () => {
  it("returns cooldownEndsAt epoch ms when breaker is OPEN", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000_000_000_000));
    recordBreakerFailure("prov", 503, SETTINGS); // threshold=1 → trips OPEN

    const cooldown = getBreakerCooldownEndsAt("prov");
    expect(cooldown).toBe(1_000_000_000_000 + 30000);
  });

  it("returns null when breaker has no state (never tripped)", () => {
    expect(getBreakerCooldownEndsAt("unknown")).toBeNull();
  });

  it("respects a distinct proxy key", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000_000_000_000));
    recordBreakerFailure("prov", 501, SETTINGS, "prov:proxy:dead"); // key variant

    // Plain provider key untouched; proxy key reports cooldown.
    expect(getBreakerCooldownEndsAt("prov")).toBe(null);
    expect(getBreakerCooldownEndsAt("prov", "prov:proxy:dead")).toBe(1_000_000_000_000 + 30000);
  });
});