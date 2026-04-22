import modelConfig from "../../ml/model_config.json";

import { type AnalysisModelInput, type StatcastEventRow } from "@/lib/types";
import { average, clamp } from "@/lib/utils";

const HIT_EVENTS = new Set(["single", "double", "triple", "home_run"]);
const NON_AT_BAT_EVENTS = new Set([
  "walk",
  "intentional_walk",
  "hit_by_pitch",
  "sac_fly",
  "sac_bunt",
  "catcher_interf",
]);

export type MlHitFeatureName = keyof typeof modelConfig.defaults;
export type MlHitFeatureVector = Record<MlHitFeatureName, number>;

function isAtBatEvent(event: string | null) {
  return Boolean(event) && !NON_AT_BAT_EVENTS.has(event ?? "");
}

function rate(numerator: number | null | undefined, denominator: number | null | undefined) {
  if (
    numerator === null ||
    numerator === undefined ||
    denominator === null ||
    denominator === undefined ||
    denominator <= 0
  ) {
    return null;
  }

  return numerator / denominator;
}

function hardHitRate(rows: StatcastEventRow[]) {
  const tracked = rows.filter((row) => row.launchSpeed !== null);

  if (tracked.length === 0) {
    return null;
  }

  return tracked.filter((row) => (row.launchSpeed ?? 0) >= 95).length / tracked.length;
}

function outcomeRate(rows: StatcastEventRow[]) {
  const atBats = rows.filter((row) => row.events && isAtBatEvent(row.events));

  if (atBats.length === 0) {
    return null;
  }

  return atBats.filter((row) => HIT_EVENTS.has(row.events ?? "")).length / atBats.length;
}

function recentGameSummary(input: AnalysisModelInput["hitter"]["recentGames"]) {
  const games = Math.max(input.length, 1);
  const atBats = input.reduce((sum, game) => sum + game.atBats, 0);
  const hits = input.reduce((sum, game) => sum + game.hits, 0);
  const homeRuns = input.reduce((sum, game) => sum + game.homeRuns, 0);

  return {
    hitRate: atBats > 0 ? hits / atBats : null,
    hitsPerGame: hits / games,
    homeRunRate: atBats > 0 ? homeRuns / atBats : null,
  };
}

function estimateProjectedAbs(input: AnalysisModelInput) {
  const lineupBase =
    input.hitter.lineupSlot
      ? {
          1: 4.15,
          2: 4.08,
          3: 4.0,
          4: 3.92,
          5: 3.82,
          6: 3.72,
          7: 3.62,
          8: 3.52,
          9: 3.42,
        }[input.hitter.lineupSlot] ?? 3.8
      : 3.8;
  const seasonAbs =
    rate(input.hitter.season?.atBats, input.hitter.season?.gamesPlayed) ??
    rate(input.hitter.priorSeason?.atBats, input.hitter.priorSeason?.gamesPlayed);
  const isHome = input.hitter.player.currentTeamId === input.game.homeTeam.id;

  return clamp((seasonAbs ?? lineupBase) * 0.35 + lineupBase * 0.65 + (isHome ? -0.04 : 0.04), 3.05, 5.05);
}

function parkHitFactor(input: AnalysisModelInput) {
  if (!input.venue) {
    return 0;
  }

  const avgDistance =
    average([
      input.venue.dimensions.leftLine,
      input.venue.dimensions.leftCenter,
      input.venue.dimensions.center,
      input.venue.dimensions.rightCenter,
      input.venue.dimensions.rightLine,
    ]) ?? 378;
  const turfBoost = input.venue.turfType && !input.venue.turfType.toLowerCase().includes("grass") ? 0.004 : 0;

  return clamp(((avgDistance - 378) / 120) * 0.018 + turfBoost, -0.02, 0.02);
}

function withDefault(name: MlHitFeatureName, value: number | null | undefined) {
  const fallback = modelConfig.defaults[name] ?? 0;

  return Number.isFinite(value) ? Number(value) : fallback;
}

/**
 * Builds the exact feature vector used by the exported logistic-regression model.
 *
 * The function intentionally uses only pregame/context values already present in
 * AnalysisModelInput. Same-game outcomes are not part of this object, which keeps
 * app inference aligned with the anti-leakage rule used by training.
 */
