// Ground-truth regression for combo dispatch with an OpenAI-only provider member.
//
// Verifies the full per-leg rectangle that handleSingleModelChat() in combo.js
// sets up for a Claude /v1/messages client request dispatched to a provider whose
// transport resolves to the OpenAI format (e.g. openai-compatible-*, openai):
//   sourceFormat (from endpoint) = CLAUDE
//   targetFormat (from provider transport) = OPENAI
//
// 1. translateRequest(CLAUDE -> OPENAI) converts a Claude /v1/messages body
//    into a valid /chat/completions shape (no passthrough, no leftover image_url).
// 2. DefaultExecutor.buildUrl for an "openai-compatible-*" provider resolves to
//    .../chat/completions (NOT /v1/messages which an Anthropic-format transport would use).
// 3. translateResponse(OPENAI -> CLAUDE) emits a well-formed Anthropic SSE sequence
//    beginning with message_start and ending with message_stop, plus anthropic-version
//    in CORS headers (echoed to the Claude SDK/CLI).
//
// Failure of any assertion == regression.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest, initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { detectFormatByEndpoint } from "../../open-sse/translator/formats.js";
import { getTargetFormat } from "../../open-sse/services/provider.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { SSE_HEADERS_CORS } from "../../open-sse/utils/sseConstants.js";

// Minimal Claude /v1/messages body (Claude Code style).
const claudeBody = {
  model: "claude-3-5-sonnet-20241022",
  max_tokens: 1024,
  messages: [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi there" },
    { role: "user", content: "Thanks" }
  ]
};

describe("combo leg (Claude -> OpenAI-only provider) does not route to /v1/messages", () => {
  const provider = "openai-compatible-test";

  it("source format is detected as CLAUDE from /v1/messages", () => {
    expect(detectFormatByEndpoint("/v1/messages", claudeBody)).toBe(FORMATS.CLAUDE);
  });

  it("target format for an openai-compatible- provider is OPENAI", () => {
    expect(getTargetFormat(provider)).toBe(FORMATS.OPENAI);
  });

  it("translateRequest(CLAUDE->OPENAI) produces /chat/completions shape with no image_url", () => {
    const out = translateRequest(
      FORMATS.CLAUDE, FORMATS.OPENAI,
      "m", JSON.parse(JSON.stringify(claudeBody)), true, null, provider
    );
    // OpenAI shape: top-level choices model is not relevant here; body must have messages[]
    expect(Array.isArray(out.messages)).toBe(true);
    const userMsgs = out.messages.filter((m) => m.role === "user");
    expect(userMsgs.map((m) => m.content)).toEqual(["Hello", "Thanks"]);
    // No passthrough of Claude-only image_url; Claude body has no image anyway, but guard it.
    const json = JSON.stringify(out);
    expect(json).not.toContain("source");
    expect(json).not.toContain("image_url");
  });

  it("DefaultExecutor.buildUrl resolves to /chat/completions for openai-compatible-*", () => {
    const exec = getExecutor(provider);
    const url = exec.buildUrl("gpt-4o", true, 0, {
      providerSpecificData: { baseUrl: "https://example.com/v1" }
    });
    expect(url).toBe("https://example.com/v1/chat/completions");
    expect(url).not.toMatch(/\/messages$/);
  });

  it("translateResponse(OPENAI->CLAUDE) emits valid Anthropic SSE sequence", () => {
    const state = initState(FORMATS.CLAUDE);
    const upstreamChunks = [
      { id: "chatcmpl-1", model: "gpt-4o", choices: [{ delta: { content: "Hello" } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] }
    ];
    const events = [];
    for (const c of upstreamChunks) {
      const out = translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, c, state);
      if (Array.isArray(out)) events.push(...out);
      else if (out) events.push(out);
    }
    // First event MUST be message_start
    expect(events[0].type).toBe("message_start");
    expect(events[0].message.role).toBe("assistant");
    // Must contain content_block_delta with text
    expect(events.some((e) => e.type === "content_block_delta" && e.delta?.text === "Hello")).toBe(true);
    // Must end with message_stop
    expect(events.at(-1).type).toBe("message_stop");
    // Must NOT leak an upstream OpenAI error shape
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("upstream OpenAI error is surfaced as an Anthropic `error` event (not dropped)", () => {
    const state = initState(FORMATS.CLAUDE);
    const out = translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, {
      error: { type: "invalid_request_error", message: "context_length_exceeded foo bar" }
    }, state);
    const events = Array.isArray(out) ? out : [];
    expect(events.some((e) => e.type === "error")).toBe(true);
    const err = events.find((e) => e.type === "error");
    expect(err.error.type).toBe("invalid_request_error");
    expect(err.error.message).toContain("context_length_exceeded");
  });

  it("client-facing SSE headers carry anthropic-version for Claude SDK/CLI", () => {
    expect(SSE_HEADERS_CORS["anthropic-version"]).toBe("2023-06-01");
    expect(SSE_HEADERS_CORS["Content-Type"]).toBe("text/event-stream");
  });
});