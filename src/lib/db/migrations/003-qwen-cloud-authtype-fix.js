// Normalize authType for all qwen-cloud connections to 'apikey'.
//
// The registry now definitively declares `authType: "apikey"` for qwen-cloud,
// but connections created in older versions (before the v0.7.7 merge) may have
// `authType: "cookie"` stored in the DB column — from a time when the provider
// auth resolution was ambiguous. This caused the UI to show "Cookie Value"
// input and a cookie icon instead of "API Key".
//
// This is a separate migration (not folded into 002) because migration 002
// already ran on existing DBs. The version-gated runner (migrate.js:63) skips
// migrations whose version <= the stored schemaVersion, so editing 002 in-place
// would never re-execute on already-migrated databases.
//
// Idempotent: the WHERE clause means re-runs are a no-op.
export default {
  version: 3,
  name: "qwen-cloud-authtype-fix",
  up(db) {
    db.exec(
      `UPDATE providerConnections SET authType = 'apikey' WHERE provider = 'qwen-cloud' AND authType != 'apikey';`,
    );
  },
};
