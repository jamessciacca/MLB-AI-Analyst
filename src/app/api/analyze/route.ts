import { NextResponse } from "next/server";
import { z } from "zod";

import { generateAiSummary } from "@/lib/ai";
import { buildAnalysis, buildPreviousModelResult } from "@/lib/analyzer";
import { appendPrediction } from "@/lib/feedback";
import { runDailyOutcomeAuditIfDue } from "@/lib/outcome-audit";

export const runtime = "nodejs";

const requestSchema = z.object({
  playerId: z.coerce.number().int().positive(),
  gamePk: z.coerce.number().int().positive(),
  market: z.enum(["hit", "home_run"]).default("hit"),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    await runDailyOutcomeAuditIfDue();
    const analysis = await buildAnalysis(body.playerId, body.gamePk, body.market);
    const [previousModelResult, aiSummary] = await Promise.all([
      buildPreviousModelResult(body.playerId, body.gamePk, body.market),
      generateAiSummary(analysis),
    ]);
    await appendPrediction(analysis);

    return NextResponse.json({
      ...analysis,
      previousModelResult,
      aiSummary,
    });
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues[0]?.message ?? "Invalid request."
        : error instanceof Error
          ? error.message
          : "Unable to build analysis.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
