import { readFile } from "node:fs/promises";
import path from "node:path";

import { type AgentRepository } from "../db/agentRepository.ts";
import {
  type AgentPrediction,
  type ParsedFeedback,
  type PredictionMarket,
} from "./types.ts";

type RawPrediction = {
  analysisId?: unknown;
  playerName?: unknown;
  market?: unknown;
  probability?: unknown;
  recommendation?: unknown;
  modelVersion?: unknown;
  generatedAt?: unknown;
  savedAt?: unknown;
};

const PREDICTIONS_PATH = path.join(process.cwd(), "data", "predictions.ndjson");

function normalizeMarket(value: unknown): PredictionMarket {
  if (value === "hit" || value === "home_run" || value === "game_win") {
    return value;
  }

  return "unknown";
}

function isRawPrediction(value: unknown): value is RawPrediction {
  return Boolean(value && typeof value === "object");
}

function toAgentPrediction(raw: RawPrediction): AgentPrediction | null {
  if (typeof raw.analysisId !== "string") {
    return null;
  }

  const playerName = typeof raw.playerName === "string" ? raw.playerName : null;
  const marketType = normalizeMarket(raw.market);
  const probability = typeof raw.probability === "number" ? raw.probability : null;
  const recommendation =
    typeof raw.recommendation === "string" ? raw.recommendation : "unknown";
  const createdAt =
    typeof raw.savedAt === "string"
      ? raw.savedAt
      : typeof raw.generatedAt === "string"
        ? raw.generatedAt
        : new Date().toISOString();

  return {
    predictionId: raw.analysisId,
    playerName,
    marketType,
    predictedProbability: probability,
    predictionSummary: summarizePredictionReasoning({
      predictionId: raw.analysisId,
      playerName,
      marketType,
      predictedProbability: probability,
      predictionSummary: "",
      createdAt,
    }, recommendation),
    createdAt,
  };
}

export async function getLatestPredictions(limit = 8): Promise<AgentPrediction[]> {
  try {
    const raw = await readFile(PREDICTIONS_PATH, "utf8");

    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return null;
        }
      })
      .filter(isRawPrediction)
      .map(toAgentPrediction)
      .filter((prediction): prediction is AgentPrediction => Boolean(prediction))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function getPredictionById(
  predictionId: string,
): Promise<AgentPrediction | null> {
  const predictions = await getLatestPredictions(250);

  return predictions.find((prediction) => prediction.predictionId === predictionId) ?? null;
}

export function summarizePredictionReasoning(
  prediction: AgentPrediction,
  recommendation?: string,
) {
  const marketLabel =
    prediction.marketType === "home_run"
      ? "home run"
      : prediction.marketType === "hit"
        ? "hit"
        : prediction.marketType.replaceAll("_", " ");
  const probability =
    prediction.predictedProbability === null
      ? "probability unavailable"
      : `${(prediction.predictedProbability * 100).toFixed(1)}%`;
  const target = prediction.playerName ?? "Unknown player";
  const recommendationText = recommendation ? `, recommendation ${recommendation}` : "";

  return `${target} ${marketLabel} prediction at ${probability}${recommendationText}.`;
}

export async function syncLatestPredictionsToStore(repository: AgentRepository) {
  const predictions = await getLatestPredictions(30);

  for (const prediction of predictions) {
    repository.upsertPrediction(prediction);
  }

  return predictions;
}

export function matchPredictionForFeedback(
  parsed: ParsedFeedback,
  predictions: AgentPrediction[],
) {
  const marketMatches = (prediction: AgentPrediction) =>
    parsed.referencedMarket === "unknown" ||
    prediction.marketType === parsed.referencedMarket;
  const playerMatches = (prediction: AgentPrediction) =>
    !parsed.referencedPlayerName ||
    prediction.playerName
      ?.toLowerCase()
      .includes(parsed.referencedPlayerName.toLowerCase()) ||
    parsed.referencedPlayerName
      .toLowerCase()
      .includes(prediction.playerName?.toLowerCase() ?? "\u0000");

  return (
    predictions.find((prediction) => marketMatches(prediction) && playerMatches(prediction)) ??
    predictions.find(marketMatches) ??
    predictions[0] ??
    null
  );
}

export function attachFeedbackToPrediction(
  repository: AgentRepository,
  prediction: AgentPrediction | null,
  parsed: ParsedFeedback,
  userMessage: string,
) {
  return repository.savePredictionFeedback(
    {
      predictionId: prediction?.predictionId ?? null,
      feedbackType: parsed.feedbackType,
      userMessage,
      actualOutcome: parsed.actualOutcome,
      wasPredictionCorrect: parsed.wasPredictionCorrect,
    },
    prediction?.predictedProbability ?? null,
  );
}
