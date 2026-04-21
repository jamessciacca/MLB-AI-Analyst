import { NextResponse } from "next/server";

import { searchBatters } from "@/lib/mlb";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";

  if (query.length < 2) {
    return NextResponse.json({ players: [] });
  }

  try {
    const players = await searchBatters(query);
    return NextResponse.json({ players });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to search current batters.",
      },
      { status: 500 },
    );
  }
}
