/**
 * Endpoint default-key provisioning (Option A): when API-key auth is first
 * turned on and no keys exist yet, create a "Default Key" so /v1 keeps working
 * without a manual dashboard step.
 *
 * Deps are injected (no DB import here) so tests never touch the database or
 * the @/ alias resolver — the settings route passes its own repo imports.
 */

/**
 * True only on a lint false→true transition of requireApiKey.
 * @param {boolean} current - previous requireApiKey value
 * @param {boolean} next - new requireApiKey value
 * @returns {boolean}
 */
export function shouldProvisionDefaultKey(current, next) {
  return next === true && current !== true;
}

/**
 * Create the default key iff no API keys exist yet (idempotent).
 *
 * @param {{ getApiKeys: () => Promise<Array>, createApiKey: (name: string, machineId: string, allowedModels: null) => Promise<{ key: string }> }} deps
 * @returns {Promise<{ key?: string, provisioned: boolean }>}
 */
export async function provisionDefaultKey({ getApiKeys, createApiKey }) {
  const existing = await getApiKeys();
  if (existing && existing.length > 0) {
    return { provisioned: false };
  }
  const created = await createApiKey("Default Key", "local", null);
  return { key: created.key, provisioned: true };
}

// ponytail: concurrent false→true transitions can both observe an empty key
// table and create two "Default Key" rows. Guard with a unique name/column
// index if double-key ever shows up in practice.
