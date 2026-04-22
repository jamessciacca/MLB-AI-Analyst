import gameWinModelConfig from "../../ml/game_win_model_config.json";

import { type ExternalContext } from "@/lib/providers/provider-types";
import {
  type GameSummary,
  type GameWinFeatureVector,
  type GameWinTeamSnapshot,
  type HittingStatLine,
  type PitchingStatLine,
  type VenueSnapshot,
  type WeatherSnapshot,
} from "@/lib/types";
import { average, clamp } from "@/lib/utils";

export type GameWinFeatureName = keyof typeof gameWinModelConfig.defaults;
export type GameWinFeatureMap = Record<GameWinFeatureName, number>;

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

function withDefault(name: GameWinFeatureName, value: number | null | undefined) {
  const fallback = gameWinModelConfig.defaults[name] ?? 0;
  return Number.isFinite(value) ? Number(value) : fallback;
}

function strikeoutMinusWalkRate(stats: PitchingStatLine | null) {
  const strikeoutRate = rate(stats?.strikeOuts, stats?.battersFaced);
  const walkRate = rate(stats?.baseOnBalls, stats?.battersFaced);

  if (strikeoutRate === null || walkRate === null) {
    return null;
  }

  return strikeoutRate - walkRate;
}

function battingWalkMinusStrikeoutRate(stats: HittingStatLine | null) {
  const walkRate = rate(stats?.baseOnBalls, stats?.plateAppearances);
  const strikeoutRate = rate(stats?.strikeOuts, stats?.plateAppearances);

  if (walkRate === null || strikeoutRate === null) {
    return null;
  }

  return walkRate - strikeoutRate;
}

function isolatedPower(stats: HittingStatLine | null) {
  if (stats?.slg === null || stats?.slg === undefined || stats.avg === null || stats.avg === undefined) {
    return null;
  }

  return stats.slg - stats.avg;
}

function pitcherWorkload(stats: PitchingStatLine | null) {
  return rate(stats?.inningsPitched, stats?.gamesPlayed);
}

function starterQuality(team: GameWinTeamSnapshot) {
  const season = team.starter.season;
  const prior = team.starter.priorSeason;
  const expected = team.starter.expected ?? team.starter.priorExpected;
  const era = season?.era ?? prior?.era;
  const whip = season?.whip ?? prior?.whip;
  const avgAllowed = season?.avg ?? prior?.avg;
  const kMinusBb = strikeoutMinusWalkRate(season) ?? strikeoutMinusWalkRate(prior);
  const xera = expected?.expectedEra ?? expected?.era;
  const xwoba = expected?.expectedWoba ?? expected?.woba;

  if (!team.probablePitcher) {
    return null;
  }

  const runPrevention =
    ((4.35 - (xera ?? era ?? 4.35)) / 2.4) * 0.35 +
    ((1.3 - (whip ?? 1.3)) / 0.55) * 0.2 +
    ((0.245 - (avgAllowed ?? 0.245)) / 0.08) * 0.15 +
    (((kMinusBb ?? 0.135) - 0.135) / 0.12) * 0.2 +
    ((0.318 - (xwoba ?? 0.318)) / 0.08) * 0.1;

  return clamp(runPrevention, -1.6, 1.6);
}

function offenseQuality(team: GameWinTeamSnapshot) {
  const offense = team.offense;
  const ops = offense?.ops ?? 0.72;
  const iso = isolatedPower(offense) ?? 0.17;
  const discipline = battingWalkMinusStrikeoutRate(offense) ?? -0.14;

  return clamp(((ops - 0.72) / 0.12) * 0.55 + ((iso - 0.17) / 0.08) * 0.25 + ((discipline + 0.14) / 0.1) * 0.2, -1.5, 1.5);
}

function lineupQuality(team: GameWinTeamSnapshot, opposingStarterHand: string | null | undefined) {
  if (team.lineupPlayers.length === 0) {
    return null;
  }

  const topFive = team.lineupPlayers.filter((player) => (player.lineupSlot ?? 99) <= 5).length;
  const platoonAdvantage = opposingStarterHand
    ? team.lineupPlayers.filter(
        (player) =>
          (opposingStarterHand === "R" && player.batSide === "L") ||
          (opposingStarterHand === "L" && player.batSide === "R"),
      ).length / Math.max(team.lineupPlayers.length, 1)
    : 0.45;

  return clamp((topFive / 5 - 0.75) * 0.9 + (platoonAdvantage - 0.45) * 0.8, -0.8, 0.8);
}

