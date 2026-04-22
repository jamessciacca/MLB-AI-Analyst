import { buildExternalDerivedFeatures, normalizeOddsContext } from "@/lib/enrichment/external-features";
import { fetchEspnCoreEventContext } from "@/lib/providers/espn-core-provider";
import { findEspnGameForMlbGame, fetchEspnSummary } from "@/lib/providers/espn-site-provider";
import { geocodeVenue } from "@/lib/providers/nominatim-provider";
import { fetchOpenMeteoWeather } from "@/lib/providers/open-meteo-provider";
import {
  type ExternalContext,
  type NormalizedVenueContext,
  type ProviderResult,
} from "@/lib/providers/provider-types";
import { fetchSunriseSunset } from "@/lib/providers/sunrise-sunset-provider";
import { type GameSummary, type LineupStatus, type VenueSnapshot } from "@/lib/types";
import { todayIsoDate } from "@/lib/utils";

function collectWarnings(results: Array<ProviderResult<unknown>>) {
  return results.flatMap((result) => result.warnings);
}

function timestampMap(results: Array<ProviderResult<unknown>>) {
  return Object.fromEntries(results.map((result) => [result.source, result.fetchedAt]));
}

function venueFromSnapshot(venue: VenueSnapshot | null): NormalizedVenueContext | null {
  if (!venue) {
    return null;
  }

  return {
    venueName: venue.name,
    latitude: venue.latitude,
    longitude: venue.longitude,
    displayName: venue.name,
    timezone: null,
    source: "mlb-statsapi",
  };
}

function missingFields(context: {
  venue: NormalizedVenueContext | null;
  weather: unknown;
  daylight: unknown;
  espnSummary: unknown;
}) {
  return [
    !context.venue ? "venue" : null,
    !context.weather ? "weather" : null,
    !context.daylight ? "daylight" : null,
    !context.espnSummary ? "espnSummary" : null,
  ].filter((field): field is string => Boolean(field));
}

export async function buildExternalContext(input: {
  game: GameSummary;
  venue: VenueSnapshot | null;
  lineupStatus?: LineupStatus;
  mode?: "live" | "historical";
}): Promise<ExternalContext | null> {
  const espnGame = await findEspnGameForMlbGame(input.game);
  const espnSummary = await fetchEspnSummary(espnGame.data?.providerGameId ?? null);
  const espnCore = await fetchEspnCoreEventContext(
    espnGame.data?.providerGameId ?? null,
    input.game,
  );
  const baseVenue = venueFromSnapshot(input.venue);
  const geocodedVenue =
    baseVenue?.latitude && baseVenue.longitude
      ? null
      : await geocodeVenue({ venueName: input.game.venue.name });
  const venue = baseVenue?.latitude && baseVenue.longitude ? baseVenue : geocodedVenue?.data ?? baseVenue;
  const weather =
    venue?.latitude && venue.longitude
      ? await fetchOpenMeteoWeather({
          latitude: venue.latitude,
          longitude: venue.longitude,
          gameDate: input.game.gameDate,
          mode:
            input.mode === "historical" || input.game.officialDate < todayIsoDate()
              ? "historical"
              : "forecast",
        })
      : null;
  const daylight =
    venue?.latitude && venue.longitude
      ? await fetchSunriseSunset({
          latitude: venue.latitude,
          longitude: venue.longitude,
          date: input.game.officialDate,
          gameDate: input.game.gameDate,
        })
      : null;
  const odds = normalizeOddsContext(espnSummary.data?.odds ?? null);
  const fields = missingFields({
    venue,
    weather: weather?.data ?? null,
    daylight: daylight?.data ?? null,
    espnSummary: espnGame.data,
  });
  const results = [
    espnGame,
    espnSummary,
    espnCore,
    ...(geocodedVenue ? [geocodedVenue] : []),
    ...(weather ? [weather] : []),
    ...(daylight ? [daylight] : []),
  ];
  const confidenceFlags = collectWarnings(results);
  const features = buildExternalDerivedFeatures({
    venue,
    weather: weather?.data ?? null,
    daylight: daylight?.data ?? null,
    odds,
    missingFields: fields,
    injuryCount: espnSummary.data?.injuries.length ?? 0,
    lineupStatus: input.lineupStatus,
  });

  return {
    gameId: input.game.gamePk,
    sourceTimestamps: timestampMap(results),
    venue,
    weather: weather?.data ?? null,
    daylight: daylight?.data ?? null,
    injuries: espnSummary.data?.injuries ?? [],
    odds,
    espnSummary: espnGame.data,
    teams: {
      home: input.game.homeTeam,
      away: input.game.awayTeam,
    },
    confidenceFlags,
    missingFields: fields,
    features,
  };
}
