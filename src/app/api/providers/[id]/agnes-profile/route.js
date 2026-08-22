import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";

// GET /api/providers/[id]/agnes-profile
//
// Fetches the Agnes user profile and credit balance.
export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const token = (connection.apiKey || "").replace(/^Bearer\s+/i, "").replace(/^token=\s*/i, "").trim();
    const baseHeaders = {
      Authorization: `Bearer ${token}`,
      "X-Platform": "1",
      "X-App-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      "X-Client-Time-Ms": String(Date.now()),
      "X-User-Language": "en",
    };

    // Fetch profile + credits in parallel.
    const [profileRes, creditsRes] = await Promise.all([
      fetch("https://api.agnes-ai.com/api/v2/user/profile", {
        headers: { ...baseHeaders, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(8000),
      }),
      fetch("https://api.agnes-ai.com/api/v2/subscription/credits-balance", {
        headers: { ...baseHeaders, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(8000),
      }),
    ]);

    if (profileRes.status === 401 || profileRes.status === 403) {
      return NextResponse.json({ error: "Session expired" }, { status: 401 });
    }

    const profileData = profileRes.ok ? await profileRes.json().catch(() => null) : null;
    const creditsData = creditsRes.ok ? await creditsRes.json().catch(() => null) : null;

    const userInfo = profileData?.data?.user_info || {};

    return NextResponse.json({
      name: "Agnes",
      email: userInfo.email || "",
      plan: userInfo.auth_provider || "",
      credits: creditsData?.data?.total_balance ?? creditsData?.data?.time_sensitive_balance ?? 0,
      username: userInfo.username || "",
    });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Failed to fetch profile" }, { status: 500 });
  }
}
