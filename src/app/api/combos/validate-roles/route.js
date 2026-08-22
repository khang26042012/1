import { NextResponse } from "next/server";
import { validateComboRoles } from "open-sse/services/providerCapabilities.js";

/**
 * POST /api/combos/validate-roles
 *
 * Validate that all control-role models in a combo strategy config meet the
 * capability requirements. Used by the UI to check before saving a strategy.
 *
 * Request body:
 *   { strategy: "swarm"|"fusion", managerModel?, staffModel?, auditModel?, judgeModel?, panel? }
 *
 * `panel` is the combo's model list — used to resolve empty (Auto) role models
 * against panel[0], matching the runtime fallback behavior.
 *
 * Response:
 *   { valid: boolean, violations: [{ role, model, reason }] }
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { strategy, managerModel, staffModel, auditModel, judgeModel, panel } = body;

    if (!strategy || (strategy !== "swarm" && strategy !== "fusion")) {
      return NextResponse.json(
        { error: "strategy must be 'swarm' or 'fusion'" },
        { status: 400 },
      );
    }

    const violations = validateComboRoles(
      strategy,
      { managerModel, staffModel, auditModel, judgeModel },
      Array.isArray(panel) ? panel : [],
    );

    return NextResponse.json({
      valid: violations.length === 0,
      violations,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Validation failed" },
      { status: 500 },
    );
  }
}