function bullpenQuality(team: GameWinTeamSnapshot) {
  const kMinusBb = strikeoutMinusWalkRate(team.pitching) ?? 0.13;
  const whip = team.pitching?.whip ?? 1.3;
  const era = team.pitching?.era ?? 4.3;

  return clamp(((kMinusBb - 0.13) / 0.1) * 0.45 + ((1.3 - whip) / 0.45) * 0.3 + ((4.3 - era) / 1.5) * 0.25, -1.2, 1.2);
}

function defenseQuality(team: GameWinTeamSnapshot) {
  const oaa = team.defense?.oaa ?? 0;
  const fieldingPct = team.fielding?.fielding ?? 0.985;
  const arm = team.defense?.armOverall ?? 0;

  return clamp(oaa / 35 + (fieldingPct - 0.985) / 0.015 + arm / 25, -1.3, 1.3);
}

function recentRunDiff(team: GameWinTeamSnapshot) {
  return team.recent.runDifferentialPerGame ?? 0;
}

function recentWinPct(team: GameWinTeamSnapshot) {
  return team.recent.winPct ?? 0.5;
}

function restDays(team: GameWinTeamSnapshot) {
  return team.recent.restDays ?? 1;
}

function seasonWinProxy(team: GameWinTeamSnapshot) {
  const pitchingEra = team.pitching?.era ?? 4.3;
  const ops = team.offense?.ops ?? 0.72;
  const runLean = ((ops - 0.72) / 0.12) * 0.45 + ((4.3 - pitchingEra) / 1.5) * 0.45 + defenseQuality(team) * 0.1;

  return clamp(0.5 + runLean * 0.08, 0.32, 0.68);
}

function parkRunFactor(venue: VenueSnapshot | null) {
  if (!venue) {
    return 0;
  }

  const avgDistance =
    average([
      venue.dimensions.leftLine,
      venue.dimensions.leftCenter,
      venue.dimensions.center,
      venue.dimensions.rightCenter,
      venue.dimensions.rightLine,
    ]) ?? 378;
  const altitude = venue.elevationFeet ?? 100;
  const roofPenalty = venue.roofType?.toLowerCase().includes("dome") ? -0.02 : 0;

  return clamp(((378 - avgDistance) / 100) * 0.08 + ((altitude - 600) / 4200) * 0.12 + roofPenalty, -0.12, 0.18);
}

function weatherRunEnvironment(weather: WeatherSnapshot | null) {
  if (!weather) {
    return 0;
  }

  const temp = weather.temperatureF ?? 70;
  const wind = weather.windSpeedMph ?? 7;
  const rain = weather.precipitationProbability ?? 0;

  return clamp(((temp - 70) / 35) * 0.08 + (wind / 25) * 0.04 - (rain / 100) * 0.08, -0.1, 0.12);
}

function criticalMissingCount(home: GameWinTeamSnapshot, away: GameWinTeamSnapshot, venue: VenueSnapshot | null, weather: WeatherSnapshot | null) {
  return [
    !home.probablePitcher,
    !away.probablePitcher,
    home.lineupStatus !== "released",
    away.lineupStatus !== "released",
    !home.offense,
    !away.offense,
    !venue,
    !weather,
  ].filter(Boolean).length;
}

