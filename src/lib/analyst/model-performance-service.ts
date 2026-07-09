import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  getFeedbackCalibrationSummary,
  getOutcomeFeedbackEntries,
  getSavedPredictions,
} from "../feedback.ts";
import { evaluateResolvedPredictions } from "../prediction/model-evaluation.ts";

import { type ModelPerformanceSummaryResponse } from "./board-types.ts";

async function readOptionalJson(filePath: string) {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function buildModelPerformanceSummary(): Promise<ModelPerformanceSummaryResponse> {
  const artifactDirectory = path.join(process.cwd(), "ml", "artifacts");
  const [
    feedbackCalibration,
    artifactCalibration,
    trainingSummary,
    savedPredictions,
    outcomeFeedback,
  ] = await Promise.all([
    getFeedbackCalibrationSummary(),
    readOptionalJson(path.join(artifactDirectory, "calibration.json")),
    readOptionalJson(path.join(artifactDirectory, "hit_model_training_summary.json")),
    getSavedPredictions(),
    getOutcomeFeedbackEntries(),
  ]);
  const liveEvaluation = evaluateResolvedPredictions({
    predictions: savedPredictions,
    outcomes: outcomeFeedback,
  });
  const notes = [
    artifactCalibration
      ? null
      : "No saved ML calibration artifact was found yet. Train the model to populate ml/artifacts/calibration.json.",
    trainingSummary
      ? null
      : "No saved training summary was found yet. Train the model to populate ml/artifacts/hit_model_training_summary.json.",
    "Feedback calibration is always live from data/feedback.ndjson and data/outcome-feedback.ndjson.",
  ].filter((value): value is string => Boolean(value));

  return {
    generatedAt: new Date().toISOString(),
    feedbackCalibration,
    artifactCalibration,
    trainingSummary: trainingSummary
      ? {
          ...trainingSummary,
          liveEvaluation,
        }
      : {
          liveEvaluation,
        },
    notes,
  };
}
