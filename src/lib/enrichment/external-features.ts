import {
  type ExternalContext,
  type ExternalDerivedFeatures,
  type NormalizedDaylightContext,
  type NormalizedOddsContext,
  type NormalizedVenueContext,
  type NormalizedWeatherContext,
} from "@/lib/providers/provider-types";
import { clamp } from "@/lib/utils";

export function americanOddsToImpliedProbability(americanOdds: number | null) {
  if (americanOdds === null || !Number.isFinite(americanOdds) || americanOdds === 0) {
    return null;
  }

  return americanOdds > 0
    ? 100 / (americanOdds + 100)
    : Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
}

export function normalizeOddsContext(odds: NormalizedOddsContext | null) {
  if (!odds) {
    return null;
  }

  const home = americanOddsToImpliedProbability(odds.homeMoneyline);
  const away = americanOddsToImpliedProbability(odds.awayMoneyline);
  const total = (home ?? 0) + (away ?? 0);

  return {
    ...odds,
    marketImpliedHomeWinProb: home,
    marketImpliedAwayWinProb: away,
    noVigHomeWinProb: home !== null && away !== null && total > 0 ? home / total : null,
    noVigAwayWinProb: home !== null && away !== null && total > 0 ? away / total : null,
  };
}

export function weatherSeverityScore(weather: NormalizedWeatherContext | null) {
  if (!weather) {
    return 0;
  }

  const rain = (weather.precipitationProbability ?? 0) / 100;
  const wind = (weather.windSpeedMph ?? 0) / 25;
  const cold = Math.max(0, 55 - (weather.temperatureF ?? 70)) / 35;
  const heat = Math.max(0, (weather.temperatureF ?? 70) - 88) / 25;

  return clamp(rain * 0.45 + wind * 0.25 + cold * 0.15 + heat * 0.1, 0, 1);
}

export function weatherBoostForHomeRuns(weather: NormalizedWeatherContext | null) {
  if (!weather) {
    return 0;
  }

  const tempBoost = ((weather.temperatureF ?? 70) - 70) / 50;
  const windBoost = ((weather.windSpeedMph ?? 7) - 7) / 35;
  const rainPenalty = ((weather.precipitationProbability ?? 0) / 100) * 0.35;

  return clamp(tempBoost * 0.08 + windBoost * 0.04 - rainPenalty, -0.08, 0.1);
}

export function weatherPenaltyForPitchers(weather: NormalizedWeatherContext | null) {
  if (!weather) {
    return 0;
  }

  return clamp(
    weatherSeverityScore(weather) * 0.09 +
      Math.max(0, ((weather.temperatureF ?? 70) - 88) / 40) * 0.04,
    0,
    0.14,
  );
}

export function buildExternalDerivedFeatures(input: {
  venue: NormalizedVenueContext | null;
  weather: NormalizedWeatherContext | null;
  daylight: NormalizedDaylightContext | null;
  odds: NormalizedOddsContext | null;
  missingFields: string[];
  injuryCount: number;
  lineupStatus?: "released" | "partial" | "pending";
}): ExternalDerivedFeatures {
  const completenessTotal = 6;
  const present = [
    input.venue?.latitude !== null && input.venue?.longitude !== null,
    Boolean(input.weather),
    Boolean(input.daylight),
    Boolean(input.odds?.marketImpliedHomeWinProb),
    input.injuryCount === 0 || input.injuryCount > 0,
    input.lineupStatus === "released",
  ].filter(Boolean).length;

  return {
    isDayGame: input.daylight?.isDayGame ? 1 : 0,
    isNightGame: input.daylight?.isNightGame ? 1 : 0,
    isTwilightStart: input.daylight?.isTwilightStart ? 1 : 0,
    firstPitchMinutesFromSunset: input.daylight?.firstPitchMinutesFromSunset ?? null,
    dayLengthMinutes: input.daylight?.dayLengthMinutes ?? null,
    stadiumLat: input.venue?.latitude ?? null,
    stadiumLon: input.venue?.longitude ?? null,
    windOutToCFApprox: null,
    weatherSeverityScore: weatherSeverityScore(input.weather),
    weatherBoostForHR: weatherBoostForHomeRuns(input.weather),
    weatherPenaltyForPitchers: weatherPenaltyForPitchers(input.weather),
    marketImpliedHomeWinProb: input.odds?.marketImpliedHomeWinProb ?? null,
    marketImpliedAwayWinProb: input.odds?.marketImpliedAwayWinProb ?? null,
    lineupUncertaintyScore:
      input.lineupStatus === "released" ? 0 : input.lineupStatus === "partial" ? 0.4 : 0.75,
    injuryUncertaintyScore: clamp(input.injuryCount * 0.08, 0, 0.5),
    externalDataCompletenessScore: clamp(present / completenessTotal, 0, 1),
  };
}

export function getExternalContextWarnings(context: ExternalContext | null) {
  if (!context) {
    return ["External enrichment was unavailable."];
  }

  return [
    ...context.confidenceFlags,
    ...context.missingFields.map((field) => `External enrichment missing ${field}.`),
  ];
}
