import modelConfig from "../../../ml/model_config.json" with { type: "json" };

import { type AnalysisResult } from "../types.ts";
import { clamp } from "../utils.ts";

export type PredictionFeatureSnapshot = Record<string, number>;

const FEATURE_DEFAULTS = modelConfig.defaults as Record<string, number>;
const FEATURE_NAMES = modelConfig.featureNames as string[];

function safeNumber(value: number | null | undefined, fallback: number) {
  return value === null || value === undefined || !Number.isFinite(value) ? fallback : value;
}

function safeRate(numerator: number | null | undefined, denominator: number | null | undefined) {
  if (!numerator || !denominator || denominator <= 0) {
    return null;
  }

  return numerator / denominator;
}

function recentSummary(result: AnalysisResult) {
  const games = result.hitter.recentGames.slice(0, 10);
  const atBats = games.reduce((total, game) => total + game.atBats, 0);
  const hits = games.reduce((total, game) => total + game.hits, 0);
  const homeRuns = games.reduce((total, game) => total + game.homeRuns, 0);
  const hitGames = games.filter((game) => game.hits > 0).length;

  return {
    games: games.length,
    atBats,
    hits,
    homeRuns,
    hitRate: atBats > 0 ? hits / atBats : null,
    hitsPerGame: games.length > 0 ? hits / games.length : null,
    homeRunRate: atBats > 0 ? homeRuns / atBats : null,
    hitGameRate: games.length > 0 ? hitGames / games.length : null,
  };
}

export function buildPredictionFeatureSnapshot(result: AnalysisResult): PredictionFeatureSnapshot {
  const features = Object.fromEntries(
    FEATURE_NAMES.map((feature) => [feature, FEATURE_DEFAULTS[feature] ?? 0]),
  ) as PredictionFeatureSnapshot;
  const recent = recentSummary(result);
  const hitterSeason = result.hitter.season;
  const hitterExpected = result.hitter.expected;
  const pitcherSeason = result.pitcher.season;
  const pitcherExpected = result.pitcher.expected;
  const pitcherHand = result.pitcher.player?.pitchHand;
  const hitterTeamId = result.hitter.player.currentTeamId;
  const isHome =
    hitterTeamId !== null &&
    hitterTeamId !== undefined &&
    hitterTeamId === result.game.homeTeam.id;
  const hitContext = result.hitGameContext;

  features.batter_avg = safeNumber(hitterSeason?.avg, features.batter_avg);
  features.batter_obp = safeNumber(hitterSeason?.obp, features.batter_obp);
  features.batter_slg = safeNumber(hitterSeason?.slg, features.batter_slg);
  features.batter_ops = safeNumber(hitterSeason?.ops, features.batter_ops);
  features.batter_xba = safeNumber(
    hitterExpected?.expectedBattingAverage ?? hitterExpected?.battingAverage,
    features.batter_xba,
  );
  features.batter_xwoba = safeNumber(
    hitterExpected?.expectedWoba ?? hitterExpected?.woba,
    features.batter_xwoba,
  );
  features.batter_k_rate = safeNumber(
    safeRate(hitterSeason?.strikeOuts, hitterSeason?.plateAppearances),
    features.batter_k_rate,
  );
  features.batter_bb_rate = safeNumber(
    safeRate(hitterSeason?.baseOnBalls, hitterSeason?.plateAppearances),
    features.batter_bb_rate,
  );
  features.batter_vs_pitcher_hand_rate = safeNumber(
    result.batterVsPitcher?.battingAverage,
    features.batter_vs_pitcher_hand_rate,
  );
  features.recent5_hit_rate = safeNumber(recent.hitRate, features.recent5_hit_rate);
  features.recent5_hits_per_game = safeNumber(recent.hitsPerGame, features.recent5_hits_per_game);
  features.recent5_hr_rate = safeNumber(recent.homeRunRate, features.recent5_hr_rate);

  features.pitcher_avg_allowed = safeNumber(pitcherSeason?.avg, features.pitcher_avg_allowed);
  features.pitcher_whip = safeNumber(pitcherSeason?.whip, features.pitcher_whip);
  features.pitcher_k_rate = safeNumber(
    safeRate(pitcherSeason?.strikeOuts, pitcherSeason?.battersFaced),
    features.pitcher_k_rate,
  );
  features.pitcher_bb_rate = safeNumber(
    safeRate(pitcherSeason?.baseOnBalls, pitcherSeason?.battersFaced),
    features.pitcher_bb_rate,
  );
  features.pitcher_xba_allowed = safeNumber(
    pitcherExpected?.expectedBattingAverage ?? pitcherExpected?.battingAverage,
    features.pitcher_xba_allowed,
  );
  features.pitcher_xwoba_allowed = safeNumber(
    pitcherExpected?.expectedWoba ?? pitcherExpected?.woba,
    features.pitcher_xwoba_allowed,
  );
  features.pitcher_throws_left = pitcherHand === "L" ? 1 : 0;

  features.lineup_slot = safeNumber(result.hitter.lineupSlot, features.lineup_slot);
  features.projected_abs = safeNumber(result.probabilities.expectedAtBats, features.projected_abs);
  features.is_home = isHome ? 1 : 0;
  features.weather_temp_f = safeNumber(result.weather?.temperatureF, features.weather_temp_f);
  features.weather_precip_pct = safeNumber(
    result.weather?.precipitationProbability,
    features.weather_precip_pct,
  );
  features.opponent_defense_oaa = safeNumber(result.defense?.oaa, features.opponent_defense_oaa);
  features.opponent_fielding_pct = safeNumber(
    result.defense?.fieldingPct,
    features.opponent_fielding_pct,
  );

  if (hitContext?.enabled) {
    features.hitter_team_win_probability = hitContext.hitterTeamWinProbability;
    features.opponent_team_win_probability = hitContext.opponentTeamWinProbability;
    features.win_probability_gap = hitContext.winProbabilityGap;
    features.hitter_team_is_favorite = hitContext.hitterTeamIsFavorite;
    features.hitter_team_is_underdog = hitContext.hitterTeamIsUnderdog;
    features.hitter_team_implied_runs = hitContext.hitterTeamImpliedRuns;
    features.opponent_team_implied_runs = hitContext.opponentTeamImpliedRuns;
    features.game_total_runs = hitContext.gameTotalRuns;
    features.run_total_gap = hitContext.runTotalGap;
    features.hitter_team_share_of_total_runs = hitContext.hitterTeamShareOfTotalRuns;
    features.game_competitiveness_score = hitContext.gameCompetitivenessScore;
    features.blowout_risk_score = hitContext.blowoutRiskScore;
    features.offensive_suppression_risk = hitContext.offensiveSuppressionRisk;
    features.offensive_support_score = hitContext.offensiveSupportScore;
    features.hit_context_boost = hitContext.hitContextBoost;
    features.hit_context_penalty = hitContext.hitContextPenalty;
    features.expected_plate_appearance_environment =
      hitContext.expectedPlateAppearanceEnvironment;
    features.hitter_team_run_support_index = hitContext.hitterTeamRunSupportIndex;
  }

  return Object.fromEntries(
    FEATURE_NAMES.map((feature) => [
      feature,
      clamp(safeNumber(features[feature], FEATURE_DEFAULTS[feature] ?? 0), -1000, 1000),
    ]),
  ) as PredictionFeatureSnapshot;
}

export function getPredictionFeatureNames() {
  return [...FEATURE_NAMES];
}
