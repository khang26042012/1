// Tests for the shared ResponsesAccumulator — correlation, terminal output,
// usage extraction, exactly-once semantics. The accumulator is a standalone
// class (no transitive imports into proxyFetch/ssrfGuard), so we can test it
// directly without the full translator registration chain.
import { describe, it, expect } from "vitest";
import { ResponsesAccumulator } from "../../open-sse/translator/concerns/responsesAccumulator.js";

// ── Accumulator unit tests ────────────────────────────────────────────────

describe("ResponsesAccumulator — single tool call", () => {
  it("tracks a sequential tool call via output_index", () => {
    const acc = new ResponsesAccumulator();
    acc.ingest("response.output_item.added", { output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "get_weather" } });
    acc.ingest("response.function_call_arguments.delta", { output_index: 0, item_id: "fc_1", delta: '{"city":"NYC"}' });
    acc.ingest("response.output_item.done", { output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "get_weather", arguments: '{"city":"NYC"}' } });
    acc.ingest("response.completed", { response: { usage: { input_tokens: 10, output_tokens: 5 } } });

    expect(acc.hasTools).toBe(true);
    expect(acc.status).toBe("completed");
    expect(acc.usage).toEqual({ input_tokens: 10, output_tokens: 5, total_tokens: 15, cached_tokens: 0 });
    expect(acc.toolCallIndexFor(0)).toBe(0);
    expect(acc.output).toHaveLength(1);
    expect(acc.output[0]).toMatchObject({ type: "function_call", name: "get_weather", call_id: "call_1", arguments: '{"city":"NYC"}' });
  });
});

describe("ResponsesAccumulator — parallel/interleaved tool calls", () => {
  it("correlates interleaved argument deltas by output_index", () => {
    const acc = new ResponsesAccumulator();
    // Two tool calls registered.
    acc.ingest("response.output_item.added", { output_index: 0, item: { type: "function_call", id: "fc_a", call_id: "call_a", name: "search" } });
    acc.ingest("response.output_item.added", { output_index: 1, item: { type: "function_call", id: "fc_b", call_id: "call_b", name: "write" } });
    // Interleaved deltas — without correlation these would misroute.
    acc.ingest("response.function_call_arguments.delta", { output_index: 0, item_id: "fc_a", delta: '{"q":"test"}' });
    acc.ingest("response.function_call_arguments.delta", { output_index: 1, item_id: "fc_b", delta: '{"path":"/x"}' });
    acc.ingest("response.function_call_arguments.delta", { output_index: 0, item_id: "fc_a", delta: '{"extra":1}' });
    acc.ingest("response.output_item.done", { output_index: 0, item: { type: "function_call", id: "fc_a" } });
    acc.ingest("response.output_item.done", { output_index: 1, item: { type: "function_call", id: "fc_b" } });
    acc.ingest("response.completed", { response: {} });

    // Tool A at index 0, Tool B at index 1.
    expect(acc.toolCallIndexFor(0)).toBe(0);
    expect(acc.toolCallIndexFor(1)).toBe(1);
    // Arguments routed correctly despite interleaving.
    expect(acc.output[0].arguments).toBe('{"q":"test"}{"extra":1}');
    expect(acc.output[1].arguments).toBe('{"path":"/x"}');
  });

  it("correlates by item_id when output_index is absent", () => {
    const acc = new ResponsesAccumulator();
    acc.ingest("response.output_item.added", { output_index: 0, item: { type: "function_call", id: "fc_x", call_id: "call_x", name: "fn" } });
    // Delta carries only item_id, no output_index.
    acc.ingest("response.function_call_arguments.delta", { item_id: "fc_x", delta: '{"a":1}' });
    acc.ingest("response.output_item.done", { output_index: 0, item: { type: "function_call", id: "fc_x" } });
    acc.ingest("response.completed", { response: {} });

    expect(acc.output[0].arguments).toBe('{"a":1}');
  });
});

