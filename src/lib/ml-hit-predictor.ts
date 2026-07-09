import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import modelConfig from "../../ml/model_config.json" with { type: "json" };

import {
  buildMlHitFeatureVector,
  getMlHitFeatureNames,
  type MlHitFeatureName,
} from "./ml-hit-features.ts";
import { type AnalysisModelInput } from "./types.ts";
import { clamp } from "./utils.ts";

type MlHitModelArtifact = {
  modelType: "regularized_logistic_regression";
  version: string;
  trainedAt: string;
  featureNames: MlHitFeatureName[];
  intercept: number;
  coefficients: Record<MlHitFeatureName, number>;
  standardization: {
    mean: Record<MlHitFeatureName, number>;
    scale: Record<MlHitFeatureName, number>;
  };
  calibration?: {
    method: "platt";
    intercept: number;
    slope: number;
  };
  metrics?: Record<string, number>;
};

export type MlHitPrediction = {
  probability1PlusHit: number;
  expectedHits: number;
  probability2PlusHits: number;
  inferredPerAtBat: number;
  modelVersion: string;
  usesGameContextFeatures: boolean;
  topContributors: Array<{
    feature: MlHitFeatureName;
    value: number;
    contribution: number;
  }>;
};

let cachedArtifact: MlHitModelArtifact | null | undefined;
const MODEL_ARTIFACT_PATH = path.join(process.cwd(), "ml", "artifacts", "hit_model.json");

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value));
}

function inferPerAtBatFromOnePlus(probability: number, projectedAtBats: number) {
  if (projectedAtBats <= 0) {
    return 0;
  }

  return clamp(1 - (1 - probability) ** (1 / projectedAtBats), 0.05, 0.55);
}

function probabilityAtLeastTwo(perAtBat: number, projectedAtBats: number) {
  const noHits = (1 - perAtBat) ** projectedAtBats;
  const exactlyOne = projectedAtBats * perAtBat * (1 - perAtBat) ** Math.max(projectedAtBats - 1, 0);

  return clamp(1 - noHits - exactlyOne, 0, 1);
}

function loadArtifact() {
  if (cachedArtifact !== undefined) {
    return cachedArtifact;
  }

  if (!existsSync(MODEL_ARTIFACT_PATH)) {
    cachedArtifact = null;
    return cachedArtifact;
  }

  cachedArtifact = JSON.parse(readFileSync(MODEL_ARTIFACT_PATH, "utf8")) as MlHitModelArtifact;
  return cachedArtifact;
}

function isFiniteRecordValue(record: Record<string, number>, key: string) {
  return Number.isFinite(record[key]);
}

export function isUsableMlHitModelArtifact(artifact: MlHitModelArtifact) {
  const expected = getMlHitFeatureNames();
  const hasExpectedFeatures = expected.every((feature) => artifact.featureNames.includes(feature));
  const hasModelSignal = expected.some(
    (feature) => Math.abs(artifact.coefficients[feature] ?? 0) > 1e-9,
  );
  const hasValidStandardization = expected.every(
    (feature) =>
      isFiniteRecordValue(artifact.standardization.mean, feature) &&
      isFiniteRecordValue(artifact.standardization.scale, feature) &&
      artifact.standardization.scale[feature] !== 0,
  );
  const hasValidCalibration =
    !artifact.calibration ||
    (artifact.calibration.method === "platt" &&
      Number.isFinite(artifact.calibration.intercept) &&
      Number.isFinite(artifact.calibration.slope));

  return (
    hasExpectedFeatures &&
    hasModelSignal &&
    Number.isFinite(artifact.intercept) &&
    hasValidStandardization &&
    hasValidCalibration
  );
}

const GAME_CONTEXT_FEATURE_NAMES: MlHitFeatureName[] = [
  "hitter_team_win_probability",
  "opponent_team_win_probability",
  "win_probability_gap",
  "hitter_team_is_favorite",
  "hitter_team_is_underdog",
  "hitter_team_implied_runs",
  "opponent_team_implied_runs",
  "game_total_runs",
  "run_total_gap",
  "hitter_team_share_of_total_runs",
  "game_competitiveness_score",
  "blowout_risk_score",
  "offensive_suppression_risk",
  "offensive_support_score",
  "hit_context_boost",
  "hit_context_penalty",
  "expected_plate_appearance_environment",
  "hitter_team_run_support_index",
];

function artifactUsesGameContextFeatures(artifact: MlHitModelArtifact) {
  return GAME_CONTEXT_FEATURE_NAMES.some((feature) => artifact.featureNames.includes(feature));
}

/**
 * Scores a hitter/game context with the exported logistic-regression model.
 *
 * Training happens offline in Python, then the learned coefficients, intercept,
 * standardization parameters, and optional calibration transform are exported to
 * JSON. Inference stays in TypeScript so the existing Next.js API does not need
 * to spawn Python per request.
 */
export function predictHitWithMl(input: AnalysisModelInput): MlHitPrediction | null {
  const artifact = loadArtifact();

  if (!artifact || !isUsableMlHitModelArtifact(artifact)) {
    return null;
  }

  const features = buildMlHitFeatureVector(input);
  let logit = artifact.intercept;
  const contributions: MlHitPrediction["topContributors"] = [];

  for (const feature of getMlHitFeatureNames()) {
    const mean = artifact.standardization.mean[feature] ?? 0;
    const scale = artifact.standardization.scale[feature] || 1;
    const standardized = (features[feature] - mean) / scale;
    const contribution = standardized * (artifact.coefficients[feature] ?? 0);
    logit += contribution;
    contributions.push({
      feature,
      value: features[feature],
      contribution,
    });
  }

  let probability = sigmoid(logit);

  if (artifact.calibration?.method === "platt") {
    probability = sigmoid(artifact.calibration.intercept + artifact.calibration.slope * logit);
  }

  const projectedAtBats = clamp(features.projected_abs, 3.05, 5.05);
  const inferredPerAtBat = inferPerAtBatFromOnePlus(probability, projectedAtBats);

  return {
    probability1PlusHit: clamp(probability, 0.01, 0.98),
    expectedHits: projectedAtBats * inferredPerAtBat,
    probability2PlusHits: probabilityAtLeastTwo(inferredPerAtBat, projectedAtBats),
    inferredPerAtBat,
    modelVersion: artifact.version,
    usesGameContextFeatures: artifactUsesGameContextFeatures(artifact),
    topContributors: contributions
      .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution))
      .slice(0, 5),
  };
}

export function hasMlHitModelArtifact() {
  return loadArtifact() !== null;
}
