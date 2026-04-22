import { NextResponse } from "next/server";

import { getGameLineupStatus, getGamesByDate, getVenueById } from "@/lib/mlb";
import { todayIsoDate } from "@/lib/utils";
import { getGameWeather } from "@/lib/weather";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date")?.trim() || todayIsoDate();

  try {
    const season = new Date(`${date}T12:00:00`).getFullYear();
    const games = await getGamesByDate(date);
    const gamesWithWeather = await Promise.all(
      games.map(async (game) => {
        try {
          const [venue, lineupStatus] = await Promise.all([
            getVenueById(game.venue.id, season),
            getGameLineupStatus(game.gamePk),
          ]);
          const weather = await getGameWeather(venue, game.gameDate);

          return {
            ...game,
            lineupStatus,
            weather,
          };
        } catch {
          return {
            ...game,
            lineupStatus: {
              status: "pending",
              homeCount: 0,
              awayCount: 0,
              totalCount: 0,
              homePlayers: [],
              awayPlayers: [],
            },
            weather: null,
          };
        }
      }),
    );
    return NextResponse.json({ games: gamesWithWeather });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load games.",
      },
      { status: 500 },
    );
  }
}
