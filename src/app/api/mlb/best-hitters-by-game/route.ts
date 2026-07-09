import { NextResponse } from "next/server";
import { z } from "zod";

import { buildBestHittersBoard } from "@/lib/analyst/hit-board-service";

export const runtime = "nodejs";

const requestSchema = z.object({
  date: z.string().trim().optional(),
});

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const query = requestSchema.parse({
      date: params.get("date") ?? undefined,
    });

    const board = await buildBestHittersBoard({
      officialDate: query.date ?? null,
    });

    return NextResponse.json(board);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? error.issues[0]?.message ?? "Invalid best hitters request."
            : error instanceof Error
              ? error.message
              : "Unable to build best hitters board.",
      },
      { status: 400 },
    );
  }
}
