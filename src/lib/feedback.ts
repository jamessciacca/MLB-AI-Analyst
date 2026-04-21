import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { type AnalysisMarket, type AnalysisResult } from "@/lib/types";
import { clamp } from "@/lib/utils";

type FeedbackRating = "correct" | "too_high" | "too_low";
type Recommendation = "good play" | "neutral" | "avoid";

type FeedbackEntry = {
  analysisId: string;
  playerId: number;
  gamePk: number;
  market: AnalysisMarket;
  probability: number;
  recommendation: Recommendation;
  rating: FeedbackRating;
  savedAt: string;
  source?: "manual" | "auto_outcome";
};

export type SavedPredictionFeedback = FeedbackEntry;

export type PredictionEntry = {
  analysisId: string;
  playerId: number;
  playerName: string;
  gamePk: number;
  market: AnalysisMarket;
  probability: number;
  recommendation: Recommendation;
  modelVersion: string;
  generatedAt: string;
  savedAt: string;
};

export type OutcomeFeedbackEntry = FeedbackEntry & {
  source: "auto_outcome";
  actualHits: number;
  actualHomeRuns: number;
  outcomeSuccess: boolean;
  auditedAt: string;
};

export type PlayerPredictionHistoryEntry = PredictionEntry & {
  outcome: {
    rating: FeedbackRating;
    actualHits: number;
    actualHomeRuns: number;
    outcomeSuccess: boolean;
    auditedAt: string;
  } | null;
};

export type FeedbackCalibration = {
  adjustment: number;
  sampleSize: number;
  tooHighCount: number;
  tooLowCount: number;
  correctCount: number;
};

const DATA_DIRECTORY = path.join(process.cwd(), "data");
const FEEDBACK_PATH = path.join(DATA_DIRECTORY, "feedback.ndjson");
const PREDICTIONS_PATH = path.join(DATA_DIRECTORY, "predictions.ndjson");
const OUTCOME_FEEDBACK_PATH = path.join(DATA_DIRECTORY, "outcome-feedback.ndjson");
const MAX_FEEDBACK_ROWS = 100;

function isoDateKey(value: string) {
  return value.slice(0, 10);
}

function yesterdayIsoDate() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

function isFeedbackEntry(value: unknown): value is FeedbackEntry {
  const entry = value as Partial<FeedbackEntry>;

  return (
    typeof entry.analysisId === "string" &&
    typeof entry.playerId === "number" &&
    typeof entry.gamePk === "number" &&
    (entry.market === "hit" || entry.market === "home_run") &&
    typeof entry.probability === "number" &&
    (entry.recommendation === "good play" ||
      entry.recommendation === "neutral" ||
      entry.recommendation === "avoid") &&
    (entry.rating === "correct" ||
      entry.rating === "too_high" ||
      entry.rating === "too_low") &&
    typeof entry.savedAt === "string"
  );
}

function isOutcomeFeedbackEntry(value: unknown): value is OutcomeFeedbackEntry {
  if (!isFeedbackEntry(value)) {
    return false;
  }

  const entry = value as Partial<OutcomeFeedbackEntry>;

  return (
    entry.source === "auto_outcome" &&
    typeof entry.actualHits === "number" &&
    typeof entry.actualHomeRuns === "number" &&
    typeof entry.outcomeSuccess === "boolean" &&
    typeof entry.auditedAt === "string"
  );
}

function isPredictionEntry(value: unknown): value is PredictionEntry {
  const entry = value as Partial<PredictionEntry>;

  return (
    typeof entry.analysisId === "string" &&
    typeof entry.playerId === "number" &&
    typeof entry.playerName === "string" &&
    typeof entry.gamePk === "number" &&
    (entry.market === "hit" || entry.market === "home_run") &&
    typeof entry.probability === "number" &&
    (entry.recommendation === "good play" ||
      entry.recommendation === "neutral" ||
      entry.recommendation === "avoid") &&
    typeof entry.modelVersion === "string" &&
    typeof entry.generatedAt === "string" &&
    typeof entry.savedAt === "string"
  );
}

