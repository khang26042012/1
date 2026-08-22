import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";

// GET /api/providers/[id]/inxora-profile
//
// Fetches the InxoraStudio Labs user profile (name, email, plan)
// by calling /api/auth/me with the connection's JWT token. Used to display
// profile info in the provider detail page.
//
// Auth: handled by dashboard middleware (same as freebuff-profile).
// The `apiKey` field is NOT returned to the client (security).
export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    let token = (connection.apiKey || "").replace(/^Bearer\s+/i, "").replace(/^cookie:\s*/i, "").trim();

    const res = await fetch("https://labs.inxorastudio.com/api/auth/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
        Referer: "https://labs.inxorastudio.com/dashboard",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ error: "Session expired" }, { status: 401 });
    }

    if (!res.ok) {
      return NextResponse.json({ error: `InxoraStudio returned ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    if (!data?.user) {
      return NextResponse.json({ error: "No user in response" }, { status: 401 });
    }

    const u = data.user;
    return NextResponse.json({
      name: u.name || u.email?.split("@")[0] || "User",
      email: u.email || "",
      plan: u.plan || "FREE",
      isActive: u.isActive !== false,
    });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Failed to fetch profile" }, { status: 500 });
  }
}
