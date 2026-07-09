import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { clamp } from "../utils.ts";
import { type AnalysisMarket } from "../types.ts";

export interface MlbAnalystFeedbackEntry {
  analysisId: string;
  playerId: number;
  playerName: string;
  gamePk: number;
  market: AnalysisMarket;
  probability: number;
  recommendation: "good play" | "neutral" | "avoid";
  rating: "correct" | "too_high" | "too_low";
  savedAt: string;
  source: "manual" | "api";
  actualResult: boolean;
  team?: string | null;
  opponent?: string | null;
  featuresUsed?: string[];
  notes?: string | null;
}

const DATA_DIRECTORY = path.join(process.cwd(), "data");
const FEEDBACK_PATH = path.join(DATA_DIRECTORY, "feedback.ndjson");

function recommendationFromProbability(probability: number, market: AnalysisMarket) {
  const goodThreshold = market === "home_run" ? 0.26 : market === "hit_2_plus" ? 0.34 : 0.62;
  const neutralThreshold = market === "home_run" ? 0.15 : market === "hit_2_plus" ? 0.22 : 0.48;

  if (probability >= goodThreshold) {
    return "good play" as const;
  }
  if (probability >= neutralThreshold) {
    return "neutral" as const;
  }

  return "avoid" as const;
}

function ratingFromOutcome(probability: number, actualResult: boolean, market: AnalysisMarket) {
  const threshold = market === "home_run" ? 0.15 : market === "hit_2_plus" ? 0.22 : 0.5;
  const predictedPositive = probability >= threshold;

  if (predictedPositive === actualResult) {
    return "correct" as const;
  }

  return predictedPositive ? "too_high" : "too_low";
}

export async function appendMlbAnalystFeedback(input: {
  analysisId?: string | null;
  playerId: number;
  playerName: string;
  gamePk: number;
  market?: AnalysisMarket;
  probability: number;
  actualResult: boolean;
  team?: string | null;
  opponent?: string | null;
  featuresUsed?: string[];
  notes?: string | null;
}): Promise<MlbAnalystFeedbackEntry> {
  const probability = clamp(input.probability, 0.001, 0.999);
  const market = input.market ?? "hit";
  const entry: MlbAnalystFeedbackEntry = {
    analysisId:
      input.analysisId?.trim() ||
      `mlb-feedback-${input.playerId}-${input.gamePk}-${Date.now()}`,
    playerId: input.playerId,
    playerName: input.playerName,
    gamePk: input.gamePk,
    market,
    probability,
    recommendation: recommendationFromProbability(probability, market),
    rating: ratingFromOutcome(probability, input.actualResult, market),
    savedAt: new Date().toISOString(),
    source: "api",
    actualResult: input.actualResult,
    team: input.team ?? null,
    opponent: input.opponent ?? null,
    featuresUsed: input.featuresUsed ?? [],
    notes: input.notes ?? null,
  };

  await mkdir(DATA_DIRECTORY, { recursive: true });
  await appendFile(FEEDBACK_PATH, `${JSON.stringify(entry)}\n`, "utf8");

  return entry;
}

export async function readMlbAnalystFeedback(limit = 200): Promise<MlbAnalystFeedbackEntry[]> {
  try {
    const raw = await readFile(FEEDBACK_PATH, "utf8");

    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as Partial<MlbAnalystFeedbackEntry>;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is MlbAnalystFeedbackEntry =>
        Boolean(
          entry &&
            typeof entry.analysisId === "string" &&
            typeof entry.playerId === "number" &&
            typeof entry.playerName === "string" &&
            typeof entry.gamePk === "number" &&
            (entry.market === "hit" ||
              entry.market === "hit_2_plus" ||
              entry.market === "home_run") &&
            typeof entry.probability === "number" &&
            (entry.rating === "correct" ||
              entry.rating === "too_high" ||
              entry.rating === "too_low") &&
            typeof entry.savedAt === "string",
        ),
      )
      .sort((left, right) => right.savedAt.localeCompare(left.savedAt))
      .slice(0, limit);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}
