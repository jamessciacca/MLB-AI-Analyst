#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_INPUT = "data/game_win_training.csv";
const DEFAULT_JSONL = "data/training/enriched_game_context.jsonl";
const DEFAULT_CSV = "data/enriched_games.csv";
const USER_AGENT = process.env.NOMINATIM_USER_AGENT ?? "MLBAnalystAI/1.0 backfill";

function parseArgs() {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    args.set(process.argv[index], process.argv[index + 1]);
  }
  return {
    input: args.get("--input") ?? DEFAULT_INPUT,
    jsonl: args.get("--jsonl") ?? DEFAULT_JSONL,
    csv: args.get("--csv") ?? DEFAULT_CSV,
  };
}

function parseCsv(text) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map((value) => value.trim());
  return lines
    .filter(Boolean)
    .map((line) => {
      const values = line.split(",");
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    });
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...headers,
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${url}`);
  }
  return response.json();
}

async function geocodeVenue(venueName) {
  if (!venueName) return null;
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", `${venueName}, United States`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  const rows = await fetchJson(url, { "User-Agent": USER_AGENT });
  const row = rows[0];
  return row ? { latitude: Number(row.lat), longitude: Number(row.lon), displayName: row.display_name } : null;
}

async function historicalWeather(latitude, longitude, date) {
  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("start_date", date);
  url.searchParams.set("end_date", date);
  url.searchParams.set("timezone", "auto");
  url.searchParams.set(
    "hourly",
    "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m,surface_pressure",
  );
  return fetchJson(url);
}

async function daylight(latitude, longitude, date) {
  const url = new URL("https://api.sunrise-sunset.org/json");
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lng", String(longitude));
  url.searchParams.set("date", date);
  url.searchParams.set("formatted", "0");
  return fetchJson(url);
}

function firstHourlyValue(weather, field) {
  const values = weather.hourly?.[field] ?? [];
  return values[Math.floor(values.length / 2)] ?? null;
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return text.includes(",") || text.includes("\"") ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

async function main() {
  const args = parseArgs();
  const rows = parseCsv(await readFile(args.input, "utf8"));
  const enriched = [];

  for (const row of rows) {
    const venueName = row.venue_name || row.venue || "";
    const geocoded =
      row.latitude && row.longitude
        ? { latitude: Number(row.latitude), longitude: Number(row.longitude), displayName: venueName }
        : await geocodeVenue(venueName).catch(() => null);

    if (!geocoded || !row.date) {
      enriched.push({ ...row, enrichment_status: "missing_venue_or_date" });
      continue;
    }

    const [weather, sun] = await Promise.all([
      historicalWeather(geocoded.latitude, geocoded.longitude, row.date).catch(() => null),
      daylight(geocoded.latitude, geocoded.longitude, row.date).catch(() => null),
    ]);

    enriched.push({
      ...row,
      stadium_lat: geocoded.latitude,
      stadium_lon: geocoded.longitude,
      venue_display_name: geocoded.displayName,
      historical_temperature_c: weather ? firstHourlyValue(weather, "temperature_2m") : null,
      historical_humidity: weather ? firstHourlyValue(weather, "relative_humidity_2m") : null,
      historical_wind_speed_kmh: weather ? firstHourlyValue(weather, "wind_speed_10m") : null,
      historical_wind_direction: weather ? firstHourlyValue(weather, "wind_direction_10m") : null,
      historical_pressure_hpa: weather ? firstHourlyValue(weather, "surface_pressure") : null,
      sunrise: sun?.results?.sunrise ?? null,
      sunset: sun?.results?.sunset ?? null,
      day_length_seconds: sun?.results?.day_length ?? null,
      enrichment_status: "ok",
    });
  }

  await mkdir(path.dirname(args.jsonl), { recursive: true });
  await mkdir(path.dirname(args.csv), { recursive: true });
  await writeFile(args.jsonl, enriched.map((row) => JSON.stringify(row)).join("\n"));
  const headers = Array.from(new Set(enriched.flatMap((row) => Object.keys(row))));
  await writeFile(
    args.csv,
    [headers.join(","), ...enriched.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n"),
  );
  console.log(`Wrote ${enriched.length} enriched rows to ${args.jsonl} and ${args.csv}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
