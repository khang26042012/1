// Zed Hosted AI executor — ported from decolua/9router executors/zed.js.
//
// Posts a CompletionBody envelope to cloud.zed.dev/completions:
//   { thread_id, prompt_id, provider, model, provider_request }
// where `provider` is "anthropic" | "google" | "open_ai" | "x_ai" (snake_case,
// matching Zed's LanguageModelProvider serde) and `provider_request` is the
// translated per-upstream here so no lossy middle format is involved:
//   claude → openaiToClaudeRequest | gemini → openaiToGeminiRequest
//   openai → openaiToOpenAIResponsesRequest | x-ai → OpenAI-shaped passthrough
// The NDJSON {event}/{status}/[DONE] stream is translated back to OpenAI SSE
// via the matching response translator (claude/gemini/openai-responses).
//
// The provider mapping comes from the LIVE Zed model catalog (GET /models,
// cached 1h with in-flight dedup in shared/zedAuth.js); falls back to
// name-based inference when the catalog is unavailable. LLM bearer token is
// minted per-request via /client/llm_tokens (50-min cache) and auto-refreshed
// on 401 / x-zed-expired-token / x-zed-outdated-token.
//
// LOCAL ADAPTATIONS vs 9router:
//  - keeps proactive refreshCredentials (mint via fetchZedLlmToken) so the
//    health/refresh pipeline still works;
//  - x-zed-version falls back to the local client version;
//  - proxyOptions threaded through to zedAuth fetches.

import { BaseExecutor } from "./base.js";
import { FORMATS } from "../translator/formats.js";
import { initState } from "../translator/index.js";
import { openaiToClaudeRequest } from "../translator/request/openai-to-claude.js";
import { openaiToGeminiRequest } from "../translator/request/openai-to-gemini.js";
import { openaiToOpenAIResponsesRequest } from "../translator/request/openai-responses.js";
import { claudeToOpenAIResponse } from "../translator/response/claude-to-openai.js";
import { geminiToOpenAIResponse } from "../translator/response/gemini-to-openai.js";
import { openaiResponsesToOpenAIResponse } from "../translator/response/openai-responses.js";
import {
  ZED_HEADERS,
  resolveZedModels,
  zedLlmFetch,
  fetchZedLlmToken,
} from "../shared/zedAuth.js";

// Server-side LanguageModelProvider enum serializes WITH snake_case
// (#[serde(rename_all = "snake_case")]) — "open_ai" not "OpenAi". Sending
// PascalCase makes cloud.zed.dev fail to deserialize the envelope → 500
// "An internal server error occurred".
const ZED_PROVIDER = {
  anthropic: "anthropic",
  openai: "open_ai",
  google: "google",
  xai: "x_ai",
};

// Local client version sent as x-zed-version (9router uses its app version).
const DEFAULT_ZED_VERSION = "1.6.3";

function normalizeZedProvider(value, model) {
  const raw = String(value || "").toLowerCase();
  if (raw === "anthropic") return ZED_PROVIDER.anthropic;
  if (raw === "openai" || raw === "open_ai") return ZED_PROVIDER.openai;
  if (raw === "google" || raw === "gemini") return ZED_PROVIDER.google;
  if (raw === "xai" || raw === "x_ai" || raw === "x-ai") return ZED_PROVIDER.xai;

  const m = String(model || "").toLowerCase();
  if (m.includes("claude")) return ZED_PROVIDER.anthropic;
  if (m.includes("gemini")) return ZED_PROVIDER.google;
  if (m.includes("grok") || m.includes("xai")) return ZED_PROVIDER.xai;
  return ZED_PROVIDER.openai;
}

function buildProviderRequest(provider, model, body, stream, credentials) {
  if (provider === ZED_PROVIDER.anthropic) {
    return openaiToClaudeRequest(model, body, true);
  }
  if (provider === ZED_PROVIDER.google) {
    return openaiToGeminiRequest(model, body, true);
  }
  if (provider === ZED_PROVIDER.openai) {
    return openaiToOpenAIResponsesRequest(model, body, true, credentials);
  }
  // xAI is OpenAI-shaped — forward as-is.
  return { ...(body || {}), model, stream: stream !== false };
}

