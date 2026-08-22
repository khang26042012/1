export function sseChunk(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// Build OpenAI chat.completion.chunk SSE frame. Key order: id, object, created, model, choices.
export function chatChunkSse({ id, created, model, delta, finishReason = null }) {
  return sseChunk({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });
}

/**
 * Read an SSE stream from a ReadableStream reader, invoking onEvent for each
 * parsed `data:` JSON payload and onDone for `[DONE]`. Handles partial chunks
 * across read boundaries and multi-JSON lines (concatenated `data:` lines).
 *
 * Replaces the 22+ duplicated `for (const line of lines) { if (!line.startsWith("data: ")) ... }`
 * loops scattered across executors. Returns when the stream ends or [DONE] is seen.
 *
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @param {Object} handlers
 * @param {(data: object) => void} [handlers.onEvent] — called for each parsed JSON event
 * @param {() => void} [handlers.onDone] — called when [DONE] sentinel is encountered
 * @param {AbortSignal} [handlers.signal] — if aborted, stops reading immediately
 */
export async function parseEventStream(reader, { onEvent, onDone, signal } = {}) {
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;

        const payload = trimmed.replace(/^data:\s*/, "").trim();
        if (payload === "[DONE]") {
          onDone?.();
          return;
        }
        if (!payload) continue;

        try {
          const data = JSON.parse(payload);
          onEvent?.(data);
        } catch {
          // Non-JSON data line — skip (matches existing executor behavior)
        }
      }
    }

    // Flush any trailing partial line
    if (buffer.trim().startsWith("data:")) {
      const payload = buffer.trim().replace(/^data:\s*/, "").trim();
      if (payload === "[DONE]") {
        onDone?.();
      } else if (payload) {
        try {
          const data = JSON.parse(payload);
          onEvent?.(data);
        } catch { /* skip */ }
      }
    }
  } finally {
    // Release the reader lock so the stream can be cancelled or reused.
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}
