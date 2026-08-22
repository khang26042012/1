export default {
  id: "kimchi",
  priority: 95,
  alias: "kimchi",
  uiAlias: "kimchi",
  display: {
    name: "Kimchi",
    icon: "restaurant",
    color: "#FF521D",
    textIcon: "KC",
    website: "https://kimchi.dev",
    notice: {
      signupUrl: "https://app.kimchi.dev",
    },
  },
  category: "oauth",
  authModes: ["oauth"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://llm.kimchi.dev/openai/v1/chat/completions",
    format: "openai",
    // Kimchi (hosted vLLM) REJECTS non-streaming requests carrying
    // stream_options (returns 400 "stream_options is only allowed when stream is
    // enabled"). DefaultExecutor auto-injects stream_options for streaming
    // requests, so we drop any client-sent value outright.
    quirks: { dropStreamOptions: true },
    headers: {
      // Masquerade as the current Kimchi CLI so the server treats router
      // traffic identically to the official CLI (v0.1.76 latest, 2026-07-31).
      "User-Agent": "kimchi/0.1.76",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  // Active models per the official CLI model-registry (castai/kimchi).
  // kimi-k2.5 / claude-opus-4-6 / claude-sonnet-4-6 are marked "ignored" by
  // the CLI and are intentionally absent here.
  models: [
    { id: "kimi-k2.7", name: "Kimi K2.7" },
    { id: "kimi-k2.6", name: "Kimi K2.6" },
    { id: "minimax-m3", name: "MiniMax M3" },
    { id: "minimax-m2.7", name: "MiniMax M2.7" },
    { id: "nemotron-3-ultra-fp4", name: "Nemotron 3 Ultra FP4" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  ],
  serviceKinds: ["llm", "imageToText"],
  features: { usage: true },
  oauth: {
    webAppUrl: "https://app.kimchi.dev",
    validationUrl: "https://api.cast.ai/v1/llm/openai/supported-providers",
    userInfoUrl: "https://app.kimchi.dev/api/v1/me",
    modelsUrl: "https://llm.kimchi.dev/v1/models/metadata?include_in_cli=true",
  },
  passthroughModels: true,
};
