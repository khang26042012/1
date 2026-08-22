// Rename provider connections from the legacy `qwen-cloud-token-plan` id to the
// merged `qwen-cloud` id. The two providers were consolidated into one (with the
// DashScope international endpoint serving both model catalogs). Without this
// migration, existing token-plan connections would point at a removed provider
// id and silently fall back to the generic OpenAI defaults.
//
// Idempotent: the WHERE clause means re-runs are a no-op once renamed.
export default {
  version: 2,
  name: "rename-qwen-token-plan",
  up(db) {
    db.exec(
      `UPDATE providerConnections SET provider = 'qwen-cloud' WHERE provider = 'qwen-cloud-token-plan';`,
    );
  },
};