function initProviderState(provider, model) {
  if (provider === ZED_PROVIDER.anthropic) return initState(FORMATS.CLAUDE);
  if (provider === ZED_PROVIDER.google) return initState(FORMATS.GEMINI);
  if (provider === ZED_PROVIDER.openai) return initState(FORMATS.OPENAI_RESPONSES);
  const state = initState(FORMATS.OPENAI);
  state.model = model;
  return state;
}

function convertProviderEvent(provider, event, state) {
  if (provider === ZED_PROVIDER.anthropic) return claudeToOpenAIResponse(event, state);
  if (provider === ZED_PROVIDER.google) return geminiToOpenAIResponse(event, state);
  if (provider === ZED_PROVIDER.openai) return openaiResponsesToOpenAIResponse(event, state);
  return event;
}

function createErrorChunk(model, message) {
  return {
    id: `chatcmpl-zed-error-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      { index: 0, delta: { content: `[Zed error] ${message}` }, finish_reason: "stop" },
    ],
  };
}

function enqueueSseObject(controller, encoder, chunk) {
  if (!chunk) return;
  const items = Array.isArray(chunk) ? chunk : [chunk];
  for (const item of items) {
    if (!item) continue;
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(item)}\n\n`));
  }
}

function unwrapZedLine(line) {
  let text = line.replace(/\r$/, "").trim();
  if (!text) return null;
  if (text.startsWith("data:")) text = text.slice(5).trimStart();
  if (text === "[DONE]") return { done: true };
  try {
    const parsed = JSON.parse(text);
    if (parsed && Object.prototype.hasOwnProperty.call(parsed, "event")) {
      return { event: parsed.event };
    }
    if (parsed && Object.prototype.hasOwnProperty.call(parsed, "status")) {
      return { status: parsed.status };
    }
    return { event: parsed };
  } catch {
    return null;
  }
}

function normalizeStatus(status) {
  if (!status) return null;
  if (typeof status === "string") return { type: status };
  if (typeof status === "object") {
    const key = Object.keys(status)[0];
    if (key && typeof status[key] === "object") return { type: key, ...status[key] };
    return status;
  }
  return null;
}

