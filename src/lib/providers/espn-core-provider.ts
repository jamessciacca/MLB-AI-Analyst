import { fetchProviderJson } from "@/lib/providers/provider-http";
import { type ProviderResult } from "@/lib/providers/provider-types";
import { type GameSummary } from "@/lib/types";
import { asString } from "@/lib/utils";

const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb";
const ESPN_CORE_TTL_MS = 30 * 60 * 1000;

export interface EspnCoreEventContext {
  eventId: string;
  rawRef: string | null;
  statusRef: string | null;
  competitionRefs: string[];
  notes: string[];
}

export async function fetchEspnCoreEventContext(
  eventId: string | null,
  game: GameSummary,
): Promise<ProviderResult<EspnCoreEventContext>> {
  const fetchedAt = new Date().toISOString();

  if (!eventId) {
    return {
      source: "espn-core",
      status: "missing",
      fetchedAt,
      data: null,
      warnings: ["No ESPN event id was available for Core API lookup."],
    };
  }

  try {
    const url = new URL(`${ESPN_CORE}/events/${eventId}`);
    const event = await fetchProviderJson<Record<string, unknown>>(url, {
      source: "espn-core-event",
      ttlMs: ESPN_CORE_TTL_MS,
    });
    const competitions = ((event.competitions as Record<string, unknown> | undefined)?.items ??
      []) as Array<Record<string, unknown>>;

    return {
      source: "espn-core",
      status: "ok",
      fetchedAt,
      data: {
        eventId,
        rawRef: asString(event.$ref),
        statusRef: asString((event.competitions as Record<string, unknown> | undefined)?.$ref),
        competitionRefs: competitions.flatMap((entry) => asString(entry.$ref) ?? []),
        notes: [
          `${game.awayTeam.abbreviation} at ${game.homeTeam.abbreviation}`,
          "ESPN Core context is attached as provider references because the endpoint shape can change.",
        ],
      },
      warnings: [],
    };
  } catch (error) {
    return {
      source: "espn-core",
      status: "error",
      fetchedAt,
      data: null,
      warnings: [error instanceof Error ? error.message : "ESPN Core API failed."],
    };
  }
}
