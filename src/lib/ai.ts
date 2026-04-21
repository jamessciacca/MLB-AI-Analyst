import OpenAI from "openai";

import { type AnalysisResult } from "@/lib/types";

let client: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  return client;
}

export async function generateAiSummary(
  result: AnalysisResult,
): Promise<string | null> {
  const openai = getClient();

  if (!openai) {
    return null;
  }

  try {
    const response = await openai.responses.create({
      model: "gpt-5.4-mini",
      reasoning: {
        effort: "low",
      },
      input: [
        {
          role: "system",
          content:
            "You are a concise MLB analyst. Summarize the selected outcome call in 3 short sentences. Mention the most important positive and negative driver. Do not invent stats.",
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              market: result.marketLabel,
              hitter: result.hitter.player.fullName,
              team: result.hitter.player.currentTeamName,
              recommendation: result.recommendation,
              confidence: result.confidence,
              probability: result.probabilities.atLeastOne,
              pitcher: result.pitcher.player?.fullName ?? "TBD",
              topFactors: result.factors,
              notes: result.notes,
            },
            null,
            2,
          ),
        },
      ],
    });

    return response.output_text.trim() || null;
  } catch {
    return null;
  }
}
