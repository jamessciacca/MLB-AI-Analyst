import { clamp } from "../utils.ts";

import { type AnalystWeights } from "./types.ts";

export const ANALYST_DEFAULT_WEIGHTS: AnalystWeights = {
  modelProbability: 0.3,
  batterContext: 0.2,
  pitcherMatchup: 0.15,
  teamOffense: 0.1,
  gameEnvironment: 0.1,
  marketContext: 0.1,
  feedbackCalibration: 0.05,
};

function envWeight(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(value, 0) : fallback;
}

export function getAnalystWeights(): AnalystWeights {
  const raw: AnalystWeights = {
    modelProbability: envWeight(
      "ANALYST_WEIGHT_MODEL_PROBABILITY",
      ANALYST_DEFAULT_WEIGHTS.modelProbability,
    ),
    batterContext: envWeight(
      "ANALYST_WEIGHT_BATTER_CONTEXT",
      ANALYST_DEFAULT_WEIGHTS.batterContext,
    ),
    pitcherMatchup: envWeight(
      "ANALYST_WEIGHT_PITCHER_MATCHUP",
      ANALYST_DEFAULT_WEIGHTS.pitcherMatchup,
    ),
    teamOffense: envWeight(
      "ANALYST_WEIGHT_TEAM_OFFENSE",
      ANALYST_DEFAULT_WEIGHTS.teamOffense,
    ),
    gameEnvironment: envWeight(
      "ANALYST_WEIGHT_GAME_ENVIRONMENT",
      ANALYST_DEFAULT_WEIGHTS.gameEnvironment,
    ),
    marketContext: envWeight(
      "ANALYST_WEIGHT_MARKET_CONTEXT",
      ANALYST_DEFAULT_WEIGHTS.marketContext,
    ),
    feedbackCalibration: envWeight(
      "ANALYST_WEIGHT_FEEDBACK_CALIBRATION",
      ANALYST_DEFAULT_WEIGHTS.feedbackCalibration,
    ),
  };
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0);

  if (total <= 0) {
    return ANALYST_DEFAULT_WEIGHTS;
  }

  return {
    modelProbability: clamp(raw.modelProbability / total, 0, 1),
    batterContext: clamp(raw.batterContext / total, 0, 1),
    pitcherMatchup: clamp(raw.pitcherMatchup / total, 0, 1),
    teamOffense: clamp(raw.teamOffense / total, 0, 1),
    gameEnvironment: clamp(raw.gameEnvironment / total, 0, 1),
    marketContext: clamp(raw.marketContext / total, 0, 1),
    feedbackCalibration: clamp(raw.feedbackCalibration / total, 0, 1),
  };
}
