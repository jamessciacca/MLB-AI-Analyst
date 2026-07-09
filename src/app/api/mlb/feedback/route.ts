import { NextResponse } from "next/server";
import { z } from "zod";

import { appendMlbAnalystFeedback } from "@/lib/analyst/feedback-service";
import { getFeedbackCalibrationSummary } from "@/lib/feedback";

export const runtime = "nodejs";

const requestSchema = z.object({
  analysisId: z.string().trim().optional(),
  playerId: z.coerce.number().int().positive(),
  playerName: z.string().trim().min(2),
  gamePk: z.coerce.number().int().positive(),
  market: z.enum(["hit", "hit_2_plus", "home_run"]).default("hit"),
  probability: z.coerce.number().min(0).max(1),
  actualResult: z.coerce.boolean(),
  team: z.string().trim().optional(),
  opponent: z.string().trim().optional(),
  featuresUsed: z.array(z.string().trim().min(1)).optional(),
  notes: z.string().trim().optional(),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const saved = await appendMlbAnalystFeedback({
      analysisId: body.analysisId ?? null,
      playerId: body.playerId,
      playerName: body.playerName,
      gamePk: body.gamePk,
      market: body.market,
      probability: body.probability,
      actualResult: body.actualResult,
      team: body.team ?? null,
      opponent: body.opponent ?? null,
      featuresUsed: body.featuresUsed ?? [],
      notes: body.notes ?? null,
    });
    const calibration = await getFeedbackCalibrationSummary();

    return NextResponse.json({
      saved,
      calibration,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? error.issues[0]?.message ?? "Invalid MLB feedback payload."
            : error instanceof Error
              ? error.message
              : "Unable to save MLB feedback.",
      },
      { status: 400 },
    );
  }
}
