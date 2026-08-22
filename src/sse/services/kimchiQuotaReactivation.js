import * as log from "../utils/logger.js";
import { buildKimchiQuotaReactivatedUpdate } from "open-sse/services/accountFallback.js";

/**
 * Reactivate Kimchi provider connections whose daily quota was exhausted and
 * whose `rateLimitedUntil` has now passed (00:00 UTC reset).
 *
 * Queries all deactivated ("quota_exhausted") kimchi connections and, for each
 * whose cooldown timestamp is in the past, restores it to an active state.
 * Errors per-account are caught and logged so a single failure does not abort
 * the whole sweep.
 *
 * @returns {Promise<number>} count of accounts reactivated this run
 */
export async function reactivateExpiredKimchiAccounts() {
  const { getProviderConnections, updateProviderConnection } = await import("@/lib/localDb.js");

  let connections;
  try {
    connections = await getProviderConnections({ provider: "kimchi", isActive: false });
  } catch (e) {
    log.warn("AUTH", `Kimchi quota reactivation: failed to query connections: ${e.message}`);
    return 0;
  }

  if (!connections || connections.length === 0) return 0;

  const now = Date.now();
  let reactivated = 0;

  for (const conn of connections) {
    // Only reactivate accounts previously marked as quota-exhausted.
    if (conn.testStatus !== "quota_exhausted") continue;

    // No cooldown timestamp → nothing to compare against; skip defensively.
    if (!conn.rateLimitedUntil) continue;

    const untilMs = new Date(conn.rateLimitedUntil).getTime();
    // Cooldown not yet expired — wait for the reset (00:00 UTC).
    if (Number.isNaN(untilMs) || untilMs > now) continue;

    try {
      await updateProviderConnection(conn.id, buildKimchiQuotaReactivatedUpdate());
      reactivated++;
      log.info("AUTH", `Kimchi quota reactivated: ${conn.name || conn.id} (cooldown expired ${conn.rateLimitedUntil})`);
    } catch (e) {
      log.warn("AUTH", `Kimchi quota reactivation failed for ${conn.name || conn.id}: ${e.message}`);
    }
  }

  if (reactivated > 0) {
    log.info("AUTH", `Kimchi quota reactivation: ${reactivated} account(s) reactivated`);
  }
  return reactivated;
}
