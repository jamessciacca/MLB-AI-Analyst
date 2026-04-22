import { NextResponse } from "next/server";
import { z } from "zod";

import { buildGameWinPrediction } from "@/lib/game-win-analyzer";

export const runtime = "nodejs";

const paramsSchema = z.object({
  gamePk: z.coerce.number().int().positive(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ gamePk: string }> },
) {
  try {
    const params = paramsSchema.parse(await context.params);

    return NextResponse.json(await buildGameWinPrediction(params.gamePk));
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues[0]?.message ?? "Invalid game winner request."
        : error instanceof Error
          ? error.message
          : "Unable to build game winner prediction.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
