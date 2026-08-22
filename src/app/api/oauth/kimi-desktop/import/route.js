import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";

/**
 * POST /api/oauth/kimi-desktop/import
 * Persist a Kimi desktop session.
 *
 * Request body:
 * - accessToken: string — the kimi-auth JWT from the desktop token store.
 *   Stored as apiKey so the kimi-web executor picks it up (Bearer + Cookie).
 * - origin: string (optional) — the store origin (https://www.kimi.com).
 * - label: string (optional) — account label from JWT claims, for display.
 */
export async function POST(request) {
  try {
    const { accessToken, origin, label } = await request.json();

    if (!accessToken || typeof accessToken !== "string" || !accessToken.trim()) {
      return NextResponse.json({ error: "Access token is required" }, { status: 400 });
    }
    if (!/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken.trim())) {
      return NextResponse.json(
        { error: "That doesn't look like a Kimi session JWT (should start with eyJ...)" },
        { status: 400 },
      );
    }

    const connection = await createProviderConnection({
      provider: "kimi-desktop",
      authType: "oauth",
      apiKey: accessToken.trim(),
      name: label || "Kimi Desktop",
      providerSpecificData: {
        origin: origin || "https://www.kimi.com",
        authMethod: "imported",
      },
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        name: connection.name,
      },
    });
  } catch (error) {
    console.log("Kimi desktop import error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/oauth/kimi-desktop/import
 * Instructions for importing a Kimi desktop session.
 */
export async function GET() {
  return NextResponse.json({
    provider: "kimi-desktop",
    method: "import_token",
    instructions:
      "Log in to the Kimi desktop app, then click auto-detect below — the gateway reads the session from the app's token store. If that fails, paste the kimi-auth JWT (from the desktop app's bridge-store) manually.",
    requiredFields: [
      {
        name: "accessToken",
        label: "Kimi Session JWT",
        description: "kimi-auth JWT from the Kimi desktop app token store",
        type: "textarea",
      },
    ],
  });
}