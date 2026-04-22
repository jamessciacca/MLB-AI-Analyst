import { rememberFile } from "@/lib/providers/file-cache";
import { fetchProviderJson } from "@/lib/providers/provider-http";
import {
  type NormalizedDaylightContext,
  type ProviderResult,
} from "@/lib/providers/provider-types";
import { asNumber, asString } from "@/lib/utils";

const DAYLIGHT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

type SunriseSunsetResponse = {
  status?: string;
  results?: Record<string, unknown>;
};

function minutesBetween(left: string | null, right: string | null) {
  if (!left || !right) {
    return null;
  }

  const diff = new Date(left).getTime() - new Date(right).getTime();
  return Number.isFinite(diff) ? Math.round(diff / 60000) : null;
}

function normalizeDaylight(
  json: SunriseSunsetResponse,
  gameDate: string,
): NormalizedDaylightContext | null {
  const results = json.results;

  if (!results) {
    return null;
  }

  const sunrise = asString(results.sunrise);
  const sunset = asString(results.sunset);
  const solarNoon = asString(results.solar_noon);
  const dayLengthSeconds = asNumber(results.day_length);
  const firstPitchMinutesFromSunset = minutesBetween(gameDate, sunset);
  const absSunsetDistance = Math.abs(firstPitchMinutesFromSunset ?? 9999);

  return {
    source: "sunrise-sunset",
    sunrise,
    sunset,
    solarNoon,
    dayLengthMinutes:
      dayLengthSeconds !== null ? Math.round(dayLengthSeconds / 60) : minutesBetween(sunset, sunrise),
    firstPitchMinutesFromSunset,
    isDayGame:
      firstPitchMinutesFromSunset !== null ? firstPitchMinutesFromSunset < -45 : false,
    isNightGame:
      firstPitchMinutesFromSunset !== null ? firstPitchMinutesFromSunset > 45 : false,
    isTwilightStart: absSunsetDistance <= 45,
  };
}

export async function fetchSunriseSunset(input: {
  latitude: number;
  longitude: number;
  date: string;
  gameDate: string;
}): Promise<ProviderResult<NormalizedDaylightContext>> {
  const fetchedAt = new Date().toISOString();
  const cacheKey = `${input.latitude}:${input.longitude}:${input.date}`;

  try {
    const daylight = await rememberFile("sunrise-sunset", cacheKey, DAYLIGHT_TTL_MS, async () => {
      const url = new URL("https://api.sunrise-sunset.org/json");
      url.searchParams.set("lat", String(input.latitude));
      url.searchParams.set("lng", String(input.longitude));
      url.searchParams.set("date", input.date);
      url.searchParams.set("formatted", "0");
      const json = await fetchProviderJson<SunriseSunsetResponse>(url, {
        source: "sunrise-sunset",
        ttlMs: 24 * 60 * 60 * 1000,
        timeoutMs: 7000,
      });
      return normalizeDaylight(json, input.gameDate);
    });

    return {
      source: "sunrise-sunset",
      status: daylight ? "ok" : "missing",
      fetchedAt,
      data: daylight,
      warnings: daylight ? [] : ["Sunrise-Sunset did not return daylight data."],
    };
  } catch (error) {
    return {
      source: "sunrise-sunset",
      status: "error",
      fetchedAt,
      data: null,
      warnings: [error instanceof Error ? error.message : "Sunrise-Sunset request failed."],
    };
  }
}
