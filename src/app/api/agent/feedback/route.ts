import { NextResponse } from "next/server";
import { z } from "zod";

import { ChatAgent } from "@/agent/chatAgent";
import { processOutcomeFeedback } from "@/outcomes/feedbackService";

export const runtime = "nodejs";

const requestSchema = z.object({
  message: z.string().min(1),
});

export async function POST(request: Request) {
  const agent = new ChatAgent();

  try {
    const body = requestSchema.parse(await request.json());
    const feedback = await processOutcomeFeedback(agent.getRepository(), body.message, {
      feedbackSource: "user_chat",
    });

    return NextResponse.json(feedback);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to save agent feedback.",
      },
      { status: 400 },
    );
  } finally {
    agent.close();
  }
}
