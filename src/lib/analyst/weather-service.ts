import { fetchWithRetry, remember } from "../cache.ts";
import { type GameSummary, type VenueSnapshot, type WeatherSnapshot } from "../types.ts";
import { asNumber, clamp } from "../utils.ts";

import { type AnalystWeatherContext } from "./types.ts";

const WEATHER_TTL_MS = 20 * 60 * 1000;

type WeatherApiResponse = {
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    apparent_temperature?: number[];
    relative_humidity_2m?: number[];
    precipitation_probability?: number[];
    wind_speed_10m?: number[];
    wind_direction_10m?: number[];
  };
};

function celsiusToFahrenheit(value: number | null) {
  return value === null ? null : value * (9 / 5) + 32;
}

function kmhToMph(value: number | null) {
  return value === null ? null : value * 0.621371;
}

function minimalDegrees(left: number, right: number) {
  const diff = Math.abs(left - right) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function airDensityScore(input: {
  temperatureF: number | null;
  humidity: number | null;
  elevationFeet: number | null;
}) {
  if (input.temperatureF === null) {
    return null;
  }

  const temperatureDrag = (70 - input.temperatureF) / 55;
  const humidityLift = ((input.humidity ?? 50) - 50) / 180;
  const altitudeLift = (input.elevationFeet ?? 500) / 12000;

  return clamp(1 + temperatureDrag * 0.16 - humidityLift * 0.08 - altitudeLift * 0.18, 0.78, 1.18);
}

function windContext(
  venue: VenueSnapshot | null,
  windSpeedMph: number | null,
  windDirectionDegrees: number | null,
) {
  if (!windSpeedMph || windSpeedMph < 5 || windDirectionDegrees === null || venue?.azimuthAngle === null) {
    return {
      impact: "neutral" as const,
      summary: windSpeedMph ? `${windSpeedMph.toFixed(0)} mph, limited directional impact.` : "Wind context unavailable.",
    };
  }

  const blowingToward = (windDirectionDegrees + 180) % 360;
  const centerFieldBearing = venue?.azimuthAngle ?? 0;
  const delta = minimalDegrees(blowingToward, centerFieldBearing);

  if (delta <= 35) {
    return {
      impact: "blowing_out" as const,
      summary: `${windSpeedMph.toFixed(0)} mph blowing out toward center/right-center.`,
    };
  }

  if (delta >= 145) {
    return {
      impact: "blowing_in" as const,
      summary: `${windSpeedMph.toFixed(0)} mph blowing in from the outfield.`,
    };
  }

  if (delta >= 55 && delta <= 125) {
    return {
      impact: "crosswind" as const,
      summary: `${windSpeedMph.toFixed(0)} mph crosswind across the field.`,
    };
  }

  return {
    impact: "neutral" as const,
    summary: `${windSpeedMph.toFixed(0)} mph with mixed field impact.`,
  };
}

export async function getAnalystWeatherContext(input: {
  venue: VenueSnapshot | null;
  game: GameSummary;
  existingWeather?: WeatherSnapshot | null;
}): Promise<AnalystWeatherContext | null> {
  const { venue, game } = input;

  if (!venue?.latitude || !venue.longitude) {
    if (!input.existingWeather) {
      return null;
    }

    return {
      forecastTime: input.existingWeather.forecastTime,
      temperatureF: input.existingWeather.temperatureF,
      apparentTemperatureF: input.existingWeather.apparentTemperatureF,
      humidity: input.existingWeather.humidity,
      precipitationProbability: input.existingWeather.precipitationProbability,
      windSpeedMph: input.existingWeather.windSpeedMph,
      windDirectionDegrees: null,
      windImpact: "unknown",
      windSummary: "Using existing weather snapshot without direction.",
      airDensityScore: airDensityScore({
        temperatureF: input.existingWeather.temperatureF,
        humidity: input.existingWeather.humidity,
        elevationFeet: venue?.elevationFeet ?? null,
      }),
      source: "existing",
    };
  }

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(venue.latitude));
  url.searchParams.set("longitude", String(venue.longitude));
  url.searchParams.set(
    "hourly",
    "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,wind_speed_10m,wind_direction_10m",
  );
  url.searchParams.set("forecast_days", "7");
  url.searchParams.set("timezone", "auto");

  const weather = await remember(url.toString(), WEATHER_TTL_MS, async () => {
    const response = await fetchWithRetry(url, { cache: "no-store" }, {
      retries: 2,
      timeoutMs: 7000,
    });

    if (!response.ok) {
      throw new Error(`Weather request failed: ${response.status} ${url}`);
    }

    return (await response.json()) as WeatherApiResponse;
  }).catch(() => null);

  if (!weather?.hourly?.time?.length) {
    if (!input.existingWeather) {
      return null;
    }

    return {
      forecastTime: input.existingWeather.forecastTime,
      temperatureF: input.existingWeather.temperatureF,
      apparentTemperatureF: input.existingWeather.apparentTemperatureF,
      humidity: input.existingWeather.humidity,
      precipitationProbability: input.existingWeather.precipitationProbability,
      windSpeedMph: input.existingWeather.windSpeedMph,
      windDirectionDegrees: null,
      windImpact: "unknown",
      windSummary: "Existing weather snapshot used as fallback.",
      airDensityScore: airDensityScore({
        temperatureF: input.existingWeather.temperatureF,
        humidity: input.existingWeather.humidity,
        elevationFeet: venue?.elevationFeet ?? null,
      }),
      source: "existing",
    };
  }

  const targetTime = new Date(game.gameDate).getTime();
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  weather.hourly.time.forEach((time, index) => {
    const distance = Math.abs(new Date(time).getTime() - targetTime);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  const temperatureF = celsiusToFahrenheit(asNumber(weather.hourly.temperature_2m?.[bestIndex]));
  const apparentTemperatureF = celsiusToFahrenheit(
    asNumber(weather.hourly.apparent_temperature?.[bestIndex]),
  );
  const humidity = asNumber(weather.hourly.relative_humidity_2m?.[bestIndex]);
  const precipitationProbability = asNumber(
    weather.hourly.precipitation_probability?.[bestIndex],
  );
  const windSpeedMph = kmhToMph(asNumber(weather.hourly.wind_speed_10m?.[bestIndex]));
  const windDirectionDegrees = asNumber(weather.hourly.wind_direction_10m?.[bestIndex]);
  const wind = windContext(venue, windSpeedMph, windDirectionDegrees);

  return {
    forecastTime: weather.hourly.time[bestIndex] ?? game.gameDate,
    temperatureF,
    apparentTemperatureF,
    humidity,
    precipitationProbability,
    windSpeedMph,
    windDirectionDegrees,
    windImpact: wind.impact,
    windSummary: wind.summary,
    airDensityScore: airDensityScore({
      temperatureF,
      humidity,
      elevationFeet: venue.elevationFeet,
    }),
    source: "open-meteo",
  };
}
