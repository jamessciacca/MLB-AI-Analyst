import { NextResponse } from "next/server";
import { z } from "zod";

import { buildGameHitBoard } from "@/lib/analyst/hit-board-service";

export const runtime = "nodejs";

const requestSchema = z.object({
  gameId: z.coerce.number().int().positive().optional(),
  gamePk: z.coerce.number().int().positive().optional(),
});

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const query = requestSchema.parse({
      gameId: params.get("gameId") ?? undefined,
      gamePk: params.get("gamePk") ?? undefined,
    });
    const gamePk = query.gamePk ?? query.gameId;

    if (!gamePk) {
      return NextResponse.json(
        { error: "gameId or gamePk is required." },
        { status: 400 },
      );
    }

    return NextResponse.json(await buildGameHitBoard({ gamePk }));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? error.issues[0]?.message ?? "Invalid game hit board request."
            : error instanceof Error
              ? error.message
              : "Unable to build game hit board.",
      },
      { status: 400 },
    );
  }
}
