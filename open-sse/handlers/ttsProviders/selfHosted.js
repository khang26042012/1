// Self-hosted OpenAI-compatible TTS (Kokoro-FastAPI, XTTS, gTTS wrappers).
// baseUrl comes from the provider node's providerSpecificData.baseUrl,
// not the global registry — one node can front several machines.
import { Buffer } from "node:buffer";
import { CUSTOM_TTS_PREFIX } from "@/shared/constants/providers";

export default {
  async synthesize(text, model, credentials) {
    // baseUrl from the node (injected by src/sse/handlers/tts.js via providerSpecificData)
    const base = credentials?.providerSpecificData?.baseUrl;
    if (!base) throw new Error("Self-hosted TTS: missing baseUrl");

    // model = "{modelId}/{voice}" or just voice; mirror OpenAI TTS conventions.
    let ttsModel = model;
    let voice = "default";
    if (model && model.includes("/")) {
      const parts = model.split("/");
      if (parts.length === 2) [ttsModel, voice] = parts;
    }
    if (!ttsModel) ttsModel = "tts";

    const res = await fetch(`${base.replace(/\/+$/, "")}/v1/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(credentials?.apiKey ? { "Authorization": `Bearer ${credentials.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: ttsModel, voice, input: text }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `TTS failed: ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    return { base64: Buffer.from(buf).toString("base64"), format: "mp3" };
  },
};

export const isSelfHostedTtsProvider = (providerId) =>
  typeof providerId === "string" && providerId.startsWith(CUSTOM_TTS_PREFIX);
