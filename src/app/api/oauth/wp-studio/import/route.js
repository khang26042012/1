import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { createProviderConnection } from "@/models";

const SHARED_CONFIG_PATH = join(homedir(), ".studio", "shared.json");

/**
 * Read the WordPress Studio Code auth token from ~/.studio/shared.json.
 * Studio Code (Electron app) stores the wpcom OAuth token there after login.
 *
 * @returns {Promise<{accessToken:string, expiresAt:number, email:string, displayName:string} | null>}
 */
async function readStudioToken() {
  try {
    const raw = await readFile(SHARED_CONFIG_PATH, "utf8");
    const data = JSON.parse(raw);
    const token = data?.authToken;
    if (!token?.accessToken) return null;
    return {
      accessToken: token.accessToken,
      expiresAt: token.expirationTime || 0,
      expiresIn: token.expiresIn || 1209600,
      email: token.email || "",
      displayName: token.displayName || "",
    };
  } catch {
    return null;
  }
}

/**
 * Validate the WordPress.com OAuth token by calling /me.
 * Returns user info or throws.
 */
async function validateToken(accessToken) {
  const res = await fetch("https://public-api.wordpress.com/rest/v1.1/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`WordPress.com auth failed (${res.status})`);
  }
  return res.json();
}

/**
 * POST /api/oauth/wp-studio/import
 * Import WordPress Studio Code credentials from ~/.studio/shared.json.
 * No request body needed — reads from the local filesystem.
 */
export async function POST() {
  try {
    const tokenData = await readStudioToken();
    if (!tokenData) {
      return NextResponse.json(
        { error: "Studio Code not found or not logged in. Install Studio Code and log in with your WordPress.com account, then retry." },
        { status: 404 },
      );
    }

    // Validate token
    const userInfo = await validateToken(tokenData.accessToken);

    const expiresAt = tokenData.expiresAt
      ? new Date(tokenData.expiresAt).toISOString()
      : new Date(Date.now() + tokenData.expiresIn * 1000).toISOString();

    const connection = await createProviderConnection({
      provider: "wp-studio",
      authType: "oauth",
      accessToken: tokenData.accessToken,
      expiresAt,
      email: userInfo?.email || tokenData.email || null,
      providerSpecificData: {
        wpUserId: userInfo?.ID || null,
        displayName: userInfo?.display_name || tokenData.displayName || "",
        authMethod: "imported",
      },
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
      },
    });
  } catch (error) {
    console.log("WP Studio import error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/oauth/wp-studio/import
 * Check if Studio Code is installed and authenticated.
 */
export async function GET() {
  const tokenData = await readStudioToken();
  if (!tokenData) {
    return NextResponse.json({
      found: false,
      error: "Studio Code credentials not found at ~/.studio/shared.json. Make sure Studio Code is installed and you are logged in.",
      path: SHARED_CONFIG_PATH,
    });
  }
  return NextResponse.json({
    found: true,
    email: tokenData.email,
    displayName: tokenData.displayName,
    expiresAt: tokenData.expiresAt
      ? new Date(tokenData.expiresAt).toISOString()
      : null,
  });
}
