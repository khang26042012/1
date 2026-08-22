import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";

/**
 * POST /api/oauth/qwen/import
 * Import Qwen Web cookie credentials (cookie jar + optional bx-umidtoken).
 *
 * Request body:
 * - cookies: string — full Cookie header from chat.qwen.ai (must include cna,
 *   ssxmod_itna, and token). Stored as apiKey for the executor.
 * - umidToken: string (optional) — bx-umidtoken anti-bot header value, captured
 *   from DevTools → Network → request headers. Stored in providerSpecificData
 *   so the executor can send it as a header without polluting the Cookie value.
 */
export async function POST(request) {
  try {
    const { cookies, umidToken } = await request.json();

    if (!cookies || typeof cookies !== "string" || !cookies.trim()) {
      return NextResponse.json({ error: "Cookie header is required" }, { status: 400 });
    }
    if (!cookies.includes("token=")) {
      return NextResponse.json(
        { error: "Cookie jar is missing the 'token' cookie — copy the full Cookie header from chat.qwen.ai" },
        { status: 400 },
      );
    }

    const connection = await createProviderConnection({
      provider: "qwen-web",
      authType: "cookie",
      apiKey: cookies.trim(),
      providerSpecificData: {
        umidToken: umidToken?.trim() || "",
        authMethod: "imported",
      },
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
      },
    });
  } catch (error) {
    console.error("Qwen import error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/oauth/qwen/import
 * Instructions for importing Qwen Web credentials.
 */
export async function GET() {
  return NextResponse.json({
    provider: "qwen-web",
    method: "import",
    instructions:
      "Log in at chat.qwen.ai, open DevTools → Network, find any request to api/v2/ and copy the full Cookie header. Optionally copy the bx-umidtoken request header value.",
    requiredFields: [
      {
        name: "cookies",
        label: "Cookie Header",
        description: "Full Cookie header from chat.qwen.ai (must include cna, ssxmod_itna, token)",
        type: "textarea",
      },
      {
        name: "umidToken",
        label: "bx-umidtoken",
        description: "Anti-bot header value from request headers (optional — prevents 'unauthorized' errors)",
        type: "text",
      },
    ],
  });
}