export function buildMlHitFeatureVector(input: AnalysisModelInput): MlHitFeatureVector {
  const pitcherHand = input.pitcher.player?.pitchHand ?? null;
  const batterVsHandRows = pitcherHand
    ? input.hitter.events.filter((row) => row.pitcherThrows === pitcherHand)
    : input.hitter.events;
  const pitcherVsBatterRows = input.hitter.player.batSide
    ? input.pitcher.events.filter((row) => row.batterStand === input.hitter.player.batSide)
    : input.pitcher.events;
  const recent = recentGameSummary(input.hitter.recentGames);
  const batterHardHit = hardHitRate(input.hitter.events);
  const pitcherHardHit = hardHitRate(pitcherVsBatterRows);
  const batterXwoba = input.hitter.expected?.expectedWoba ?? input.hitter.expected?.woba;
  const pitcherXwoba = input.pitcher.expected?.expectedWoba ?? input.pitcher.expected?.woba;
  const projectedAbs = estimateProjectedAbs(input);
  const isHome = input.hitter.player.currentTeamId === input.game.homeTeam.id ? 1 : 0;

  const vector = {
    batter_avg: withDefault("batter_avg", input.hitter.season?.avg ?? input.hitter.priorSeason?.avg),
    batter_obp: withDefault("batter_obp", input.hitter.season?.obp ?? input.hitter.priorSeason?.obp),
    batter_slg: withDefault("batter_slg", input.hitter.season?.slg ?? input.hitter.priorSeason?.slg),
    batter_ops: withDefault("batter_ops", input.hitter.season?.ops ?? input.hitter.priorSeason?.ops),
    batter_xba: withDefault(
      "batter_xba",
      input.hitter.expected?.expectedBattingAverage ?? input.hitter.expected?.battingAverage,
    ),
    batter_xwoba: withDefault("batter_xwoba", batterXwoba),
    batter_k_rate: withDefault(
      "batter_k_rate",
      rate(input.hitter.season?.strikeOuts, input.hitter.season?.plateAppearances),
    ),
    batter_bb_rate: withDefault(
      "batter_bb_rate",
      rate(input.hitter.season?.baseOnBalls, input.hitter.season?.plateAppearances),
    ),
    batter_hard_hit_rate: withDefault("batter_hard_hit_rate", batterHardHit),
    batter_vs_pitcher_hand_rate: withDefault("batter_vs_pitcher_hand_rate", outcomeRate(batterVsHandRows)),
    recent5_hit_rate: withDefault("recent5_hit_rate", recent.hitRate),
    recent5_hits_per_game: withDefault("recent5_hits_per_game", recent.hitsPerGame),
    recent5_hr_rate: withDefault("recent5_hr_rate", recent.homeRunRate),
    pitcher_avg_allowed: withDefault(
      "pitcher_avg_allowed",
      input.pitcher.season?.avg ?? input.pitcher.priorSeason?.avg,
    ),
    pitcher_whip: withDefault("pitcher_whip", input.pitcher.season?.whip ?? input.pitcher.priorSeason?.whip),
    pitcher_k_rate: withDefault(
      "pitcher_k_rate",
      rate(input.pitcher.season?.strikeOuts, input.pitcher.season?.battersFaced),
    ),
    pitcher_bb_rate: withDefault(
      "pitcher_bb_rate",
      rate(input.pitcher.season?.baseOnBalls, input.pitcher.season?.battersFaced),
    ),
    pitcher_xba_allowed: withDefault(
      "pitcher_xba_allowed",
      input.pitcher.expected?.expectedBattingAverage ?? input.pitcher.expected?.battingAverage,
    ),
    pitcher_xwoba_allowed: withDefault("pitcher_xwoba_allowed", pitcherXwoba),
    pitcher_hard_hit_allowed: withDefault("pitcher_hard_hit_allowed", pitcherHardHit),
    pitcher_throws_left: pitcherHand === "L" ? 1 : 0,
    lineup_slot: withDefault("lineup_slot", input.hitter.lineupSlot),
    projected_abs: projectedAbs,
    is_home: isHome,
    park_hit_factor: parkHitFactor(input),
    weather_temp_f: withDefault("weather_temp_f", input.weather?.temperatureF),
    weather_precip_pct: withDefault("weather_precip_pct", input.weather?.precipitationProbability),
    opponent_defense_oaa: withDefault("opponent_defense_oaa", input.defense?.oaa),
    opponent_fielding_pct: withDefault("opponent_fielding_pct", input.defense?.fieldingPct),
    contact_quality_matchup: withDefault(
      "contact_quality_matchup",
      (batterHardHit ?? modelConfig.defaults.batter_hard_hit_rate) -
        (pitcherHardHit ?? modelConfig.defaults.pitcher_hard_hit_allowed),
    ),
  } satisfies MlHitFeatureVector;

  return vector;
}

export function getMlHitFeatureNames() {
  return modelConfig.featureNames as MlHitFeatureName[];
}
