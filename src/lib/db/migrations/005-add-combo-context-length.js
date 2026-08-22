// Migration 005: add context_length column to combos.
// Idempotent — safe to re-run on databases that already have the column
// (e.g. via schema auto-sync).
export default {
  version: 5,
  name: "add-combo-context-length",
  up(db) {
    const cols = (db.all("PRAGMA table_info(combos)") || []).map((c) => c.name);
    if (!cols.includes("context_length")) {
      db.exec("ALTER TABLE combos ADD COLUMN context_length INTEGER DEFAULT NULL");
    }
  },
};
