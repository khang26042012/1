import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";

/**
 * POST /api/oauth/1min/import
 * Import 1min.ai web cookie credentials (JWT + TeamId + Cookies).
 *
 * Request body:
 * - jwt: string — x-auth-token Bearer value (primary API auth)
 * - teamId: string — team UUID from API URL path (/teams/{teamId}/...)
 * - cookies: string (optional) — full Cookie header for Cloudflare bypass
 *
 * The JWT payload only contains the user UUID, not the team UUID — so teamId
 * must be provided separately by the user.
 */
export async function POST(request) {
  try {
    const { jwt, teamId, cookies } = await request.json();

    if (!jwt || typeof jwt !== "string") {
      return NextResponse.json({ error: "JWT token is required" }, { status: 400 });
    }
    if (!teamId || typeof teamId !== "string") {
      return NextResponse.json({ error: "Team ID is required" }, { status: 400 });
    }

    // Normalize JWT: strip "Bearer " prefix if present
    let normalizedJwt = jwt.trim();
    if (normalizedJwt.toLowerCase().startsWith("bearer ")) {
      normalizedJwt = normalizedJwt.slice(7).trim();
    }

    // Basic format validation
    if (normalizedJwt.split(".").length !== 3) {
      return NextResponse.json(
        { error: "Invalid JWT format — expected 3 dot-separated segments (header.payload.signature)" },
        { status: 400 },
      );
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(teamId.trim())) {
      return NextResponse.json(
        { error: "Invalid Team ID format — expected a UUID (e.g. 3cf6f69c-2006-4ce2-93d5-de493365e967)" },
        { status: 400 },
      );
    }

    const connection = await createProviderConnection({
      provider: "1min",
      authType: "cookie",
      apiKey: normalizedJwt,
      providerSpecificData: {
        teamId: teamId.trim(),
        cookies: cookies?.trim() || "",
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
    console.log("1min import error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/oauth/1min/import
 * Instructions for importing 1min.ai credentials.
 */
export async function GET() {
  return NextResponse.json({
    provider: "1min",
    method: "import",
    instructions:
      "Log in at app.1min.ai/code-generator, open DevTools → Network, find any request to api.1min.ai/teams/... and copy the x-auth-token value (JWT), the team ID from the URL path, and optionally your cookies.",
    requiredFields: [
      {
        name: "jwt",
        label: "JWT Token",
        description: "x-auth-token Bearer value from DevTools (starts with eyJ...)",
        type: "textarea",
      },
      {
        name: "teamId",
        label: "Team ID",
        description: "UUID in the API URL path: api.1min.ai/teams/{teamId}/...",
        type: "text",
      },
      {
        name: "cookies",
        label: "Cookies",
        description: "Full Cookie header (optional — for Cloudflare bypass)",
        type: "textarea",
      },
    ],
  });
}
