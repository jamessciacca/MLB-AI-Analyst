import { NextResponse } from "next/server";

import { getGamesByDate, getVenueById } from "@/lib/mlb";
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
          const venue = await getVenueById(game.venue.id, season);
          const weather = await getGameWeather(venue, game.gameDate);

          return {
            ...game,
            weather,
          };
        } catch {
          return {
            ...game,
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
