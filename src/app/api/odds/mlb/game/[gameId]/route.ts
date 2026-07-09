import { NextResponse } from "next/server";
import { z } from "zod";

import { getGameByPk } from "@/lib/mlb";
import { getPlayerOddsForGame } from "@/lib/vegas-odds-service";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ gameId: string }> },
) {
  try {
    const { gameId } = await context.params;
    const parsedGameId = z.coerce.number().int().positive().parse(gameId);
    const game = await getGameByPk(parsedGameId);

    if (!game) {
      return NextResponse.json({ error: "Game not found." }, { status: 404 });
    }

    const result = await getPlayerOddsForGame(game);

    return NextResponse.json({
      game,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? error.issues[0]?.message ?? "Invalid game odds request."
            : error instanceof Error
              ? error.message
              : "Unable to load MLB game odds.",
      },
      { status: 400 },
    );
  }
}
