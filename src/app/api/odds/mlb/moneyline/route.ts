import { NextResponse } from "next/server";
import { z } from "zod";

import { getGamesByDate } from "@/lib/mlb";
import { getMlbMoneylineOdds } from "@/lib/vegas-odds-service";
import { todayIsoDate } from "@/lib/utils";

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
    const officialDate = query.date ?? todayIsoDate();
    const games = await getGamesByDate(officialDate).catch(() => []);
    const result = await getMlbMoneylineOdds({
      officialDate,
      games,
    });

    return NextResponse.json({
      officialDate,
      gameCount: games.length,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? error.issues[0]?.message ?? "Invalid moneyline request."
            : error instanceof Error
              ? error.message
              : "Unable to load MLB moneyline odds.",
      },
      { status: 400 },
    );
  }
}
