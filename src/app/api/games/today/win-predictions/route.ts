import { NextResponse } from "next/server";

import { buildGameWinPrediction } from "@/lib/game-win-analyzer";
import { getGamesByDate } from "@/lib/mlb";
import { todayIsoDate } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date")?.trim() || todayIsoDate();

  try {
    const games = await getGamesByDate(date);
    const predictions = await Promise.allSettled(
      games.map((game) => buildGameWinPrediction(game.gamePk)),
    );

    return NextResponse.json({
      date,
      predictions: predictions.map((result, index) => {
        if (result.status === "fulfilled") {
          return result.value;
        }

        return {
          gamePk: games[index]?.gamePk ?? null,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : "Unable to build game winner prediction.",
        };
      }),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load today's game winner predictions.",
      },
      { status: 500 },
    );
  }
}
