import { NextResponse } from "next/server";
import { z } from "zod";

import { getGameByPk } from "@/lib/mlb";
import { findPlayerPropOdds, getPlayerOddsForGame } from "@/lib/vegas-odds-service";

export const runtime = "nodejs";

const requestSchema = z.object({
  playerName: z.string().trim().min(2),
  gameId: z.coerce.number().int().positive().optional(),
  gamePk: z.coerce.number().int().positive().optional(),
  market: z.enum(["batter_hits", "batter_home_runs"]).optional(),
});

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const query = requestSchema.parse({
      playerName: params.get("playerName") ?? undefined,
      gameId: params.get("gameId") ?? undefined,
      gamePk: params.get("gamePk") ?? undefined,
      market: params.get("market") ?? undefined,
    });
    const gamePk = query.gamePk ?? query.gameId;

    if (!gamePk) {
      return NextResponse.json(
        { error: "gameId or gamePk is required." },
        { status: 400 },
      );
    }

    const game = await getGameByPk(gamePk);

    if (!game) {
      return NextResponse.json({ error: "Game not found." }, { status: 404 });
    }

    const market = query.market ?? "batter_hits";
    const result = await getPlayerOddsForGame(game);
    const odds = findPlayerPropOdds(
      market === "batter_hits" ? result.batterHits : result.batterHomeRuns,
      query.playerName,
      market,
    );
    const warnings = [
      ...result.warnings,
      odds
        ? null
        : market === "batter_hits"
          ? "No hit odds available yet"
          : "No home run odds available yet",
    ].filter((value): value is string => Boolean(value));

    return NextResponse.json({
      game,
      playerName: query.playerName,
      market,
      eventId: result.eventId,
      matched: result.matched,
      moneyline: result.moneyline,
      odds,
      available: Boolean(odds),
      warnings: [...new Set(warnings)],
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? error.issues[0]?.message ?? "Invalid player odds request."
            : error instanceof Error
              ? error.message
              : "Unable to load MLB player odds.",
      },
      { status: 400 },
    );
  }
}
