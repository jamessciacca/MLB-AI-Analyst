import { NextResponse } from "next/server";

import { ChatAgent } from "@/agent/chatAgent";

export const runtime = "nodejs";

export async function GET() {
  const agent = new ChatAgent();

  try {
    return NextResponse.json({
      stats: agent.getRepository().listAggregateCalibrationStats(),
    });
  } finally {
    agent.close();
  }
}
