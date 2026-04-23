import { NextResponse } from "next/server";

import { ChatAgent } from "@/agent/chatAgent";

export const runtime = "nodejs";

export async function GET() {
  const agent = new ChatAgent();

  try {
    return NextResponse.json({ sessions: agent.getRepository().listSessions(30) });
  } finally {
    agent.close();
  }
}
