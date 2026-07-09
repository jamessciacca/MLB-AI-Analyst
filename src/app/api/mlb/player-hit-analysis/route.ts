import { NextResponse } from "next/server";
import { z } from "zod";

import { buildPlayerHitAnalysis } from "@/lib/analyst/hit-board-service";
import { normalizeAmericanOddsInput, normalizeSportsbookName } from "@/lib/odds-math";

export const runtime = "nodejs";

const requestSchema = z.object({
  playerId: z.coerce.number().int().positive().optional(),
  playerName: z.string().trim().min(2).optional(),
  gameId: z.coerce.number().int().positive().optional(),
  gamePk: z.coerce.number().int().positive().optional(),
  date: z.string().trim().optional(),
  market: z.enum(["hit", "hit_2_plus", "home_run"]).default("hit"),
  manualOdds: z.union([z.string(), z.number()]).optional(),
  sportsbook: z.string().trim().optional(),
});

function resolveManualOdds(
  input: string | number | undefined,
  sportsbook: string | undefined,
) {
  if (input === undefined) {
    return {
      normalizedOdds: null,
      originalInput: null,
      sportsbook: sportsbook?.trim() || null,
      error: null,
    };
  }

  const parsed = normalizeAmericanOddsInput(input);

  if (!parsed.ok) {
    return {
      normalizedOdds: null,
      originalInput: null,
      sportsbook: sportsbook?.trim() || null,
      error: parsed.error,
    };
  }

  const resolvedInputSportsbook = normalizeSportsbookName(sportsbook);
  const embeddedSportsbook = normalizeSportsbookName(parsed.value.sportsbook);

  if (
    (resolvedInputSportsbook && resolvedInputSportsbook !== "DraftKings") ||
    (embeddedSportsbook && embeddedSportsbook !== "DraftKings")
  ) {
    return {
      normalizedOdds: null,
      originalInput: null,
      sportsbook: null,
      error: "Only DraftKings manual odds are supported right now.",
    };
  }

  return {
    normalizedOdds: parsed.value.normalizedOdds,
    originalInput: parsed.value.originalInput,
    sportsbook: "DraftKings",
    error: null,
  };
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const query = requestSchema.parse({
      playerId: params.get("playerId") ?? undefined,
      playerName: params.get("playerName") ?? undefined,
      gameId: params.get("gameId") ?? undefined,
      gamePk: params.get("gamePk") ?? undefined,
      date: params.get("date") ?? undefined,
      market: params.get("market") ?? undefined,
      manualOdds: params.get("manualOdds") ?? undefined,
      sportsbook: params.get("sportsbook") ?? undefined,
    });
    const manualOdds = resolveManualOdds(query.manualOdds, query.sportsbook);

    if (!query.playerId && !query.playerName) {
      return NextResponse.json(
        { error: "playerId or playerName is required." },
        { status: 400 },
      );
    }

    if (manualOdds.error) {
      return NextResponse.json({ error: manualOdds.error }, { status: 400 });
    }

    const result = await buildPlayerHitAnalysis({
      playerId: query.playerId ?? null,
      playerName: query.playerName ?? null,
      gamePk: query.gamePk ?? query.gameId ?? null,
      officialDate: query.date ?? null,
      market: query.market,
      sportsbookOdds: manualOdds.normalizedOdds,
      manualOddsInput: manualOdds.originalInput,
      sportsbook: manualOdds.sportsbook,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? error.issues[0]?.message ?? "Invalid player hit analysis request."
            : error instanceof Error
              ? error.message
              : "Unable to build player hit analysis.",
      },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const manualOdds = resolveManualOdds(body.manualOdds, body.sportsbook);

    if (!body.playerId && !body.playerName) {
      return NextResponse.json(
        { error: "playerId or playerName is required." },
        { status: 400 },
      );
    }

    if (manualOdds.error) {
      return NextResponse.json({ error: manualOdds.error }, { status: 400 });
    }

    const result = await buildPlayerHitAnalysis({
      playerId: body.playerId ?? null,
      playerName: body.playerName ?? null,
      gamePk: body.gamePk ?? body.gameId ?? null,
      officialDate: body.date ?? null,
      market: body.market,
      sportsbookOdds: manualOdds.normalizedOdds,
      manualOddsInput: manualOdds.originalInput,
      sportsbook: manualOdds.sportsbook,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? error.issues[0]?.message ?? "Invalid player hit analysis request."
            : error instanceof Error
              ? error.message
              : "Unable to build player hit analysis.",
      },
      { status: 400 },
    );
  }
}
