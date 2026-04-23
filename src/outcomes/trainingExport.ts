import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { type AgentRepository } from "../db/agentRepository.ts";
import {
  type OutcomePredictionRecord,
  type OutcomeResolution,
  type TrainingFeedbackRow,
} from "./types.ts";

const TRAINING_DIR = path.join(process.cwd(), "data", "training");
const CSV_PATH = path.join(TRAINING_DIR, "resolved_predictions.csv");
const JSONL_PATH = path.join(TRAINING_DIR, "resolved_predictions.jsonl");

export function buildTrainingFeedbackRow(
  prediction: OutcomePredictionRecord,
  resolution: OutcomeResolution,
): TrainingFeedbackRow {
  return {
    predictionId: prediction.predictionId,
    playerName: prediction.playerName,
    gameDate: prediction.gameDate,
    gameId: prediction.gameId,
    marketType: prediction.marketType,
    marketLine: prediction.marketLine,
    predictedProbability: prediction.predictedProbability,
    impliedProbability: prediction.impliedProbability,
    reasoningFeaturesJson: prediction.reasoningFeaturesJson,
    actualOutcome: resolution.actualOutcome,
    actualValue: resolution.actualValue,
    wasPredictionCorrect: resolution.wasPredictionCorrect,
    createdAt: new Date().toISOString(),
  };
}

function csvEscape(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);

  if (/[,"\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

export async function exportResolvedPredictionsToCsv(repository: AgentRepository) {
  const rows = repository.listTrainingFeedbackRows();
  const headers = [
    "prediction_id",
    "player_name",
    "game_date",
    "game_id",
    "market_type",
    "market_line",
    "predicted_probability",
    "implied_probability",
    "reasoning_features_json",
    "actual_outcome",
    "actual_value",
    "was_prediction_correct",
    "created_at",
  ];
  const body = rows.map((row) =>
    [
      row.predictionId,
      row.playerName,
      row.gameDate,
      row.gameId,
      row.marketType,
      row.marketLine,
      row.predictedProbability,
      row.impliedProbability,
      row.reasoningFeaturesJson,
      row.actualOutcome,
      row.actualValue,
      row.wasPredictionCorrect,
      row.createdAt,
    ]
      .map(csvEscape)
      .join(","),
  );

  await mkdir(TRAINING_DIR, { recursive: true });
  await writeFile(CSV_PATH, `${headers.join(",")}\n${body.join("\n")}\n`, "utf8");

  return { path: CSV_PATH, rows: rows.length };
}

export async function exportResolvedPredictionsToJsonl(repository: AgentRepository) {
  const rows = repository.listTrainingFeedbackRows();

  await mkdir(TRAINING_DIR, { recursive: true });
  await writeFile(
    JSONL_PATH,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
    "utf8",
  );

  return { path: JSONL_PATH, rows: rows.length };
}