export function buildGameWinFeatureVector(input: {
  game: GameSummary;
  home: GameWinTeamSnapshot;
  away: GameWinTeamSnapshot;
  venue: VenueSnapshot | null;
  weather: WeatherSnapshot | null;
  externalContext?: ExternalContext | null;
}): GameWinFeatureVector {
  const homeStarterQuality = starterQuality(input.home);
  const awayStarterQuality = starterQuality(input.away);
  const homeLineupQuality = lineupQuality(input.home, input.away.probablePitcher?.pitchHand);
  const awayLineupQuality = lineupQuality(input.away, input.home.probablePitcher?.pitchHand);
  const homeBullpenFatigue = input.home.bullpen.fatigueScore ?? 0.35;
  const awayBullpenFatigue = input.away.bullpen.fatigueScore ?? 0.35;
  const vector = {
    home_starter_quality: withDefault("home_starter_quality", homeStarterQuality),
    away_starter_quality: withDefault("away_starter_quality", awayStarterQuality),
    starter_quality_diff: withDefault("starter_quality_diff", (homeStarterQuality ?? 0) - (awayStarterQuality ?? 0)),
    starter_workload_diff: withDefault("starter_workload_diff", (pitcherWorkload(input.home.starter.season) ?? pitcherWorkload(input.home.starter.priorSeason) ?? 5) - (pitcherWorkload(input.away.starter.season) ?? pitcherWorkload(input.away.starter.priorSeason) ?? 5)),
    home_starter_missing: input.home.probablePitcher ? 0 : 1,
    away_starter_missing: input.away.probablePitcher ? 0 : 1,
    offense_ops_diff: withDefault("offense_ops_diff", (input.home.offense?.ops ?? 0.72) - (input.away.offense?.ops ?? 0.72)),
    offense_power_diff: withDefault("offense_power_diff", (isolatedPower(input.home.offense) ?? 0.17) - (isolatedPower(input.away.offense) ?? 0.17)),
    offense_plate_discipline_diff: withDefault("offense_plate_discipline_diff", (battingWalkMinusStrikeoutRate(input.home.offense) ?? -0.14) - (battingWalkMinusStrikeoutRate(input.away.offense) ?? -0.14)),
    lineup_quality_diff: withDefault("lineup_quality_diff", (homeLineupQuality ?? offenseQuality(input.home) * 0.25) - (awayLineupQuality ?? offenseQuality(input.away) * 0.25)),
    lineup_confirmed: input.home.lineupStatus === "released" && input.away.lineupStatus === "released" ? 1 : 0,
    bullpen_quality_diff: withDefault("bullpen_quality_diff", bullpenQuality(input.home) - bullpenQuality(input.away)),
    bullpen_fatigue_diff: withDefault("bullpen_fatigue_diff", awayBullpenFatigue - homeBullpenFatigue),
    defense_oaa_diff: withDefault("defense_oaa_diff", (input.home.defense?.oaa ?? 0) - (input.away.defense?.oaa ?? 0)),
    fielding_pct_diff: withDefault("fielding_pct_diff", (input.home.fielding?.fielding ?? 0.985) - (input.away.fielding?.fielding ?? 0.985)),
    recent_win_pct_diff: withDefault("recent_win_pct_diff", recentWinPct(input.home) - recentWinPct(input.away)),
    recent_run_diff_per_game_diff: withDefault("recent_run_diff_per_game_diff", recentRunDiff(input.home) - recentRunDiff(input.away)),
    season_win_pct_diff: withDefault("season_win_pct_diff", seasonWinProxy(input.home) - seasonWinProxy(input.away)),
    rest_days_diff: withDefault("rest_days_diff", restDays(input.home) - restDays(input.away)),
    home_field: 1,
    park_run_factor: withDefault("park_run_factor", parkRunFactor(input.venue)),
    weather_run_environment: withDefault("weather_run_environment", weatherRunEnvironment(input.weather)),
    is_day_game: withDefault("is_day_game", input.externalContext?.features.isDayGame),
    is_night_game: withDefault("is_night_game", input.externalContext?.features.isNightGame),
    is_twilight_start: withDefault("is_twilight_start", input.externalContext?.features.isTwilightStart),
    first_pitch_minutes_from_sunset: withDefault(
      "first_pitch_minutes_from_sunset",
      input.externalContext?.features.firstPitchMinutesFromSunset,
    ),
    day_length_minutes: withDefault("day_length_minutes", input.externalContext?.features.dayLengthMinutes),
    weather_severity_score: withDefault("weather_severity_score", input.externalContext?.features.weatherSeverityScore),
    weather_boost_for_hr: withDefault("weather_boost_for_hr", input.externalContext?.features.weatherBoostForHR),
    weather_penalty_for_pitchers: withDefault(
      "weather_penalty_for_pitchers",
      input.externalContext?.features.weatherPenaltyForPitchers,
    ),
    market_implied_home_win_prob: withDefault(
      "market_implied_home_win_prob",
      input.externalContext?.features.marketImpliedHomeWinProb,
    ),
    market_implied_away_win_prob: withDefault(
      "market_implied_away_win_prob",
      input.externalContext?.features.marketImpliedAwayWinProb,
    ),
    lineup_uncertainty_score: withDefault(
      "lineup_uncertainty_score",
      input.externalContext?.features.lineupUncertaintyScore,
    ),
    injury_uncertainty_score: withDefault(
      "injury_uncertainty_score",
      input.externalContext?.features.injuryUncertaintyScore,
    ),
    external_data_completeness_score: withDefault(
      "external_data_completeness_score",
      input.externalContext?.features.externalDataCompletenessScore,
    ),
    critical_missing_count: withDefault("critical_missing_count", criticalMissingCount(input.home, input.away, input.venue, input.weather)),
  } satisfies GameWinFeatureVector;

  return vector;
}

export function getGameWinFeatureNames() {
  return gameWinModelConfig.featureNames as GameWinFeatureName[];
}

export function gameWinFeatureDefaults() {
  return gameWinModelConfig.defaults as Record<GameWinFeatureName, number>;
}
