// Command Code — multi-model AI router (commandcode.ai).
//
// Originally used a custom CLI endpoint (/alpha/generate). Now supports the
// standard provider API with both OpenAI and Anthropic native formats.
//
// Multi-endpoint transport with cross-transport fallback: if the OpenAI
// endpoint times out or 5xxs, the engine retries via the Anthropic endpoint
// automatically (body is re-translated to Claude format).
//
// Models discovered live via /provider/v1/models at runtime (47 models as of
// 2026-07, including Claude, GPT, DeepSeek, GLM, Kimi, MiniMax, Qwen, etc).
import { CLAUDE_API_HEADERS } from "../shared.js";

export default {
  id: "commandcode",
  priority: 100,
  alias: "commandcode",
  aliases: ["cmc"],
  uiAlias: "cmc",
  display: {
    name: "Command Code",
    icon: "smart_toy",
    color: "#000000",
    textIcon: "CC",
    website: "https://commandcode.ai",
    notice: {
      text: "Command Code is a multi-model AI router with OpenAI and Anthropic API support. Create an API key at commandcode.ai/studio, then paste it here. Supports Claude, GPT, DeepSeek, GLM, Kimi, and more.",
      apiKeyUrl: "https://commandcode.ai/studio",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    // Default = OpenAI format (most clients use this).
    baseUrl: "https://api.commandcode.ai/provider/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.commandcode.ai/provider/v1/models",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  // Multi-endpoint: both OpenAI and Anthropic formats supported. The engine
  // picks the endpoint matching the client sourceFormat (skip translation),
  // and falls back to the alternate on timeout/5xx (cross-transport fallback).
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.commandcode.ai/provider/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://api.commandcode.ai/provider/v1/messages",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  // Live discovery — /provider/v1/models exposes the full catalog.
  models: [],
  passthroughModels: true,
  modelsFetcher: {
    url: "https://api.commandcode.ai/provider/v1/models",
    type: "openai",
  },
};
