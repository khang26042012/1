/**
 * Zed → OpenAI response translator.
 *
 * The ZedExecutor already emits OpenAI chat.completion(.chunk) objects from the
 * upstream JSONL stream, so this translator is a passthrough — it returns
 * chunks unchanged so the rest of the gateway pipeline can treat Zed as a
 * standard OpenAI-format provider.
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";

/**
 * @param {object|null} chunk - OpenAI chat.completion(.chunk) from the executor
 * @returns {object|null} the same chunk (passthrough)
 */
export function zedToOpenAIResponse(chunk) {
  if (!chunk) return null;
  // Already OpenAI-shaped — no transformation needed.
  if (chunk.object === "chat.completion.chunk" && chunk.choices) return chunk;
  if (chunk.object === "chat.completion" && chunk.choices) return chunk;
  return chunk;
}

// Self-register: Zed → OpenAI response translation.
register(FORMATS.ZED, FORMATS.OPENAI, null, zedToOpenAIResponse);
