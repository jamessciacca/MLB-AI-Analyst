import {
  type OutcomePredictionRecord,
  type OutcomeResolution,
  type ParsedOutcomeFeedback,
} from "./types.ts";

function thresholdFromMarketLine(marketLine: string | null) {
  const match = marketLine?.match(/over_(\d+(?:\.\d+)?)/i);

  return match?.[1] ? Number(match[1]) : 0.5;
}

function resolveThresholdMarket(
  prediction: OutcomePredictionRecord,
  parsed: ParsedOutcomeFeedback,
) {
  if (parsed.actualValue !== null) {
    return parsed.actualValue > thresholdFromMarketLine(prediction.marketLine);
  }

  return parsed.actualOutcome;
}

export function resolvePredictionOutcome(
  prediction: OutcomePredictionRecord,
  parsed: ParsedOutcomeFeedback,
): OutcomeResolution | null {
  if (parsed.reasoningOnly || (parsed.actualOutcome === null && parsed.actualValue === null)) {
    return null;
  }

  const actualOutcome =
    prediction.marketType === "hit" ||
    prediction.marketType === "home_run" ||
    prediction.marketType === "total_bases"
      ? resolveThresholdMarket(prediction, parsed)
      : parsed.actualOutcome;

  return {
    predictionId: prediction.predictionId,
    actualOutcome,
    actualValue: parsed.actualValue,
    wasPredictionCorrect: actualOutcome,
    resolutionMethod: "user_message",
    resolutionConfidence: Math.min(parsed.confidence, 0.98),
    rawResolutionContextJson: JSON.stringify({
      rawMessage: parsed.rawMessage,
      parsed,
      prediction: {
        predictionId: prediction.predictionId,
        marketType: prediction.marketType,
        marketLine: prediction.marketLine,
        predictedProbability: prediction.predictedProbability,
      },
    }),
  };
}

export function actualOutcomeText(
  parsed: ParsedOutcomeFeedback,
): "hit" | "no_hit" | "home_run" | "no_home_run" | "win" | "loss" | "unknown" {
  if (parsed.marketType === "home_run") {
    return parsed.actualOutcome === null
      ? "unknown"
      : parsed.actualOutcome
        ? "home_run"
        : "no_home_run";
  }

  if (parsed.marketType === "team_moneyline") {
    return parsed.actualOutcome === null ? "unknown" : parsed.actualOutcome ? "win" : "loss";
  }

  if (parsed.marketType === "hit" || parsed.marketType === "total_bases") {
    return parsed.actualOutcome === null ? "unknown" : parsed.actualOutcome ? "hit" : "no_hit";
  }

  return parsed.actualOutcome === null ? "unknown" : parsed.actualOutcome ? "hit" : "no_hit";
}

export function agentFeedbackType(parsed: ParsedOutcomeFeedback) {
  if (parsed.feedbackType === "too_risky") {
    return "too_risky" as const;
  }

  if (parsed.feedbackType === "correct" || parsed.actualOutcome === true) {
    return "positive" as const;
  }

  if (parsed.feedbackType === "incorrect" || parsed.actualOutcome === false) {
    return "negative" as const;
  }

  return "neutral" as const;
}
