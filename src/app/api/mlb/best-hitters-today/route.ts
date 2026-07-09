import { NextResponse } from "next/server";

import { buildBestHittersBoard } from "@/lib/analyst/hit-board-service";

export const runtime = "nodejs";

export async function GET() {
  try {
    const board = await buildBestHittersBoard();
    return NextResponse.json(board);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to build today's best hitters board.",
      },
      { status: 400 },
    );
  }
}
