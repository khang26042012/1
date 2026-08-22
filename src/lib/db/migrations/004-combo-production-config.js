export default {
  version: 4,
  name: "combo-production-config",
  up(db) {
    const columns = new Set(db.all("PRAGMA table_info(combos)").map((row) => row.name));
    if (!columns.has("strategyConfig")) db.exec("ALTER TABLE combos ADD COLUMN strategyConfig TEXT NOT NULL DEFAULT '{}'");
    if (!columns.has("revision")) db.exec("ALTER TABLE combos ADD COLUMN revision INTEGER NOT NULL DEFAULT 1");
  },
};
