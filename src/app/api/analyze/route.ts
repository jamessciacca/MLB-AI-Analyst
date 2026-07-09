import { NextResponse } from "next/server";
import { z } from "zod";

import { buildAnalystPrediction } from "@/lib/analyst/engine";
import { generateAiSummary } from "@/lib/ai";
import { buildAnalysis, buildPreviousModelResult } from "@/lib/analyzer";
import { appendPrediction } from "@/lib/feedback";
import {
  buildManualOddsAnalysis,
  normalizeAmericanOddsInput,
  normalizeSportsbookName,
} from "@/lib/odds-math";
import { runDailyOutcomeAuditIfDue } from "@/lib/outcome-audit";
import { buildPredictionExplanation } from "@/lib/prediction/explanation-builder";

export const runtime = "nodejs";

const requestSchema = z.object({
  playerId: z.coerce.number().int().positive(),
  gamePk: z.coerce.number().int().positive(),
  market: z.enum(["hit", "hit_2_plus", "home_run"]).default("hit"),
  sportsbookOdds: z.coerce.number().optional(),
  manualOdds: z.union([z.string(), z.number()]).optional(),
  sportsbook: z.string().trim().optional(),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const manualOddsResult =
      body.manualOdds !== undefined
        ? normalizeAmericanOddsInput(body.manualOdds)
        : null;

    if (manualOddsResult && !manualOddsResult.ok) {
      return NextResponse.json({ error: manualOddsResult.error }, { status: 400 });
    }

    const resolvedInputSportsbook = normalizeSportsbookName(body.sportsbook ?? undefined);
    const embeddedSportsbook =
      manualOddsResult?.ok ? normalizeSportsbookName(manualOddsResult.value.sportsbook) : null;

    if (
      (resolvedInputSportsbook && resolvedInputSportsbook !== "DraftKings") ||
      (embeddedSportsbook && embeddedSportsbook !== "DraftKings")
    ) {
      return NextResponse.json(
        { error: "Only DraftKings manual odds are supported right now." },
        { status: 400 },
      );
    }

    const normalizedSportsbookOdds =
      manualOddsResult?.ok
        ? manualOddsResult.value.normalizedOdds
        : body.sportsbookOdds ?? null;
    const resolvedSportsbook = manualOddsResult?.ok || body.sportsbook ? "DraftKings" : null;

    await runDailyOutcomeAuditIfDue();
    const analysis = await buildAnalysis(body.playerId, body.gamePk, body.market);
    const [previousModelResult, aiSummary, analystEngine] = await Promise.all([
      buildPreviousModelResult(body.playerId, body.gamePk, body.market),
      generateAiSummary(analysis),
      buildAnalystPrediction({
        playerId: body.playerId,
        gamePk: body.gamePk,
        market: body.market,
        analysis,
        sportsbookOdds: normalizedSportsbookOdds,
        manualOddsInput: manualOddsResult?.ok ? manualOddsResult.value.originalInput : null,
        sportsbook: resolvedSportsbook,
      }),
    ]);
    const manualOdds =
      manualOddsResult?.ok && normalizedSportsbookOdds !== null
        ? buildManualOddsAnalysis({
            modelProbability: analysis.probabilities.atLeastOne,
            originalInput: manualOddsResult.value.originalInput,
            normalizedOdds: normalizedSportsbookOdds,
            sportsbook: resolvedSportsbook,
          })
        : null;
    await appendPrediction(analysis, {
      odds: manualOdds
        ? {
            originalInput: manualOdds.originalInput,
            normalizedOdds: manualOdds.normalizedOdds,
            impliedProbability: manualOdds.impliedProbability,
            sportsbook: manualOdds.sportsbook,
          }
        : null,
    });

    return NextResponse.json({
      ...analysis,
      previousModelResult,
      aiSummary,
      analystEngine,
      explainability: buildPredictionExplanation({
        result: analysis,
        manualOdds,
      }),
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
