import { rememberFile } from "@/lib/providers/file-cache";
import { fetchProviderJson } from "@/lib/providers/provider-http";
import {
  type NormalizedVenueContext,
  type ProviderResult,
} from "@/lib/providers/provider-types";
import { asNumber, asString } from "@/lib/utils";

const NOMINATIM_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ??
  "MLBAnalystAI/1.0 (local development; contact unavailable)";

type NominatimRow = Record<string, unknown>;

export async function geocodeVenue(input: {
  venueName: string;
  cityHint?: string | null;
}): Promise<ProviderResult<NormalizedVenueContext>> {
  const fetchedAt = new Date().toISOString();
  const query = [input.venueName, input.cityHint, "United States"]
    .filter(Boolean)
    .join(", ");

  try {
    const venue = await rememberFile("nominatim", query, NOMINATIM_TTL_MS, async () => {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q", query);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "1");
      const rows = await fetchProviderJson<NominatimRow[]>(url, {
        source: "nominatim",
        ttlMs: 60 * 60 * 1000,
        timeoutMs: 9000,
        retries: 1,
        headers: {
          "User-Agent": USER_AGENT,
          Referer: "https://localhost/",
        },
      });
      const row = rows[0];

      return row
        ? {
            venueName: input.venueName,
            latitude: asNumber(row.lat),
            longitude: asNumber(row.lon),
            displayName: asString(row.display_name),
            timezone: null,
            source: "nominatim",
          }
        : null;
    });

    return {
      source: "nominatim",
      status: venue ? "ok" : "missing",
      fetchedAt,
      data: venue,
      warnings: venue ? [] : ["Nominatim did not return a venue match."],
    };
  } catch (error) {
    return {
      source: "nominatim",
      status: "error",
      fetchedAt,
      data: null,
      warnings: [error instanceof Error ? error.message : "Nominatim geocoding failed."],
    };
  }
}
