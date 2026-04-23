import { NextResponse } from "next/server";
import { z } from "zod";

import { runChatTurn } from "@/agent/chatAgent";

export const runtime = "nodejs";

const requestSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const result = await runChatTurn(body.message, body.sessionId);

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues[0]?.message ?? "Invalid chat request."
        : error instanceof Error
          ? error.message
          : "Unable to run chat.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
