import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";

// GET /api/providers/[id]/onemin-api-profile
//
// Fetches the 1min.ai account profile via the API key (custom `API-KEY` header).
// Calls GET /api/profile which returns { id, email, plan, credits, ... }.
// Used to display account/credit info in the provider detail page.
export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const apiKey = (connection.apiKey || "").replace(/^Bearer\s+/i, "").trim();

    const res = await fetch("https://api.1min.ai/api/profile", {
      method: "GET",
      headers: {
        "API-KEY": apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ error: "API key is invalid or revoked" }, { status: 401 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: `1min.ai API returned ${res.status}` }, { status: res.status });
    }

    const data = await res.json();

    return NextResponse.json({
      name: "1min.ai",
      email: data.email || data.user?.email || "",
      plan: data.plan || data.subscription || "",
      credits: data.credits ?? data.credit_balance ?? data.balance ?? 0,
      apiKeyId: data.id || data.userId || "",
    });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Failed to fetch profile" }, { status: 500 });
  }
}
