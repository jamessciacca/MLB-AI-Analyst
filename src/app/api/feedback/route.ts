import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const requestSchema = z.object({
  analysisId: z.string().min(1),
  playerId: z.coerce.number().int().positive(),
  gamePk: z.coerce.number().int().positive(),
  market: z.enum(["hit", "home_run"]),
  probability: z.coerce.number().min(0).max(1),
  recommendation: z.enum(["good play", "neutral", "avoid"]),
  rating: z.enum(["correct", "too_high", "too_low"]),
  notes: z.string().max(400).optional().default(""),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const dataDirectory = path.join(process.cwd(), "data");
    const target = path.join(dataDirectory, "feedback.ndjson");

    await mkdir(dataDirectory, { recursive: true });
    await appendFile(
      target,
      `${JSON.stringify({
        ...body,
        savedAt: new Date().toISOString(),
      })}\n`,
      "utf8",
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to save feedback.",
      },
      { status: 400 },
    );
  }
}
