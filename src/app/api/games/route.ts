import { NextResponse } from "next/server";

import { getGamesByDate } from "@/lib/mlb";
import { todayIsoDate } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date")?.trim() || todayIsoDate();

  try {
    const games = await getGamesByDate(date);
    return NextResponse.json({ games });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load games.",
      },
      { status: 500 },
    );
  }
}
