import { NextResponse } from "next/server";
import { getCombos, createCombo, getComboByName } from "@/lib/localDb";
import { validateComboDefinition } from "open-sse/services/comboConfig.js";
import { validateComboRoles } from "open-sse/services/providerCapabilities.js";
import { validateContextLength } from "./[id]/route.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ combos: await getCombos() });
  } catch (error) {
    console.error("Error fetching combos:", error);
    return NextResponse.json({ error: "Failed to fetch combos" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { name, models, kind, context_length } = body;

    // Validate context_length if provided (positive int, within bound)
    let contextLength = null;
    if ("context_length" in body && body.context_length !== undefined && body.context_length !== null) {
      const v = validateContextLength(body.context_length);
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
      contextLength = v.value;
    }

    const candidate = {
      name: typeof name === "string" ? name.trim() : name,
      models: Array.isArray(models) ? models.map((m) => typeof m === "string" ? m.trim() : m) : models,
      kind: kind || "llm",
      strategyConfig: body.strategyConfig || {},
      context_length: contextLength,
    };
    const validation = validateComboDefinition(candidate);
    if (!validation.valid) return NextResponse.json({ error: validation.errors[0], errors: validation.errors }, { status: 400 });

    const strategy = candidate.strategyConfig?.fallbackStrategy || "fallback";
    const violations = validateComboRoles(strategy, candidate.strategyConfig, candidate.models);
    if (violations.length) return NextResponse.json({ error: violations[0].reason, violations }, { status: 400 });

    if (await getComboByName(candidate.name)) return NextResponse.json({ error: "Combo name already exists" }, { status: 409 });
    return NextResponse.json(await createCombo(candidate), { status: 201 });
  } catch (error) {
    console.error("Error creating combo:", error);
    return NextResponse.json({ error: "Failed to create combo" }, { status: 500 });
  }
}
