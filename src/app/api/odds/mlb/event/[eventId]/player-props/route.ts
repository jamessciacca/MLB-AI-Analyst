import { NextResponse } from "next/server";
import { z } from "zod";

import { getMlbEventOdds } from "@/lib/vegas-odds-service";

export const runtime = "nodejs";

const requestSchema = z.object({
  markets: z.string().trim().optional(),
});

const SUPPORTED_MARKETS = new Set(["batter_hits", "batter_home_runs"]);

function parseMarkets(raw: string | undefined): Array<"batter_hits" | "batter_home_runs"> {
  const requested = (raw ?? "batter_hits,batter_home_runs")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is "batter_hits" | "batter_home_runs" =>
      SUPPORTED_MARKETS.has(value),
    );

  return requested.length > 0 ? requested : ["batter_hits", "batter_home_runs"];
}

export async function GET(
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) {
  try {
    const { eventId } = await context.params;
    const params = new URL(request.url).searchParams;
    const query = requestSchema.parse({
      markets: params.get("markets") ?? undefined,
    });
    const markets = parseMarkets(query.markets);
    const result = await getMlbEventOdds(eventId, markets);

    return NextResponse.json({
      ...result,
      markets,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? error.issues[0]?.message ?? "Invalid player-props request."
            : error instanceof Error
              ? error.message
              : "Unable to load MLB player props.",
      },
      { status: 400 },
    );
  }
}
