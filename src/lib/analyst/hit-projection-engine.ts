import { clamp } from "../utils.ts";

import {
  type AnalystAtBatQualitySummary,
  type AnalystHitProjectionBreakdown,
  type AnalystLast10Summary,
  type AnalystSimulationSummary,
} from "./types.ts";
import { getHitProjectionWeights } from "./hit-projection-weights.ts";
import { normalizeAtBatQualityScore } from "./at-bat-quality-service.ts";

function normalizeRecentResultScore(last10Summary: AnalystLast10Summary | null) {
  if (!last10Summary || last10Summary.games.length === 0) {
    return 0.5;
  }

  const totalAtBats = last10Summary.games.reduce((sum, game) => sum + game.atBats, 0);
  const totalHits = last10Summary.games.reduce((sum, game) => sum + game.hits, 0);
  const hitRate = totalAtBats > 0 ? totalHits / totalAtBats : 0.245;
  const hitGamesRate = last10Summary.hitGames / Math.max(last10Summary.gamesAnalyzed, 1);

  return clamp(hitRate * 1.55 + hitGamesRate * 0.32, 0.05, 0.95);
}

function normalizeRecentTrendScore(quality: AnalystAtBatQualitySummary | null) {
  if (!quality) {
    return 0.5;
  }

  const last5 = normalizeAtBatQualityScore(quality.last5 ?? 0);
  const last10 = normalizeAtBatQualityScore(quality.last10 ?? 0);
  const delta = last5 - last10;

  return clamp(0.5 + delta * 0.9, 0.05, 0.95);
}

export function buildHitProjection(input: {
  seasonBaselineProbability: number;
  pitcherMatchupScore: number;
  last10Summary: AnalystLast10Summary | null;
  atBatQualitySummary: AnalystAtBatQualitySummary | null;
  simulationSummary: AnalystSimulationSummary | null;
  environmentScore: number;
  feedbackCalibrationScore: number;
}) {
  const weights = getHitProjectionWeights();
  const last10Results = normalizeRecentResultScore(input.last10Summary);
  const last10AtBatQuality = normalizeAtBatQualityScore(
    input.atBatQualitySummary?.last10 ?? 0,
  );
  const recentTrendLast5 = normalizeRecentTrendScore(input.atBatQualitySummary);
  const simulationResult =
    input.simulationSummary?.simulatedHitProbability ?? input.seasonBaselineProbability;
  const finalProbability = clamp(
    input.seasonBaselineProbability * weights.seasonBaseline +
      last10Results * weights.last10Results +
      last10AtBatQuality * weights.last10AtBatQuality +
      recentTrendLast5 * weights.recentTrendLast5 +
      input.pitcherMatchupScore * weights.pitcherMatchup +
      simulationResult * weights.simulationResult +
      input.environmentScore * weights.environment,
    0.01,
    0.99,
  );
  const blendedWithCalibration = clamp(
    finalProbability * 0.94 + input.feedbackCalibrationScore * 0.06,
    0.01,
    0.99,
  );
  const breakdown: AnalystHitProjectionBreakdown = {
    seasonBaseline: input.seasonBaselineProbability,
    last10Results,
    last10AtBatQuality,
    recentTrendLast5,
    pitcherMatchup: input.pitcherMatchupScore,
    simulationResult,
    environment: input.environmentScore,
    feedbackCalibration: input.feedbackCalibrationScore,
  };

  return {
    finalProbability: blendedWithCalibration,
    breakdown,
    weights,
  };
}
