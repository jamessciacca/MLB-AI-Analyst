import { NextResponse } from "next/server";
import { z } from "zod";

import { buildLineupComparison } from "@/lib/analyzer";
import { appendPredictions } from "@/lib/feedback";
import { getDraftKingsPlayerOdds } from "@/lib/odds";
import { runDailyOutcomeAuditIfDue } from "@/lib/outcome-audit";

export const runtime = "nodejs";

const requestSchema = z.object({
  gamePk: z.coerce.number().int().positive(),
  market: z.enum(["hit", "home_run"]).default("hit"),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    await runDailyOutcomeAuditIfDue();
    const comparison = await buildLineupComparison(body.gamePk, body.market);
    const topPickOdds = comparison.topPick
      ? await getDraftKingsPlayerOdds(comparison.topPick)
      : null;
    const comparisonWithOdds =
      comparison.topPick && topPickOdds
        ? {
            ...comparison,
            topPick: {
              ...comparison.topPick,
              odds: topPickOdds,
            },
            players: comparison.players.map((player) =>
              player.analysisId === comparison.topPick?.analysisId
                ? {
                    ...player,
                    odds: topPickOdds,
                  }
                : player,
            ),
          }
        : comparison;
    await appendPredictions(comparisonWithOdds.players);

    return NextResponse.json(comparisonWithOdds);
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues[0]?.message ?? "Invalid request."
        : error instanceof Error
          ? error.message
          : "Unable to compare the starting lineup.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
