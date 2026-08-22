import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";

// Models that use /zen/v1/messages (claude format)
const MESSAGES_MODELS = new Set();

export class OpenCodeExecutor extends BaseExecutor {
  constructor() {
    super("opencode", PROVIDERS.opencode);
  }

  transformRequest(model, body, stream) {
    // OpenCode is OpenAI-compatible and REJECTS `stream_options` without
    // `stream: true` (400 "stream_options should be set along with stream = true").
    // On non-streaming requests strip any client-sent stream_options so the pair
    // can't go out mismatched (mirrors DefaultExecutor's stream/stream_options
    // handling). The executor never injects stream_options on stream either —
    // opencode accepts plain `stream: true`.
    if (stream === false && body && typeof body === "object" && body.stream_options !== undefined) {
      body = { ...body };
      delete body.stream_options;
    }
    return injectReasoningContent({ provider: this.provider, model, body });
  }

  buildUrl(model) {
    const base = this.config.baseUrl;
    return MESSAGES_MODELS.has(model)
      ? `${base}/zen/v1/messages`
      : `${base}/zen/v1/chat/completions`;
  }

  buildHeaders() {
    return {
      "Content-Type": "application/json",
      "Authorization": "Bearer public",
      "x-opencode-client": "desktop",
      "Accept": "text/event-stream"
    };
  }
}
