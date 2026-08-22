import { NextResponse } from "next/server";
import { getComboById, updateCombo, deleteCombo, getComboByName } from "@/lib/localDb";
import { resetComboRotation } from "open-sse/services/combo.js";
import { validateComboDefinition } from "open-sse/services/comboConfig.js";
import { validateComboRoles } from "open-sse/services/providerCapabilities.js";

// Validate advertised context length: positive integer, null/unlimited allowed,
// upper bound 2M tokens (no combo member exceeds it in practice; values above
// the largest member capacity are allowed but the UI shows a warning badge —
// the value is only an advertisement via /v1/models, real capacity depends on
// the underlying models).
const MAX_CONTEXT_LENGTH = 2_000_000;

export function validateContextLength(value) {
  if (value === null || value === undefined) return { ok: true, value: null };
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, error: "context_length must be a positive integer" };
  }
  if (n > MAX_CONTEXT_LENGTH) {
    return { ok: false, error: `context_length must not exceed ${MAX_CONTEXT_LENGTH}` };
  }
  return { ok: true, value: n };
}

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const combo = await getComboById(id);
    return combo ? NextResponse.json(combo) : NextResponse.json({ error: "Combo not found" }, { status: 404 });
  } catch (error) {
    console.error("Error fetching combo:", error);
    return NextResponse.json({ error: "Failed to fetch combo" }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const prev = await getComboById(id);
    if (!prev) return NextResponse.json({ error: "Combo not found" }, { status: 404 });

    const candidate = {
      name: body.name !== undefined ? (typeof body.name === "string" ? body.name.trim() : body.name) : prev.name,
      models: body.models !== undefined ? (Array.isArray(body.models) ? body.models.map((m) => typeof m === "string" ? m.trim() : m) : body.models) : prev.models,
      kind: body.kind !== undefined ? body.kind : prev.kind,
      strategyConfig: body.strategyConfig !== undefined ? body.strategyConfig : prev.strategyConfig,
      context_length: body.context_length !== undefined ? body.context_length : prev.context_length,
    };
    const validation = validateComboDefinition(candidate);
    if (!validation.valid) return NextResponse.json({ error: validation.errors[0], errors: validation.errors }, { status: 400 });

    // Validate context_length if provided (positive int, within bound)
    const v = validateContextLength(candidate.context_length);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    candidate.context_length = v.value;
    if (!validation.valid) return NextResponse.json({ error: validation.errors[0], errors: validation.errors }, { status: 400 });

    const violations = validateComboRoles(candidate.strategyConfig?.fallbackStrategy || "fallback", candidate.strategyConfig, candidate.models);
    if (violations.length) return NextResponse.json({ error: violations[0].reason, violations }, { status: 400 });

    const duplicate = await getComboByName(candidate.name);
    if (duplicate && duplicate.id !== id) return NextResponse.json({ error: "Combo name already exists" }, { status: 409 });

    const combo = await updateCombo(id, { ...candidate, revision: body.revision });
    if (combo?.conflict) return NextResponse.json({ error: "Combo was changed by another session", code: "revision_conflict" }, { status: 409 });
    if (!combo) return NextResponse.json({ error: "Combo not found" }, { status: 404 });

    resetComboRotation(prev.name);
    if (combo.name !== prev.name) resetComboRotation(combo.name);
    return NextResponse.json(combo);
  } catch (error) {
    console.error("Error updating combo:", error);
    return NextResponse.json({ error: "Failed to update combo" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const prev = await getComboById(id);
    if (!prev || !(await deleteCombo(id))) return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    resetComboRotation(prev.name);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting combo:", error);
    return NextResponse.json({ error: "Failed to delete combo" }, { status: 500 });
  }
}
