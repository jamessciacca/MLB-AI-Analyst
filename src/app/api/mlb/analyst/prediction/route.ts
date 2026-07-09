import { NextResponse } from "next/server";
import { z } from "zod";

import { buildAnalystPrediction } from "@/lib/analyst/engine";
import { resolvePlayerForAnalystRequest } from "@/lib/analyst/mlb-data-service";

export const runtime = "nodejs";

const requestSchema = z.object({
  playerId: z.coerce.number().int().positive().optional(),
  playerName: z.string().trim().min(2).optional(),
  gameId: z.coerce.number().int().positive().optional(),
  gamePk: z.coerce.number().int().positive().optional(),
  market: z.enum(["hit", "hit_2_plus", "home_run", "total_bases", "rbi", "runs"]).default("hit"),
  sportsbookOdds: z.coerce.number().optional(),
});

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const query = requestSchema.parse({
      playerId: params.get("playerId") ?? undefined,
      playerName: params.get("playerName") ?? undefined,
      gameId: params.get("gameId") ?? undefined,
      gamePk: params.get("gamePk") ?? undefined,
      market: params.get("market") ?? undefined,
      sportsbookOdds: params.get("sportsbookOdds") ?? undefined,
    });
    const gamePk = query.gamePk ?? query.gameId;

    if (!gamePk) {
      return NextResponse.json(
        { error: "gameId or gamePk is required." },
        { status: 400 },
      );
    }

    const { player, warnings } = await resolvePlayerForAnalystRequest({
      playerId: query.playerId ?? null,
      playerName: query.playerName ?? null,
    });

    if (!player) {
      return NextResponse.json(
        { error: warnings[0] ?? "Player not found." },
        { status: 404 },
      );
    }

    const prediction = await buildAnalystPrediction({
      playerId: player.id,
      gamePk,
      market: query.market,
      sportsbookOdds: query.sportsbookOdds ?? null,
    });

    return NextResponse.json({
      ...prediction,
      requestResolution: {
        matchedPlayerId: player.id,
        matchedPlayerName: player.fullName,
        warnings,
      },
    });
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues[0]?.message ?? "Invalid analyst prediction request."
        : error instanceof Error
          ? error.message
          : "Unable to build analyst prediction.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
