import { NextResponse } from "next/server";
import { z } from "zod";

import { getPlayerPredictionHistory } from "@/lib/feedback";

export const runtime = "nodejs";

const paramsSchema = z.object({
  playerId: z.coerce.number().int().positive(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ playerId: string }> },
) {
  try {
    const params = paramsSchema.parse(await context.params);
    const history = await getPlayerPredictionHistory(params.playerId);

    return NextResponse.json({ history });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to load player history.",
      },
      { status: 400 },
    );
  }
}
