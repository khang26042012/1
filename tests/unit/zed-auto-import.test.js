import { describe, it, expect } from "vitest";

// Pull the pure parse helper out of the route by reading the file and
// extracting the function body is brittle; instead replicate the exact
// Credential-Manager payload shape and assert parseCredentialsPayload handles
// it. The function lives in the route module — import it via a small re-export
// is not available (Next route), so we test the parsing contract directly.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const routeSrc = readFileSync(join(process.cwd(), "src/app/api/oauth/zed/auto-import/route.js"), "utf8");

// Extract the parseCredentialsPayload function source and eval it in isolation.
const fnMatch = routeSrc.match(/function parseCredentialsPayload[\s\S]*?\n}/);
if (!fnMatch) throw new Error("parseCredentialsPayload not found in route");
// eslint-disable-next-line no-new-func
const parseCredentialsPayload = new Function(`return (${fnMatch[0]})`)();

describe("Zed Windows Credential Manager auto-import parsing", () => {
  it("parses keyring-v2 JSON blob with username hint (Windows CM shape)", () => {
    // Shape CredRead returns on Windows for zed:url=https://zed.dev:
    // username = user_id, blob = UTF-8 keyring-v2 JSON. Placeholder values —
    // never put real credentials in tests.
    const blob = '{"version":2,"id":"client_token_TESTID","token":"TEST_ACCESS_TOKEN_0123456789abcdef"}';
    const parsed = parseCredentialsPayload(blob, "1234567890");
    expect(parsed).toEqual({
      userId: "1234567890",
      accessToken: blob, // whole JSON is the access token used in Authorization
    });
  });

  it("rejects keyring-v2 JSON when username hint is not numeric", () => {
    const blob = '{"version":2,"token":"abc123"}';
    const parsed = parseCredentialsPayload(blob, "not-a-user-id");
    expect(parsed).toBeNull();
  });

  it("parses plain 'userId accessToken' spaced format", () => {
    const parsed = parseCredentialsPayload("1000000000 secret-token-here");
    expect(parsed).toEqual({ userId: "1000000000", accessToken: "secret-token-here" });
  });

  it("falls back to raw token when username hint numeric and token >= 16 chars", () => {
    const parsed = parseCredentialsPayload("not-json-but-a-very-long-token-value", "2000000000");
    expect(parsed).toEqual({ userId: "2000000000", accessToken: "not-json-but-a-very-long-token-value" });
  });
});
