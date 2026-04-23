import { NextResponse } from "next/server";

import { ChatAgent } from "@/agent/chatAgent";
import { syncOutcomePredictions } from "@/outcomes/predictionStore";

export const runtime = "nodejs";

export async function GET() {
  const agent = new ChatAgent();

  try {
    const repository = agent.getRepository();
    await syncOutcomePredictions(repository, 250);

    return NextResponse.json({
      predictions: repository.listOutcomePredictions({
        limit: 100,
        unresolvedOnly: true,
      }),
    });
  } finally {
    agent.close();
  }
}
