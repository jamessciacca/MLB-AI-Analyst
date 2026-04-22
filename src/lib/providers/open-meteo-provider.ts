import { fetchProviderJson } from "@/lib/providers/provider-http";
import {
  type NormalizedWeatherContext,
  type ProviderResult,
} from "@/lib/providers/provider-types";
import { asNumber } from "@/lib/utils";

const FORECAST_TTL_MS = 20 * 60 * 1000;
const HISTORICAL_TTL_MS = 365 * 24 * 60 * 60 * 1000;

type OpenMeteoResponse = {
  hourly?: Record<string, unknown[] | undefined>;
};

function cToF(value: number | null) {
  return value === null ? null : value * (9 / 5) + 32;
}

function kmhToMph(value: number | null) {
  return value === null ? null : value * 0.621371;
}

function mmToInches(value: number | null) {
  return value === null ? null : value / 25.4;
}

function nearestHourlyIndex(hourly: Record<string, unknown[] | undefined>, gameDate: string) {
  const times = hourly.time ?? [];
  const target = new Date(gameDate).getTime();
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  times.forEach((time, index) => {
    const distance = Math.abs(new Date(String(time)).getTime() - target);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });

  return bestIndex;
}

function normalizeWeather(
  source: NormalizedWeatherContext["source"],
  json: OpenMeteoResponse,
  gameDate: string,
): NormalizedWeatherContext | null {
  const hourly = json.hourly;

  if (!hourly?.time?.length) {
    return null;
  }

  const index = nearestHourlyIndex(hourly, gameDate);
  const precipitationProbability = asNumber(hourly.precipitation_probability?.[index]);
  const precipitation = asNumber(hourly.precipitation?.[index]);

  return {
    source,
    time: String(hourly.time?.[index] ?? gameDate),
    temperatureF: cToF(asNumber(hourly.temperature_2m?.[index])),
    windSpeedMph: kmhToMph(asNumber(hourly.wind_speed_10m?.[index])),
    windDirectionDegrees: asNumber(hourly.wind_direction_10m?.[index]),
    humidity: asNumber(hourly.relative_humidity_2m?.[index]),
    precipitationProbability,
    precipitationInches: mmToInches(precipitation),
    pressureHpa: asNumber(hourly.surface_pressure?.[index]),
    condition:
      (precipitationProbability ?? 0) >= 45 || (precipitation ?? 0) > 0.25
        ? "rainy"
        : "unknown",
  };
}

export async function fetchOpenMeteoWeather(input: {
  latitude: number;
  longitude: number;
  gameDate: string;
  mode: "forecast" | "historical";
}): Promise<ProviderResult<NormalizedWeatherContext>> {
  const fetchedAt = new Date().toISOString();
  const isHistorical = input.mode === "historical";
  const url = new URL(
    isHistorical
      ? "https://archive-api.open-meteo.com/v1/archive"
      : "https://api.open-meteo.com/v1/forecast",
  );
  const gameDay = input.gameDate.slice(0, 10);
  url.searchParams.set("latitude", String(input.latitude));
  url.searchParams.set("longitude", String(input.longitude));
  url.searchParams.set(
    "hourly",
    [
      "temperature_2m",
      "relative_humidity_2m",
      "precipitation",
      "precipitation_probability",
      "wind_speed_10m",
      "wind_direction_10m",
      "surface_pressure",
    ].join(","),
  );
  url.searchParams.set("timezone", "auto");

  if (isHistorical) {
    url.searchParams.set("start_date", gameDay);
    url.searchParams.set("end_date", gameDay);
  } else {
    url.searchParams.set("forecast_days", "7");
  }

  try {
    const json = await fetchProviderJson<OpenMeteoResponse>(url, {
      source: isHistorical ? "open-meteo-historical" : "open-meteo-forecast",
      ttlMs: isHistorical ? HISTORICAL_TTL_MS : FORECAST_TTL_MS,
      timeoutMs: 8000,
    });
    const weather = normalizeWeather(
      isHistorical ? "open-meteo-historical" : "open-meteo-forecast",
      json,
      input.gameDate,
    );

    return {
      source: weather?.source ?? "open-meteo",
      status: weather ? "ok" : "missing",
      fetchedAt,
      data: weather,
      warnings: weather ? [] : ["Open-Meteo did not include hourly weather."],
    };
  } catch (error) {
    return {
      source: isHistorical ? "open-meteo-historical" : "open-meteo-forecast",
      status: "error",
      fetchedAt,
      data: null,
      warnings: [error instanceof Error ? error.message : "Open-Meteo request failed."],
    };
  }
}
