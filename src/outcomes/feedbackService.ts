import { MemoryManager } from "../agent/memoryManager.ts";
import { type MemoryItem } from "../agent/types.ts";
import { type AgentRepository } from "../db/agentRepository.ts";
import { updateCalibrationForResolution } from "./calibration.ts";
import { parseOutcomeFeedbackMessage } from "./feedbackParser.ts";
import { findBestPredictionMatch } from "./matcher.ts";
import { syncOutcomePredictions } from "./predictionStore.ts";
import { actualOutcomeText, agentFeedbackType, resolvePredictionOutcome } from "./resolver.ts";
import { buildTrainingFeedbackRow } from "./trainingExport.ts";
import {
  type FeedbackSource,
  type ProcessOutcomeFeedbackResult,
} from "./types.ts";

function summaryMessage(result: ProcessOutcomeFeedbackResult) {
  if (result.parsed.kind !== "prediction_feedback") {
    return "I did not treat that as prediction outcome feedback.";
  }

  if (!result.match.prediction) {
    return `I understood the feedback, but I could not safely match it to a prior prediction. I logged it without resolving a prediction.`;
  }

  const prediction = result.match.prediction;

  if (!result.resolution) {
    return `Logged feedback on ${prediction.playerName ?? "the matched prediction"} ${prediction.marketType}. No outcome was resolved because the message was reasoning/style feedback.`;
  }

  const correctness =
    result.resolution.wasPredictionCorrect === null
      ? "outcome recorded"
      : result.resolution.wasPredictionCorrect
        ? "marked correct"
        : "marked incorrect";

  return `Logged: ${prediction.playerName ?? "matched prediction"} ${prediction.marketType} ${correctness}. Added to calibration history and the resolved-prediction training rows.`;
}

function memoryContent(result: ProcessOutcomeFeedbackResult) {
  const prediction = result.match.prediction;
  const resolution = result.resolution;

  if (!prediction) {
    return `Unmatched prediction feedback: ${result.parsed.rawMessage}`;
  }

  if (!resolution) {
    return `Prediction reasoning feedback: ${prediction.playerName ?? "unknown"} ${prediction.marketType} - ${result.parsed.feedbackType}. User said: ${result.parsed.rawMessage}`;
  }

  const correctness =
    resolution.wasPredictionCorrect === null
      ? "resolved with unknown correctness"
      : resolution.wasPredictionCorrect
        ? "correct"
        : "incorrect";

  return `Resolved prediction feedback: ${prediction.playerName ?? "unknown"} ${prediction.marketType} was ${correctness}. User said: ${result.parsed.rawMessage}`;
}

export async function processOutcomeFeedback(
  repository: AgentRepository,
  message: string,
  options: {
    feedbackSource?: FeedbackSource;
    createMemory?: boolean;
  } = {},
): Promise<ProcessOutcomeFeedbackResult & { memoriesSaved: MemoryItem[] }> {
  const recentPredictions = await syncOutcomePredictions(repository, 250);
  const parsed = parseOutcomeFeedbackMessage(message, { recentPredictions });
  const match =
    parsed.kind === "prediction_feedback"
      ? findBestPredictionMatch(parsed, recentPredictions)
      : {
          prediction: null,
          confidence: 0,
          reasons: ["not feedback"],
          alternatives: [],
        };
  const resolution = match.prediction
    ? resolvePredictionOutcome(match.prediction, parsed)
    : null;
  const feedbackId =
    parsed.kind === "prediction_feedback"
      ? repository.saveOutcomeFeedback({
          predictionId: match.prediction?.predictionId ?? null,
          feedbackSource: options.feedbackSource ?? "user_chat",
          rawUserMessage: message,
          normalizedFeedbackType: parsed.feedbackType,
          feedbackType: agentFeedbackType(parsed),
          actualOutcomeText: actualOutcomeText(parsed),
          actualOutcomeBoolean: parsed.actualOutcome,
          actualStatValue: parsed.actualValue,
          wasPredictionCorrect: resolution?.wasPredictionCorrect ?? parsed.actualOutcome,
          notes: parsed.notes.join(" "),
          matchConfidence: match.confidence,
          matchReasons: match.reasons,
        })
      : null;

  let resolutionId: number | null = null;
  let calibrationUpdated = false;
  let trainingRowCreated = false;

  if (match.prediction && resolution) {
    resolutionId = repository.saveResolvedOutcome(resolution);
    calibrationUpdated = updateCalibrationForResolution(repository, match.prediction, resolution);
    repository.saveTrainingFeedbackRow(buildTrainingFeedbackRow(match.prediction, resolution));
    trainingRowCreated = true;
  }

  const result: ProcessOutcomeFeedbackResult = {
    parsed,
    match,
    resolution,
    logged: {
      feedbackId,
      resolutionId,
      calibrationUpdated,
      trainingRowCreated,
    },
    message: "",
  };
  result.message = summaryMessage(result);

  const memoriesSaved =
    options.createMemory === false || parsed.kind !== "prediction_feedback"
      ? []
      : new MemoryManager(repository).saveMemoryItems([
          {
            category: "prediction_feedback",
            content: memoryContent(result),
            tags: [
              "resolved-feedback",
              match.prediction?.marketType ?? String(parsed.marketType),
              match.prediction?.playerName ?? parsed.playerName ?? "unmatched",
            ],
            importanceScore: resolution ? 0.88 : 0.72,
            source: "outcome_feedback",
          },
        ]);

  return { ...result, memoriesSaved };
}
