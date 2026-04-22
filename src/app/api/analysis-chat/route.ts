import { NextResponse } from "next/server";
import { z } from "zod";

import { answerAnalysisQuestion } from "@/lib/ai";
import { type AnalysisResult } from "@/lib/types";

export const runtime = "nodejs";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(1200),
});

const requestSchema = z.object({
  analysis: z.custom<AnalysisResult>((value) => Boolean(value && typeof value === "object")),
  messages: z.array(messageSchema).min(1).max(12),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const answer = await answerAnalysisQuestion(body.analysis, body.messages);

    return NextResponse.json({ answer });
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues[0]?.message ?? "Invalid chat request."
        : error instanceof Error
          ? error.message
          : "Unable to answer analysis question.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
