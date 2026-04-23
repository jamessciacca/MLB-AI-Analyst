import { readFile } from "node:fs/promises";
import path from "node:path";

import { type AgentRepository } from "../db/agentRepository.ts";
import { type OutcomePredictionRecord } from "./types.ts";

type RawPrediction = {
  analysisId?: unknown;
  playerId?: unknown;
  playerName?: unknown;
  gamePk?: unknown;
  market?: unknown;
  probability?: unknown;
  recommendation?: unknown;
  modelVersion?: unknown;
  generatedAt?: unknown;
  savedAt?: unknown;
};

const PREDICTIONS_PATH = path.join(process.cwd(), "data", "predictions.ndjson");

function isRawPrediction(value: unknown): value is RawPrediction {
  return Boolean(value && typeof value === "object");
}

function marketLineFor(market: string) {
  if (market === "home_run") {
    return "over_0.5_hr";
  }

  if (market === "hit") {
    return "over_0.5_hit";
  }

  return null;
}

function toOutcomePrediction(raw: RawPrediction): OutcomePredictionRecord | null {
  if (
    typeof raw.analysisId !== "string" ||
    typeof raw.market !== "string" ||
    typeof raw.probability !== "number"
  ) {
    return null;
  }

  const createdAt =
    typeof raw.savedAt === "string"
      ? raw.savedAt
      : typeof raw.generatedAt === "string"
        ? raw.generatedAt
        : new Date().toISOString();
  const playerName = typeof raw.playerName === "string" ? raw.playerName : null;
  const probability = raw.probability;
  const recommendation =
    typeof raw.recommendation === "string" ? raw.recommendation : "unknown";
  const marketType = raw.market === "home_run" ? "home_run" : raw.market === "hit" ? "hit" : "unknown";

  return {
    predictionId: raw.analysisId,
    createdAt,
    updatedAt: createdAt,
    gameDate: createdAt.slice(0, 10),
    gameId: typeof raw.gamePk === "number" ? raw.gamePk : null,
    team: null,
    opponent: null,
    playerName,
    playerId: typeof raw.playerId === "number" ? raw.playerId : null,
    marketType,
    marketLine: marketLineFor(marketType),
    predictedProbability: probability,
    modelScore: probability,
    impliedProbability: null,
    reasoningSummary: `${playerName ?? "Unknown player"} ${marketType.replaceAll("_", " ")} prediction at ${(probability * 100).toFixed(1)}%, recommendation ${recommendation}.`,
    reasoningFeaturesJson: JSON.stringify({
      recommendation,
      modelVersion: typeof raw.modelVersion === "string" ? raw.modelVersion : null,
    }),
    status: "pending",
    sourceContextJson: JSON.stringify(raw),
  };
}

export async function readSavedOutcomePredictions(
  limit = 250,
): Promise<OutcomePredictionRecord[]> {
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
      .map(toOutcomePrediction)
      .filter((prediction): prediction is OutcomePredictionRecord => Boolean(prediction))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function syncOutcomePredictions(repository: AgentRepository, limit = 250) {
  const predictions = await readSavedOutcomePredictions(limit);

  for (const prediction of predictions) {
    const existing = repository.getOutcomePredictionById(prediction.predictionId);
    repository.upsertOutcomePrediction({
      ...prediction,
      status: existing?.status ?? prediction.status,
    });
  }

  return repository.listOutcomePredictions({ limit });
}
