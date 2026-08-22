// Agnes AI (API) — official API key access to Agnes models via apihub.agnes-ai.com.
//
// Sibling of the cookie/JWT provider ("agnes-web"). This variant uses the
// official developer API key issued from the Agnes dashboard. OpenAI-compatible
// — no custom executor needed (DefaultExecutor handles it).
//
// Auth: standard Authorization: Bearer <api_key>
//
// Supports both LLM chat (streaming + vision) and image generation.

export default {
  id: "agnes-api",
  priority: 59,
  alias: "agnes-api",
  aliases: ["agnesaapi"],
  uiAlias: "agnes-api",
  display: {
    name: "Agnes AI (API)",
    icon: "auto_awesome",
    color: "#6C5CE7",
    textIcon: "AG",
    website: "https://app.agnes-ai.com",
    notice: {
      signupUrl: "https://app.agnes-ai.com",
      apiKeyUrl: "https://app.agnes-ai.com",
      text: "Agnes AI official API. Create an API key in your Agnes dashboard, then paste it here. OpenAI-compatible — supports streaming, vision, and reasoning. Free tier available for Agnes 2.0/2.5 Flash.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://apihub.agnes-ai.com/v1/chat/completions",
    format: "openai",
    validateUrl: "https://apihub.agnes-ai.com/v1/models",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  models: [
    // Reasoning models (paid)
    { id: "agnes-2.5-pro-alpha", name: "Agnes 2.5 Pro Alpha", contextWindow: 1000000, maxOutput: 65536 },
    // Standard models (free tier)
    { id: "agnes-2.5-flash", name: "Agnes 2.5 Flash", contextWindow: 524288, maxOutput: 65536 },
    { id: "agnes-2.0", name: "Agnes 2.0", contextWindow: 524288, maxOutput: 65536 },
  ],
  passthroughModels: true,
  modelsFetcher: {
    url: "https://apihub.agnes-ai.com/v1/models",
    type: "openai",
  },
  // Image generation via separate endpoint.
  serviceKinds: ["llm", "image"],
  imageConfig: {
    baseUrl: "https://apihub.agnes-ai.com/v1/images/generations",
    bodyFields: ["model", "prompt", "n", "size", "response_format"],
  },
};