function wrapZedCompletionStream(response, provider, model) {
  if (!response.ok || !response.body) return response;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state = initProviderState(provider, model);
  let buffer = "";
  let done = false;

  const finish = (controller) => {
    if (done) return;
    const finalChunk = convertProviderEvent(provider, null, state);
    enqueueSseObject(controller, encoder, finalChunk);
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    done = true;
  };

  const processLine = (line, controller) => {
    if (done) return;
    const payload = unwrapZedLine(line);
    if (!payload) return;
    if (payload.done) {
      finish(controller);
      return;
    }
    if (payload.status) {
      const status = normalizeStatus(payload.status);
      if (status?.type === "failed" || status?.failed) {
        const failed = status.failed || status;
        const message = String(failed.message || failed.error || failed.code || "request failed");
        enqueueSseObject(controller, encoder, createErrorChunk(model, message));
        finish(controller);
      } else if (status?.type === "stream_ended" || status === "stream_ended") {
        finish(controller);
      }
      return;
    }
    const converted = convertProviderEvent(provider, payload.event, state);
    enqueueSseObject(controller, encoder, converted);
  };

  const transformed = response.body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          processLine(line, controller);
        }
      },
      flush(controller) {
        buffer += decoder.decode();
        if (buffer) {
          processLine(buffer, controller);
          buffer = "";
        }
        finish(controller);
      },
    }),
  );

  return new Response(transformed, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

class ZedExecutor extends BaseExecutor {
  constructor() {
    super("zed");
  }

  // Resolve the Zed-side provider for a model from the LIVE catalog.
  async resolveModel(model, credentials, signal, log) {
    try {
      const catalog = await resolveZedModels(credentials, { config: this.config, signal });
      let raw = catalog?.rawById?.get(model) ?? null;
      if (!raw) {
        const refreshed = await resolveZedModels(credentials, {
          config: this.config,
          signal,
          forceRefresh: true,
        });
        raw = refreshed?.rawById?.get(model) ?? null;
      }
      return { raw, provider: normalizeZedProvider(raw?.provider, model) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log?.warn?.("ZED", `model catalog unavailable, inferring provider for ${model}: ${message}`);
      return { raw: null, provider: normalizeZedProvider(null, model) };
    }
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const { provider } = await this.resolveModel(model, credentials, signal, log);
    const providerRequest = buildProviderRequest(provider, model, body, stream, credentials);
    const bodyRecord = body || {};
    const payload = {
      thread_id: bodyRecord.thread_id || credentials?._clientSessionId,
      prompt_id: bodyRecord.prompt_id,
      provider,
      model,
      provider_request: providerRequest,
    };

    const zedConfig = {
      llmBaseUrl: (this.config?.baseUrl || "https://cloud.zed.dev").replace(/\/$/, ""),
      cloudBaseUrl: (this.config?.baseUrl || "https://cloud.zed.dev").replace(/\/$/, ""),
    };

    const response = await zedLlmFetch(credentials, "/completions", {
      config: zedConfig,
      signal,
      proxyOptions,
      fetchOptions: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson, text/event-stream, */*",
          "User-Agent": "extremerouter/zed",
          "x-zed-version": this.config?.appVersion?.toString() || DEFAULT_ZED_VERSION,
          [ZED_HEADERS.clientSupportsStatus]: "true",
          [ZED_HEADERS.clientSupportsStreamEnded]: "true",
        },
        body: JSON.stringify(payload),
      },
    });

    const wrapped = response.ok ? wrapZedCompletionStream(response, provider, model) : response;
    return {
      response: wrapped,
      url: `${zedConfig.llmBaseUrl}/completions`,
      headers: { "Content-Type": "application/json", Authorization: "Bearer <zed-llm-token>" },
      transformedBody: payload,
    };
  }

  parseError(response, bodyText) {
    let parsed = null;
    try {
      parsed = JSON.parse(bodyText || "{}");
    } catch {
      parsed = null;
    }

    const errorObj = parsed?.error || undefined;
    const code = parsed?.code || errorObj?.code || "";
    const rawMessage =
      parsed?.message || errorObj?.message || bodyText || response.statusText;

    if (code === "trial_blocked") {
      return {
        status: response.status,
        message: `Zed trial access is blocked upstream. The account can list hosted models, but Zed is refusing completions until trial/billing access is enabled or unblocked. Zed says: ${rawMessage}`,
      };
    }
    if (code) {
      return { status: response.status, message: `Zed ${code}: ${rawMessage}` };
    }
    // Non-JSON upstream body (e.g. generic "An internal server error occurred")
    // tells us nothing about which model/request shape failed. Keep the raw body
    // so 500-class failures are debuggable instead of lossy.
    if (parsed && (parsed.message || parsed.error)) {
      return { status: response.status, message: rawMessage };
    }
    return {
      status: response.status,
      message: rawMessage || `Zed upstream error: ${response.status}`,
      rawBody: bodyText || null,
    };
  }

  // LOCAL ADAPTATION: proactive LLM token mint for the health/refresh pipeline
  // (9router refreshes inline only via zedLlmFetch's 401 retry).
  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials) return null;
    const zedConfig = {
      llmBaseUrl: (this.config?.baseUrl || "https://cloud.zed.dev").replace(/\/$/, ""),
      cloudBaseUrl: (this.config?.baseUrl || "https://cloud.zed.dev").replace(/\/$/, ""),
    };
    try {
      const token = await fetchZedLlmToken(credentials, {
        config: zedConfig,
        proxyOptions,
      });
      return {
        accessToken: token,
        expiresIn: 3600,
        providerSpecificData: {
          llmToken: token,
          lastLlmTokenAt: new Date().toISOString(),
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log?.error?.("TOKEN_REFRESH", `Zed LLM token refresh failed: ${message}`);
      return null;
    }
  }
}

export { ZedExecutor };
export default ZedExecutor;