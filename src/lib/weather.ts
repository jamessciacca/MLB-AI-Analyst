import { remember } from "@/lib/cache";
import { type VenueSnapshot, type WeatherSnapshot } from "@/lib/types";
import { asNumber } from "@/lib/utils";

const WEATHER_TTL_MS = 20 * 60 * 1000;

type WeatherApiResponse = {
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    apparent_temperature?: number[];
    relative_humidity_2m?: number[];
    precipitation_probability?: number[];
    wind_speed_10m?: number[];
  };
};

function celsiusToFahrenheit(value: number | null): number | null {
  return value === null ? null : value * (9 / 5) + 32;
}

function kmhToMph(value: number | null): number | null {
  return value === null ? null : value * 0.621371;
}

export async function getGameWeather(
  venue: VenueSnapshot | null,
  gameDate: string,
): Promise<WeatherSnapshot | null> {
  if (!venue?.latitude || !venue.longitude) {
    return null;
  }

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(venue.latitude));
  url.searchParams.set("longitude", String(venue.longitude));
  url.searchParams.set(
    "hourly",
    "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,wind_speed_10m",
  );
  url.searchParams.set("forecast_days", "3");
  url.searchParams.set("timezone", "auto");

  const weather = await remember(url.toString(), WEATHER_TTL_MS, async () => {
    const response = await fetch(url, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Weather request failed: ${response.status} ${url}`);
    }

    return (await response.json()) as WeatherApiResponse;
  });

  const hourly = weather.hourly;
  if (!hourly?.time?.length) {
    return null;
  }

  const targetTime = new Date(gameDate).getTime();

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  hourly.time.forEach((time, index) => {
    const distance = Math.abs(new Date(time).getTime() - targetTime);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return {
    forecastTime: hourly.time[bestIndex] ?? gameDate,
    temperatureF: celsiusToFahrenheit(asNumber(hourly.temperature_2m?.[bestIndex])),
    apparentTemperatureF: celsiusToFahrenheit(
      asNumber(hourly.apparent_temperature?.[bestIndex]),
    ),
    precipitationProbability: asNumber(
      hourly.precipitation_probability?.[bestIndex],
    ),
    windSpeedMph: kmhToMph(asNumber(hourly.wind_speed_10m?.[bestIndex])),
    humidity: asNumber(hourly.relative_humidity_2m?.[bestIndex]),
  };
}