describe("ResponsesAccumulator — terminal events", () => {
  it("captures completed status + usage", () => {
    const acc = new ResponsesAccumulator();
    acc.ingest("response.completed", { response: { usage: { input_tokens: 100, output_tokens: 50, input_tokens_details: { cached_tokens: 20 } } } });
    expect(acc.status).toBe("completed");
    expect(acc.usage.total_tokens).toBe(150);
    expect(acc.usage.cached_tokens).toBe(20);
  });

  it("captures failed status + error", () => {
    const acc = new ResponsesAccumulator();
    acc.ingest("response.failed", { response: { error: { message: "model overload" } } });
    expect(acc.status).toBe("failed");
    expect(acc.error.message).toBe("model overload");
  });

  it("captures incomplete status", () => {
    const acc = new ResponsesAccumulator();
    acc.ingest("response.incomplete", { response: {} });
    expect(acc.status).toBe("incomplete");
  });

  it("captures cancelled status", () => {
    const acc = new ResponsesAccumulator();
    acc.ingest("response.cancelled", { response: {} });
    expect(acc.status).toBe("cancelled");
  });

  it("treats generic error event as failed", () => {
    const acc = new ResponsesAccumulator();
    acc.ingest("error", { error: { message: "timeout" } });
    expect(acc.status).toBe("failed");
  });
});

describe("ResponsesAccumulator — exactly-once emit tracking", () => {
  it("marks and checks emitted tool calls", () => {
    const acc = new ResponsesAccumulator();
    expect(acc.isToolCallEmitted("fc_1")).toBe(false);
    acc.markToolCallEmitted("fc_1");
    expect(acc.isToolCallEmitted("fc_1")).toBe(true);
  });
});

describe("ResponsesAccumulator — output reconstruction", () => {
  it("fills gaps with empty message placeholders", () => {
    const acc = new ResponsesAccumulator();
    acc.ingest("response.output_item.added", { output_index: 0, item: { type: "message", id: "m_1" } });
    // Index 1 missing — gap.
    acc.ingest("response.output_item.added", { output_index: 2, item: { type: "function_call", id: "fc_1", call_id: "c1", name: "fn" } });
    acc.ingest("response.completed", { response: {} });

    expect(acc.output).toHaveLength(3);
    expect(acc.output[1]).toMatchObject({ type: "message", content: [] });
    expect(acc.output[2]).toMatchObject({ type: "function_call", name: "fn" });
  });

  it("ingests full output array from response.completed (terminal-only providers)", () => {
    const acc = new ResponsesAccumulator();
    acc.ingest("response.completed", {
      response: {
        output: [
          { type: "message", id: "m_1", content: [{ type: "output_text", text: "Hello" }] },
          { type: "function_call", id: "fc_1", call_id: "c1", name: "fn", arguments: '{"a":1}' },
        ],
        usage: { input_tokens: 5, output_tokens: 3 },
      },
    });
    expect(acc.output).toHaveLength(2);
    expect(acc.output[0]).toMatchObject({ type: "message" });
    expect(acc.output[1]).toMatchObject({ type: "function_call", arguments: '{"a":1}' });
  });

  it("handles abort mid-stream (no terminal event)", () => {
    const acc = new ResponsesAccumulator();
    acc.ingest("response.output_item.added", { output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "c1", name: "fn" } });
    acc.ingest("response.function_call_arguments.delta", { output_index: 0, delta: '{"partial' });
    // Stream closes — no response.completed.
    expect(acc.status).toBeNull();
    // Partial output still available.
    expect(acc.output).toHaveLength(1);
    expect(acc.output[0].arguments).toBe('{"partial');
  });
});

describe("ResponsesAccumulator — usage edge cases", () => {
  it("returns null usage when no response.completed seen", () => {
    const acc = new ResponsesAccumulator();
    acc.ingest("response.output_text.delta", { delta: "hi" });
    expect(acc.usage).toBeNull();
  });

  it("captures cached_tokens from input_tokens_details", () => {
    const acc = new ResponsesAccumulator();
    acc.ingest("response.completed", {
      response: { usage: { input_tokens: 100, output_tokens: 50, input_tokens_details: { cached_tokens: 40 } } },
    });
    expect(acc.usage.cached_tokens).toBe(40);
  });

  it("falls back to cache_read_input_tokens field", () => {
    const acc = new ResponsesAccumulator();
    acc.ingest("response.completed", {
      response: { usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 30 } },
    });
    expect(acc.usage.cached_tokens).toBe(30);
  });
});
