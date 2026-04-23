import { type PromptContext } from "./types.ts";

export const AGENT_SYSTEM_PROMPT = `You are the conversational agent for MLB Analyst AI.
You help explain MLB hit, home-run, and game prediction outputs in a grounded way.
Use stored memories, user preferences, and previous feedback when relevant.
Do not invent confirmed outcomes, lineups, injuries, odds, or game results.
Clearly distinguish model predictions, user feedback, and verified results.
When data is incomplete, say what is missing and keep uncertainty visible.
Use feedback to improve explanation style and future reasoning, but never overwrite raw prediction history.
Prefer practical betting language: signal strength, volatility, matchup fit, uncertainty, and calibration.`;

function bulletList(values: string[]) {
  return values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : "- None";
}

export function buildPromptContext(context: PromptContext, userMessage: string) {
  const memories = bulletList(
    context.memories.map(
      (memory) =>
        `[${memory.category}, importance ${memory.importanceScore.toFixed(2)}] ${memory.content}`,
    ),
  );
  const preferences = bulletList(
    context.preferences.map(
      (preference) =>
        `${preference.key}: ${preference.value} (confidence ${preference.confidence.toFixed(2)})`,
    ),
  );
  const predictions = bulletList(
    context.predictions.map(
      (prediction) =>
        `${prediction.predictionId}: ${prediction.predictionSummary} Created ${prediction.createdAt}`,
    ),
  );
  const feedback = bulletList(
    context.relatedFeedback.map((entry) => {
      const correctness =
        entry.wasPredictionCorrect === null
          ? "unknown correctness"
          : entry.wasPredictionCorrect
            ? "correct"
            : "incorrect";

      return `${entry.predictionId ?? "unmatched"}: ${entry.feedbackType}, ${entry.actualOutcome}, ${correctness}. ${entry.userMessage}`;
    }),
  );

  return `Current session: ${context.session.title} (${context.session.id})

Relevant durable memories:
${memories}

User preferences:
${preferences}

Recent prediction context:
${predictions}

Recent prediction feedback:
${feedback}

New user message:
${userMessage}`;
}

export function buildChatInput(context: PromptContext, userMessage: string) {
  const recentMessages = context.recentMessages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));

  return [
    {
      role: "system" as const,
      content: AGENT_SYSTEM_PROMPT,
    },
    ...recentMessages,
    {
      role: "user" as const,
      content: buildPromptContext(context, userMessage),
    },
  ];
}

export function buildOfflineResponse(context: PromptContext, userMessage: string) {
  const latestPrediction = context.predictions[0];
  const relevantMemory = context.memories[0];
  const wantsHits = /\bhits?\b/i.test(userMessage);
  const wantsHr = /\b(home run|homer|hr)\b/i.test(userMessage);

  if (latestPrediction && /last prediction|explain|why|show/i.test(userMessage)) {
    return `${latestPrediction.predictionSummary} I would treat that as a model prediction, not a confirmed result. ${
      relevantMemory ? `I am also keeping this preference in mind: ${relevantMemory.content}` : ""
    }`.trim();
  }

  if (wantsHits || wantsHr) {
    const market = wantsHr ? "home-run" : "hit";
    const candidates = context.predictions
      .filter((prediction) =>
        wantsHr
          ? prediction.marketType === "home_run"
          : prediction.marketType === "hit",
      )
      .slice(0, 3);

    if (candidates.length > 0) {
      return `For ${market} picks, the latest saved predictions I can discuss are ${candidates
        .map((prediction) => prediction.predictionSummary)
        .join(" ")} I would still want fresh odds, lineup status, and confirmed outcomes before treating them as final.`;
    }
  }

  return `I can help explain picks, remember your preferences, and log feedback. ${
    latestPrediction
      ? `The latest saved prediction is: ${latestPrediction.predictionSummary}`
      : "I do not see a saved prediction yet, so I will answer without prediction context."
  }`;
}
