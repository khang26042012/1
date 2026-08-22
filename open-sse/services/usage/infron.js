// Infron AI usage handler for Quota Tracker.
//
// Uses the balance endpoint with the same API key used for chat:
//   GET https://api.onerouter.pro/v1/balance
//   Authorization: Bearer <api key>
//
// Response:
//   { account_name: "support@onerouter.pro", credit_balance: 877.88 }
//
// The credit_balance is a dollar-denominated prepaid balance. We display it
// as a single quota row with no cap (it's a wallet, not a rate-limited plan).

import { proxyAwareFetch } from "../../utils/proxyFetch.js";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const BALANCE_URL = "https://api.onerouter.pro/v1/balance";

export async function getInfronUsage(credentials, proxyOptions = null) {
  const token = credentials?.apiKey || credentials?.accessToken;
  if (!token) return null;

  let res;
  try {
    res = await proxyAwareFetch(
      BALANCE_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
      },
      proxyOptions,
    );
  } catch {
    return { quotas: {}, plan: null, message: "Failed to reach Infron balance API." };
  }

  if (!res?.ok) {
    return {
      quotas: {},
      plan: null,
      message: `Infron balance request failed (${res?.status || "no response"})`,
    };
  }

  const data = await res.json().catch(() => null);
  if (!data || data.credit_balance === undefined) {
    return { quotas: {}, plan: null, message: "Infron returned no balance data." };
  }

  const balance = Number(data.credit_balance) || 0;
  const accountName = data.account_name || "";

  return {
    quotas: {
      Credits: {
        used: 0,           // Prepaid wallet — no "used" concept without a starting balance
        total: balance,    // Current remaining balance IS the total
        remaining: balance,
        remainingPercentage: null, // null → bar shows as unlimited/wallet style
        resetAt: null,
      },
    },
    plan: accountName || null, // Show account email as plan label
  };
}