async function readNdjsonEntries(filePath: string): Promise<FeedbackEntry[]> {
  try {
    const raw = await readFile(filePath, "utf8");

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
      .filter(isFeedbackEntry);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function readPredictionEntries(): Promise<PredictionEntry[]> {
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
      .filter(isPredictionEntry);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function readFeedbackEntries(): Promise<FeedbackEntry[]> {
  const [manualEntries, outcomeEntries] = await Promise.all([
    readNdjsonEntries(FEEDBACK_PATH),
    readNdjsonEntries(OUTCOME_FEEDBACK_PATH),
  ]);

  return [...manualEntries, ...outcomeEntries];
}

function summarizeMarketFeedback(entries: FeedbackEntry[], market: AnalysisMarket) {
  const marketEntries = entries
    .filter((entry) => entry.market === market)
    .slice(-MAX_FEEDBACK_ROWS);
  const sampleSize = marketEntries.length;
  const tooHighCount = marketEntries.filter((entry) => entry.rating === "too_high").length;
  const tooLowCount = marketEntries.filter((entry) => entry.rating === "too_low").length;
  const correctCount = marketEntries.filter((entry) => entry.rating === "correct").length;
  const maxAdjustment = market === "home_run" ? 0.006 : 0.012;
  const confidence = clamp(sampleSize / 20, 0, 1);
  const netDirection = sampleSize > 0 ? (tooLowCount - tooHighCount) / sampleSize : 0;

  return {
    adjustment: clamp(netDirection * confidence * maxAdjustment, -maxAdjustment, maxAdjustment),
    sampleSize,
    tooHighCount,
    tooLowCount,
    correctCount,
  };
}

export async function getFeedbackCalibration(
  market: AnalysisMarket,
): Promise<FeedbackCalibration> {
  const entries = await readFeedbackEntries();
  return summarizeMarketFeedback(entries, market);
}

export async function getFeedbackCalibrationSummary() {
  const [manualEntries, outcomeEntries, predictionEntries] = await Promise.all([
    readNdjsonEntries(FEEDBACK_PATH),
    readNdjsonEntries(OUTCOME_FEEDBACK_PATH),
    readPredictionEntries(),
  ]);
  const entries = [...manualEntries, ...outcomeEntries];

  return {
    totalEntries: entries.length,
    savedPredictions: predictionEntries.length,
    manualEntries: manualEntries.length,
    autoOutcomeEntries: outcomeEntries.length,
    markets: {
      hit: summarizeMarketFeedback(entries, "hit"),
      home_run: summarizeMarketFeedback(entries, "home_run"),
    },
  };
}

export async function appendPrediction(result: AnalysisResult) {
  const prediction: PredictionEntry = {
    analysisId: result.analysisId,
    playerId: result.hitter.player.id,
    playerName: result.hitter.player.fullName,
    gamePk: result.game.gamePk,
    market: result.market,
    probability: result.probabilities.atLeastOne,
    recommendation: result.recommendation,
    modelVersion: result.modelVersion,
    generatedAt: result.generatedAt,
    savedAt: new Date().toISOString(),
  };

  await mkdir(DATA_DIRECTORY, { recursive: true });
  await appendFile(PREDICTIONS_PATH, `${JSON.stringify(prediction)}\n`, "utf8");
}

export async function appendPredictions(results: AnalysisResult[]) {
  if (results.length === 0) {
    return;
  }

  await mkdir(DATA_DIRECTORY, { recursive: true });
  await appendFile(
    PREDICTIONS_PATH,
    `${results
      .map((result) =>
        JSON.stringify({
          analysisId: result.analysisId,
          playerId: result.hitter.player.id,
          playerName: result.hitter.player.fullName,
          gamePk: result.game.gamePk,
          market: result.market,
          probability: result.probabilities.atLeastOne,
          recommendation: result.recommendation,
          modelVersion: result.modelVersion,
          generatedAt: result.generatedAt,
          savedAt: new Date().toISOString(),
        } satisfies PredictionEntry),
      )
      .join("\n")}\n`,
    "utf8",
  );
}

export async function getSavedPredictions(): Promise<PredictionEntry[]> {
  return readPredictionEntries();
}

export async function getPlayerPredictionHistory(
  playerId: number,
): Promise<PlayerPredictionHistoryEntry[]> {
  const [predictions, outcomes] = await Promise.all([
    readPredictionEntries(),
    readNdjsonEntries(OUTCOME_FEEDBACK_PATH),
  ]);
  const outcomeByAnalysisId = new Map(
    outcomes
      .filter(isOutcomeFeedbackEntry)
      .map((outcome) => [outcome.analysisId, outcome] as const),
  );

  const targetDate = yesterdayIsoDate();

  return predictions
    .filter(
      (prediction) =>
        prediction.playerId === playerId &&
        isoDateKey(prediction.generatedAt) === targetDate,
    )
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
    .slice(0, 1)
    .map((prediction) => {
      const outcome = outcomeByAnalysisId.get(prediction.analysisId);

      return {
        ...prediction,
        outcome: outcome
          ? {
              rating: outcome.rating,
              actualHits: outcome.actualHits,
              actualHomeRuns: outcome.actualHomeRuns,
              outcomeSuccess: outcome.outcomeSuccess,
              auditedAt: outcome.auditedAt,
            }
          : null,
      };
    });
}

export async function getAuditedAnalysisIds(): Promise<Set<string>> {
  const entries = await readNdjsonEntries(OUTCOME_FEEDBACK_PATH);
  return new Set(entries.map((entry) => entry.analysisId));
}

export async function appendOutcomeFeedback(entries: OutcomeFeedbackEntry[]) {
  if (entries.length === 0) {
    return;
  }

  await mkdir(DATA_DIRECTORY, { recursive: true });
  await appendFile(
    OUTCOME_FEEDBACK_PATH,
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8",
  );
}
