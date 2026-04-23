import { NextResponse } from "next/server";

import { ChatAgent } from "@/agent/chatAgent";

export const runtime = "nodejs";

export async function GET() {
  if (process.env.NODE_ENV === "production" && process.env.AGENT_DEV_MEMORY_ROUTE !== "true") {
    return NextResponse.json({ error: "Memory inspection is disabled." }, { status: 403 });
  }

  const agent = new ChatAgent();

  try {
    const repository = agent.getRepository();

    return NextResponse.json({
      memories: repository.listMemories(50),
      preferences: repository.listPreferences(50),
      feedback: repository.listPredictionFeedback(50),
    });
  } finally {
    agent.close();
  }
}
