// Shared SSE primitives. Imports kept minimal (only constants) to stay safe for
// executors + stream.js; no circular dependency to sseConstants anywhere.
import { ANTHROPIC_API_VERSION } from "../providers/shared.js";

export const SSE_DONE = "data: [DONE]\n\n";

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive"
};

// Variant for web-cookie executors behind nginx (disable proxy buffering)
export const SSE_HEADERS_NO_BUFFER = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "X-Accel-Buffering": "no"
};

// Variant for client-facing SSE responses (adds permissive CORS).
// anthropic-version is echoed so Anthropic-format clients (Claude CLI / SDK)
// recognize the response as a valid API response — some versions abort a 200
// stream that lacks it ("empty or malformed response"). Harmless for OpenAI clients.
export const SSE_HEADERS_CORS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
  "Access-Control-Allow-Origin": "*",
  "anthropic-version": ANTHROPIC_API_VERSION,
};
