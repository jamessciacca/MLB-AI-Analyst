import { NextResponse } from "next/server";

import { ChatAgent } from "@/agent/chatAgent";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const agent = new ChatAgent();

  try {
    const { sessionId } = await context.params;
    const repository = agent.getRepository();
    const session = repository.getSession(sessionId);

    if (!session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    return NextResponse.json({
      session,
      messages: repository.getMessages(sessionId),
    });
  } finally {
    agent.close();
  }
}
