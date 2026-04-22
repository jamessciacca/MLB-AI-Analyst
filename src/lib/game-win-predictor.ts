import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  getGameWinFeatureNames,
  type GameWinFeatureName,
} from "@/lib/game-win-features";
import { type GameWinFeatureVector } from "@/lib/types";
import { clamp } from "@/lib/utils";

type GameWinModelArtifact = {
  modelType: "regularized_logistic_regression";
  version: string;
  trainedAt: string;
  featureNames: GameWinFeatureName[];
  intercept: number;
  coefficients: Record<GameWinFeatureName, number>;
  standardization: {
    mean: Record<GameWinFeatureName, number>;
    scale: Record<GameWinFeatureName, number>;
  };
  calibration?: {
    method: "platt";
    intercept: number;
    slope: number;
  };
  metrics?: Record<string, number>;
};

export type GameWinModelPrediction = {
  homeWinProbability: number;
  modelVersion: string;
  modelType: "trained" | "fallback";
  score: number;
  topContributors: Array<{
    feature: GameWinFeatureName;
    value: number;
    contribution: number;
  }>;
};

let cachedArtifact: GameWinModelArtifact | null | undefined;
const MODEL_ARTIFACT_PATH = path.join(process.cwd(), "ml", "artifacts", "game_win_model.json");

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value));
}

function loadArtifact() {
  if (cachedArtifact !== undefined) {
    return cachedArtifact;
  }

  if (!existsSync(MODEL_ARTIFACT_PATH)) {
    cachedArtifact = null;
    return cachedArtifact;
  }

  cachedArtifact = JSON.parse(readFileSync(MODEL_ARTIFACT_PATH, "utf8")) as GameWinModelArtifact;
  return cachedArtifact;
}

function validateArtifact(artifact: GameWinModelArtifact) {
  const expected = getGameWinFeatureNames();
  return expected.every((feature) => artifact.featureNames.includes(feature));
}

function fallbackWeights(feature: GameWinFeatureName): number {
  const weights: Partial<Record<GameWinFeatureName, number>> = {
    starter_quality_diff: 0.58,
    starter_workload_diff: 0.08,
    home_starter_missing: -0.38,
    away_starter_missing: 0.38,
    offense_ops_diff: 2.2,
    offense_power_diff: 1.1,
    offense_plate_discipline_diff: 0.95,
    lineup_quality_diff: 0.34,
    lineup_confirmed: 0.04,
    bullpen_quality_diff: 0.34,
    bullpen_fatigue_diff: 0.32,
    defense_oaa_diff: 0.012,
    fielding_pct_diff: 4.2,
    recent_win_pct_diff: 0.35,
    recent_run_diff_per_game_diff: 0.08,
    season_win_pct_diff: 1.1,
    rest_days_diff: 0.08,
    home_field: 0.18,
    park_run_factor: 0.08,
    weather_run_environment: 0.04,
    is_day_game: -0.01,
    is_night_game: 0.01,
    is_twilight_start: -0.015,
    weather_severity_score: -0.04,
    weather_penalty_for_pitchers: -0.08,
    market_implied_home_win_prob: 0.18,
    market_implied_away_win_prob: -0.18,
    lineup_uncertainty_score: -0.04,
    injury_uncertainty_score: -0.03,
    external_data_completeness_score: 0.02,
    critical_missing_count: -0.035,
  };

  return weights[feature] ?? 0;
}

function predictWithFallback(features: GameWinFeatureVector): GameWinModelPrediction {
  let score = -0.02;
  const topContributors: GameWinModelPrediction["topContributors"] = [];

  for (const feature of getGameWinFeatureNames()) {
    const value = features[feature];
    const contribution = value * fallbackWeights(feature);
    score += contribution;
    topContributors.push({ feature, value, contribution });
  }

  return {
    homeWinProbability: clamp(sigmoid(score), 0.03, 0.97),
    modelVersion: "game-win-fallback-v1",
    modelType: "fallback",
    score,
    topContributors: topContributors
      .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution))
      .slice(0, 8),
  };
}

function predictWithArtifact(
  artifact: GameWinModelArtifact,
  features: GameWinFeatureVector,
): GameWinModelPrediction {
  let logit = artifact.intercept;
  const topContributors: GameWinModelPrediction["topContributors"] = [];

  for (const feature of getGameWinFeatureNames()) {
    const mean = artifact.standardization.mean[feature] ?? 0;
    const scale = artifact.standardization.scale[feature] || 1;
    const standardized = (features[feature] - mean) / scale;
    const contribution = standardized * (artifact.coefficients[feature] ?? 0);
    logit += contribution;
    topContributors.push({
      feature,
      value: features[feature],
      contribution,
    });
  }

  let probability = sigmoid(logit);

  if (artifact.calibration?.method === "platt") {
    probability = sigmoid(artifact.calibration.intercept + artifact.calibration.slope * logit);
  }

  return {
    homeWinProbability: clamp(probability, 0.03, 0.97),
    modelVersion: artifact.version,
    modelType: "trained",
    score: logit,
    topContributors: topContributors
      .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution))
      .slice(0, 8),
  };
}

export function predictGameWinner(features: GameWinFeatureVector): GameWinModelPrediction {
  const artifact = loadArtifact();

  if (artifact && validateArtifact(artifact)) {
    return predictWithArtifact(artifact, features);
  }

  return predictWithFallback(features);
}

export function hasGameWinModelArtifact() {
  return loadArtifact() !== null;
}
