/**
 * OpenAI → Zed Hosted AI request translator.
 *
 * Wraps a standard OpenAI chat completion body into Zed's CompletionBody
 * envelope, routing the model to the correct nested upstream provider:
 *   claude / anthropic   → anthropic (Anthropic Messages API)
 *   gemini / google      → google    (Gemini generateContent)
 *   grok / x-ai          → x_ai      (OpenAI chat-compatible)
 *   everything else      → open_ai   (OpenAI Responses API)
 *
 * The envelope shape: { thread_id, prompt_id, provider, model, provider_request }
 * where provider_request is the native body for the resolved upstream.
 */
import { randomUUID } from "node:crypto";
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { openaiToClaudeRequest } from "./openai-to-claude.js";
import { openaiToGeminiRequest } from "./openai-to-gemini.js";
import { openaiToOpenAIResponsesRequest } from "./openai-responses.js";

/**
 * Resolve the Zed upstream provider for a given model id.
 * @param {string} model
 * @returns {"anthropic" | "google" | "x_ai" | "open_ai"}
 */
export function resolveZedProvider(model) {
  const m = String(model || "").toLowerCase();
  if (/(claude|anthropic)/i.test(m)) return "anthropic";
  if (/(gemini|google)/i.test(m)) return "google";
  if (/(grok|x[_-]?ai)/i.test(m)) return "x_ai";
  return "open_ai";
}

/**
 * Translate an OpenAI chat completion body into a Zed CompletionBody envelope.
 * @param {string} model
 * @param {object} body - OpenAI chat completion body
 * @param {boolean} stream
 * @returns {object} Zed CompletionBody
 */
export function openaiToZedRequest(model, body, stream = true) {
  // Already a CompletionBody (re-translation safety) — preserve and ensure model.
  if (body?.provider_request && body?.provider) {
    return { ...body, model: body.model || model };
  }

  const provider = resolveZedProvider(model);
  const wantStream = stream !== false;
  let providerRequest;

  if (provider === "anthropic") {
    providerRequest = openaiToClaudeRequest(model, body, wantStream);
  } else if (provider === "google") {
    providerRequest = openaiToGeminiRequest(model, body, wantStream);
  } else if (provider === "open_ai") {
    // Zed Hosted OpenAI models speak the Responses API (input + typed content).
    providerRequest = openaiToOpenAIResponsesRequest(model, body, wantStream);
    providerRequest.stream = wantStream;
  } else {
    // x_ai — OpenAI chat-compatible passthrough.
    providerRequest = { ...body, model, stream: wantStream };
    delete providerRequest.thread_id;
    delete providerRequest.prompt_id;
  }

  return {
    thread_id: body.thread_id || randomUUID(),
    prompt_id: body.prompt_id || randomUUID(),
    provider,
    model,
    provider_request: providerRequest,
  };
}

// Self-register: OpenAI → Zed request translation.
register(FORMATS.OPENAI, FORMATS.ZED, openaiToZedRequest, null);
