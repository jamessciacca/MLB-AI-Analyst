import { NextResponse } from "next/server";

import { deleteKeepsakeBet } from "@/lib/keepsake-bets";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const result = await deleteKeepsakeBet(id);

    if (!result.deleted) {
      return NextResponse.json({ error: "Tracker entry not found." }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      summary: result.summary,
      localOnly: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to delete tracker entry.",
      },
      { status: 500 },
    );
  }
}
