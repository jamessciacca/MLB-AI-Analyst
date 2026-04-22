import { type TeamGameInfo, type WeatherCondition } from "@/lib/types";

export type ProviderStatus = "ok" | "partial" | "missing" | "error";

export interface ProviderResult<T> {
  source: string;
  status: ProviderStatus;
  fetchedAt: string;
  data: T | null;
  warnings: string[];
}

export interface NormalizedProviderGame {
  providerGameId: string;
  provider: string;
  gameDate: string | null;
  status: string | null;
  homeTeamName: string | null;
  awayTeamName: string | null;
  homeTeamAbbreviation: string | null;
  awayTeamAbbreviation: string | null;
  venueName: string | null;
  probablePitchers: {
    home: string | null;
    away: string | null;
  };
}

export interface NormalizedInjuryNote {
  teamName: string | null;
  athleteName: string | null;
  status: string | null;
  detail: string;
  source: string;
}

export interface NormalizedOddsContext {
  provider: string;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  marketImpliedHomeWinProb: number | null;
  marketImpliedAwayWinProb: number | null;
  noVigHomeWinProb: number | null;
  noVigAwayWinProb: number | null;
}

export interface NormalizedVenueContext {
  venueName: string;
  latitude: number | null;
  longitude: number | null;
  displayName: string | null;
  timezone: string | null;
  source: string;
}

export interface NormalizedWeatherContext {
  source: "open-meteo-forecast" | "open-meteo-historical";
  time: string | null;
  temperatureF: number | null;
  windSpeedMph: number | null;
  windDirectionDegrees: number | null;
  humidity: number | null;
  precipitationProbability: number | null;
  precipitationInches: number | null;
  pressureHpa: number | null;
  condition: WeatherCondition;
}

export interface NormalizedDaylightContext {
  source: "sunrise-sunset";
  sunrise: string | null;
  sunset: string | null;
  solarNoon: string | null;
  dayLengthMinutes: number | null;
  firstPitchMinutesFromSunset: number | null;
  isDayGame: boolean;
  isNightGame: boolean;
  isTwilightStart: boolean;
}

export interface ExternalDerivedFeatures {
  isDayGame: number;
  isNightGame: number;
  isTwilightStart: number;
  firstPitchMinutesFromSunset: number | null;
  dayLengthMinutes: number | null;
  stadiumLat: number | null;
  stadiumLon: number | null;
  windOutToCFApprox: number | null;
  weatherSeverityScore: number;
  weatherBoostForHR: number;
  weatherPenaltyForPitchers: number;
  marketImpliedHomeWinProb: number | null;
  marketImpliedAwayWinProb: number | null;
  lineupUncertaintyScore: number;
  injuryUncertaintyScore: number;
  externalDataCompletenessScore: number;
}

export interface ExternalContext {
  gameId: number;
  sourceTimestamps: Record<string, string>;
  venue: NormalizedVenueContext | null;
  weather: NormalizedWeatherContext | null;
  daylight: NormalizedDaylightContext | null;
  injuries: NormalizedInjuryNote[];
  odds: NormalizedOddsContext | null;
  espnSummary: NormalizedProviderGame | null;
  teams: {
    home: TeamGameInfo;
    away: TeamGameInfo;
  };
  confidenceFlags: string[];
  missingFields: string[];
  features: ExternalDerivedFeatures;
}
