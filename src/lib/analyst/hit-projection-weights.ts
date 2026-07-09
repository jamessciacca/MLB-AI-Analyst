import { clamp } from "../utils.ts";

export interface HitProjectionWeights {
  seasonBaseline: number;
  last10Results: number;
  last10AtBatQuality: number;
  recentTrendLast5: number;
  pitcherMatchup: number;
  simulationResult: number;
  environment: number;
}

export const HIT_PROJECTION_DEFAULT_WEIGHTS: HitProjectionWeights = {
  seasonBaseline: 0.2,
  last10Results: 0.15,
  last10AtBatQuality: 0.2,
  recentTrendLast5: 0.1,
  pitcherMatchup: 0.15,
  simulationResult: 0.15,
  environment: 0.05,
};

function envWeight(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(value, 0) : fallback;
}

export function getHitProjectionWeights(): HitProjectionWeights {
  const raw: HitProjectionWeights = {
    seasonBaseline: envWeight(
      "HIT_PROJECTION_WEIGHT_SEASON_BASELINE",
      HIT_PROJECTION_DEFAULT_WEIGHTS.seasonBaseline,
    ),
    last10Results: envWeight(
      "HIT_PROJECTION_WEIGHT_LAST10_RESULTS",
      HIT_PROJECTION_DEFAULT_WEIGHTS.last10Results,
    ),
    last10AtBatQuality: envWeight(
      "HIT_PROJECTION_WEIGHT_LAST10_AT_BAT_QUALITY",
      HIT_PROJECTION_DEFAULT_WEIGHTS.last10AtBatQuality,
    ),
    recentTrendLast5: envWeight(
      "HIT_PROJECTION_WEIGHT_RECENT_TREND_LAST5",
      HIT_PROJECTION_DEFAULT_WEIGHTS.recentTrendLast5,
    ),
    pitcherMatchup: envWeight(
      "HIT_PROJECTION_WEIGHT_PITCHER_MATCHUP",
      HIT_PROJECTION_DEFAULT_WEIGHTS.pitcherMatchup,
    ),
    simulationResult: envWeight(
      "HIT_PROJECTION_WEIGHT_SIMULATION_RESULT",
      HIT_PROJECTION_DEFAULT_WEIGHTS.simulationResult,
    ),
    environment: envWeight(
      "HIT_PROJECTION_WEIGHT_ENVIRONMENT",
      HIT_PROJECTION_DEFAULT_WEIGHTS.environment,
    ),
  };
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0);

  if (total <= 0) {
    return HIT_PROJECTION_DEFAULT_WEIGHTS;
  }

  return {
    seasonBaseline: clamp(raw.seasonBaseline / total, 0, 1),
    last10Results: clamp(raw.last10Results / total, 0, 1),
    last10AtBatQuality: clamp(raw.last10AtBatQuality / total, 0, 1),
    recentTrendLast5: clamp(raw.recentTrendLast5 / total, 0, 1),
    pitcherMatchup: clamp(raw.pitcherMatchup / total, 0, 1),
    simulationResult: clamp(raw.simulationResult / total, 0, 1),
    environment: clamp(raw.environment / total, 0, 1),
  };
}
