import { NextResponse } from "next/server";

import { ChatAgent } from "@/agent/chatAgent";
import {
  exportResolvedPredictionsToCsv,
  exportResolvedPredictionsToJsonl,
} from "@/outcomes/trainingExport";

export const runtime = "nodejs";

export async function POST() {
  const agent = new ChatAgent();

  try {
    const repository = agent.getRepository();
    const [csv, jsonl] = await Promise.all([
      exportResolvedPredictionsToCsv(repository),
      exportResolvedPredictionsToJsonl(repository),
    ]);

    return NextResponse.json({ csv, jsonl });
  } finally {
    agent.close();
  }
}
