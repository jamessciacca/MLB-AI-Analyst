import { NextResponse } from "next/server";
import { z } from "zod";

import { ChatAgent } from "@/agent/chatAgent";
import { processOutcomeFeedback } from "@/outcomes/feedbackService";

export const runtime = "nodejs";

const requestSchema = z.object({
  message: z.string().min(1),
  source: z.enum(["user_chat", "ui_button", "system_import"]).default("user_chat"),
});

export async function POST(request: Request) {
  const agent = new ChatAgent();

  try {
    const body = requestSchema.parse(await request.json());
    const result = await processOutcomeFeedback(agent.getRepository(), body.message, {
      feedbackSource: body.source,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to process prediction feedback.",
      },
      { status: 400 },
    );
  } finally {
    agent.close();
  }
}
