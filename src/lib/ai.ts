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

export type AnalysisChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export async function answerAnalysisQuestion(
  result: AnalysisResult,
  messages: AnalysisChatMessage[],
): Promise<string> {
  const openai = getClient();

  if (!openai) {
    return "OpenAI is not configured yet. Add OPENAI_API_KEY to ask questions about this analysis.";
  }

  const safeMessages = messages.slice(-8).map((message) => ({
    role: message.role,
    content: message.content.slice(0, 800),
  }));

  const response = await openai.responses.create({
    model: "gpt-5.4-mini",
    reasoning: {
      effort: "low",
    },
    input: [
      {
        role: "system",
        content:
          "You are a grounded MLB analysis assistant inside a betting research app. Answer the user's question using only the supplied analysis JSON. Explain model math and factor movement plainly. If the answer is not in the JSON, say what data is missing. Do not invent stats, odds, injuries, news, or certainty. Keep answers concise.",
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            analysis: {
              market: result.marketLabel,
              hitter: result.hitter.player.fullName,
              team: result.hitter.player.currentTeamName,
              pitcher: result.pitcher.player?.fullName ?? "TBD",
              pitcherHand: result.pitcher.player?.pitchHand ?? null,
              recommendation: result.recommendation,
              confidence: result.confidence,
              probabilities: result.probabilities,
              factors: result.factors,
              notes: result.notes,
              recentGames: result.hitter.recentGames,
              batterVsPitcher: result.batterVsPitcher,
              odds: result.odds,
              summary: result.summary,
            },
            conversation: safeMessages,
          },
          null,
          2,
        ),
      },
    ],
  });

  return response.output_text.trim() || "I could not generate a useful answer for that question.";
}
