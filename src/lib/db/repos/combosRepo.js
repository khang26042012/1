import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { normalizeComboStrategyConfig } from "open-sse/services/comboConfig.js";

function rowToCombo(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models: parseJson(row.models, []),
    strategyConfig: normalizeComboStrategyConfig(parseJson(row.strategyConfig, {})),
    context_length: row.context_length === null || row.context_length === undefined ? null : Number(row.context_length),
    revision: Number(row.revision) || 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getCombos() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM combos ORDER BY createdAt ASC`).map(rowToCombo);
}

export async function getComboById(id) {
  const db = await getAdapter();
  return rowToCombo(db.get(`SELECT * FROM combos WHERE id = ?`, [id]));
}

export async function getComboByName(name) {
  const db = await getAdapter();
  return rowToCombo(db.get(`SELECT * FROM combos WHERE name = ?`, [name]));
}

export async function createCombo(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    models: data.models || [],
    strategyConfig: normalizeComboStrategyConfig(data.strategyConfig),
    context_length: data.context_length === undefined ? null : data.context_length,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO combos(id, name, kind, models, strategyConfig, context_length, revision, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), stringifyJson(combo.strategyConfig), combo.context_length, combo.revision, now, now],
  );
  return combo;
}

export async function updateCombo(id, data) {
  const db = await getAdapter();
  let result = null;
  let conflict = false;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    const current = rowToCombo(row);
    if (data.revision !== undefined && Number(data.revision) !== current.revision) {
      conflict = true;
      return;
    }
    const merged = {
      ...current,
      name: data.name !== undefined ? data.name : current.name,
      kind: data.kind !== undefined ? data.kind : current.kind,
      models: data.models !== undefined ? data.models : current.models,
      strategyConfig: data.strategyConfig !== undefined ? normalizeComboStrategyConfig(data.strategyConfig) : current.strategyConfig,
      context_length: data.context_length !== undefined ? data.context_length : current.context_length,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, strategyConfig = ?, context_length = ?, revision = ?, updatedAt = ? WHERE id = ? AND revision = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models), stringifyJson(merged.strategyConfig), merged.context_length, merged.revision, merged.updatedAt, id, current.revision],
    );
    result = merged;
  });
  if (conflict) return { conflict: true };
  return result;
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  return (db.run(`DELETE FROM combos WHERE id = ?`, [id])?.changes ?? 0) > 0;
}
