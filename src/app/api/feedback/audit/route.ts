import { NextResponse } from "next/server";

import { auditSavedPredictionOutcomes } from "@/lib/outcome-audit";

export const runtime = "nodejs";

export async function POST() {
  try {
    return NextResponse.json(await auditSavedPredictionOutcomes());
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to audit prediction outcomes.",
      },
      { status: 500 },
    );
  }
}
