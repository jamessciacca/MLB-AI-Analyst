import { type AgentRepository } from "../db/agentRepository.ts";
import {
  type OutcomePredictionRecord,
  type OutcomeResolution,
} from "./types.ts";

export function probabilityBucket(probability: number | null) {
  if (probability === null || !Number.isFinite(probability)) {
    return "unknown";
  }

  const percentage = Math.max(0, Math.min(100, probability * 100));
  const lower = Math.floor(percentage / 5) * 5;
  const upper = Math.min(lower + 5, 100);

  return `${lower}_${upper}`;
}

export function updateCalibrationForResolution(
  repository: AgentRepository,
  prediction: OutcomePredictionRecord,
  resolution: OutcomeResolution,
) {
  if (resolution.actualOutcome === null) {
    return false;
  }

  const bucket = probabilityBucket(prediction.predictedProbability);

  repository.appendCalibrationLog({
    predictionId: prediction.predictionId,
    marketType: prediction.marketType,
    predictedProbability: prediction.predictedProbability,
    outcomeBoolean: resolution.actualOutcome,
    probabilityBucket: bucket,
  });
  repository.recomputeAggregateCalibration(prediction.marketType, bucket);

  return true;
}
