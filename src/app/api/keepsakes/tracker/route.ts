import { NextResponse } from "next/server";
import { z } from "zod";

import { listKeepsakeBets, saveKeepsakeBet } from "@/lib/keepsake-bets";

export const runtime = "nodejs";

const createBetSchema = z.object({
  stakeAmount: z
    .number()
    .finite()
    .min(0, "Bet amount must be 0 or greater."),
  wonAmount: z
    .number()
    .finite()
    .min(0, "Money won must be 0 or greater."),
  note: z
    .string()
    .max(120, "Note must be 120 characters or fewer.")
    .optional()
    .or(z.literal("")),
  betDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Bet date must use YYYY-MM-DD format."),
});

export async function GET() {
  try {
    const tracker = await listKeepsakeBets();

    return NextResponse.json({
      localOnly: true,
      ...tracker,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load bet tracker.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const payload = createBetSchema.parse(await request.json());
    const tracker = await saveKeepsakeBet(payload);

    return NextResponse.json({
      localOnly: true,
      ...tracker,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to save tracker entry.",
      },
      { status: 400 },
    );
  }
}
