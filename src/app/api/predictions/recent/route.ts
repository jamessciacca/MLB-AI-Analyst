import { NextResponse } from "next/server";

import { ChatAgent } from "@/agent/chatAgent";
import { syncOutcomePredictions } from "@/outcomes/predictionStore";

export const runtime = "nodejs";

export async function GET() {
  const agent = new ChatAgent();

  try {
    const predictions = await syncOutcomePredictions(agent.getRepository(), 100);

    return NextResponse.json({ predictions });
  } finally {
    agent.close();
  }
}
