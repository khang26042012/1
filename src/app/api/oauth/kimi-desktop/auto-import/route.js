import { NextResponse } from "next/server";
import {
  readKimiDesktopStore,
  getAccountLabel,
  getTokenStoreCandidates,
  KimiDesktopService,
} from "@/lib/oauth/services/kimi-desktop";

/**
 * GET /api/oauth/kimi-desktop/auto-import
 * Auto-detect and read the Kimi desktop app's token store (bridge-store JSON).
 * Returns the access_token JWT so the modal can prefill before import.
 */
export async function GET() {
  try {
    const store = await readKimiDesktopStore();
    if (!store) {
      return NextResponse.json({
        found: false,
        windowsManual: process.platform === "win32",
        error:
          "Kimi desktop token store not found. Checked locations:\n" +
          (KIMI_DESKTOP_CONFIG.tokenStoragePaths || []).length
            ? Object.values(KIMI_DESKTOP_CONFIG.tokenStoragePaths).join("\n")
            : getTokenStoreCandidates().join("\n"),
      });
    }

    const check = KimiDesktopService.validateStore(store);
    if (!check.valid) {
      return NextResponse.json({
        found: false,
        error: check.error,
      });
    }

    const accessToken = store.tokens.access_token;
    const label = getAccountLabel(store);
    const exp = check.claims?.exp ? new Date(check.claims.exp * 1000).toISOString() : null;

    // NOTE: returning the raw token to the browser is intentional — the modal
    // prefills to let the user review before import (import route persists).
    return NextResponse.json({
      found: true,
      accessToken,
      label,
      exp,
      source: "kimi-desktop token store",
    });
  } catch (error) {
    console.log("Kimi desktop auto-import error:", error);
    return NextResponse.json({ found: false, error: error.message }, { status: 500 });
  }
}