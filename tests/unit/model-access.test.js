import { describe, it, expect } from "vitest";

import { allowedByRule, checkModelAllowed, assertModelAllowed } from "../../src/sse/utils/modelAccess.js";

describe("allowedByRule", () => {
  it("exact match allows", () => {
    expect(allowedByRule(["openai/gpt-4o"], "openai/gpt-4o")).toBe(true);
  });
  it("exact match denies different model", () => {
    expect(allowedByRule(["openai/gpt-4o"], "openai/gpt-4o-mini")).toBe(false);
  });
  it("prefix rule allows matching prefix", () => {
    expect(allowedByRule(["openai/"], "openai/gpt-4o-mini")).toBe(true);
  });
  it("prefix rule denies different provider prefix", () => {
    expect(allowedByRule(["openai/"], "anthropic/claude")).toBe(false);
  });
  it("prefix rule without slash does not act as wildcard", () => {
    expect(allowedByRule(["openai"], "openai/gpt-4o")).toBe(false);
  });
  it("empty allowed list denies", () => {
    expect(allowedByRule([], "openai/gpt-4o")).toBe(false);
  });
});

describe("checkModelAllowed", () => {
  it("returns null for null keyObj", () => {
    expect(checkModelAllowed(null, "openai/gpt-4o")).toBeNull();
  });
  it("denies inactive key", () => {
    expect(checkModelAllowed({ isActive: false, allowedModels: ["openai/gpt-4o"] }, "openai/gpt-4o"))
      .toEqual({ allowed: false, denied: "(key inactive)" });
  });
  it("allows when allowedModels is null (allow-all)", () => {
    expect(checkModelAllowed({ isActive: true, allowedModels: null }, "any/model")).toBeNull();
  });
  it("allows when allowedModels is empty array", () => {
    expect(checkModelAllowed({ isActive: true, allowedModels: [] }, "any/model")).toBeNull();
  });
  it("allows exact match", () => {
    expect(checkModelAllowed({ isActive: true, allowedModels: ["openai/gpt-4o"] }, "openai/gpt-4o")).toBeNull();
  });
  it("denies non-matching model", () => {
    expect(checkModelAllowed({ isActive: true, allowedModels: ["openai/gpt-4o"] }, "openai/gpt-4o-mini"))
      .toEqual({ allowed: false, denied: "openai/gpt-4o-mini" });
  });
  it("allows prefix match", () => {
    expect(checkModelAllowed({ isActive: true, allowedModels: ["openai/"] }, "openai/gpt-4o-mini")).toBeNull();
  });
});

describe("assertModelAllowed", () => {
  it("returns null for allowed model", () => {
    expect(assertModelAllowed({ isActive: true, allowedModels: ["openai/"] }, "openai/gpt-4o")).toBeNull();
  });
  it("returns 401 for inactive key", async () => {
    const res = assertModelAllowed({ isActive: false, allowedModels: ["openai/"] }, "openai/gpt-4o");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toBe("API key is inactive");
  });
  it("returns 403 for denied model", async () => {
    const res = assertModelAllowed({ isActive: true, allowedModels: ["openai/"] }, "anthropic/claude");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toContain("not allowed for this API key");
  });
  it("returns null for null keyObj", () => {
    expect(assertModelAllowed(null, "openai/gpt-4o")).toBeNull();
  });
});