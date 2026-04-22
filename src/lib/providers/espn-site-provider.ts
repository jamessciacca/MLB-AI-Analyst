import { fetchProviderJson } from "@/lib/providers/provider-http";
import {
  type NormalizedInjuryNote,
  type NormalizedOddsContext,
  type NormalizedProviderGame,
  type ProviderResult,
} from "@/lib/providers/provider-types";
import { type GameSummary } from "@/lib/types";
import { asNumber, asString, normalizeSearch } from "@/lib/utils";

const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb";
const ESPN_SITE_TTL_MS = 5 * 60 * 1000;

type EspnCompetition = Record<string, unknown>;
type EspnEvent = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function getCompetitors(competition: EspnCompetition) {
  return ((competition.competitors as unknown[]) ?? [])
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function teamFromCompetitor(competitor: Record<string, unknown>) {
  return asRecord(competitor.team) ?? {};
}

function normalizeEspnEvent(event: EspnEvent): NormalizedProviderGame {
  const competition = asRecord(((event.competitions as unknown[]) ?? [])[0]) ?? {};
  const competitors = getCompetitors(competition);
  const home = competitors.find((entry) => asString(entry.homeAway) === "home");
  const away = competitors.find((entry) => asString(entry.homeAway) === "away");
  const homeTeam = home ? teamFromCompetitor(home) : {};
  const awayTeam = away ? teamFromCompetitor(away) : {};
  const venue = asRecord(competition.venue);
  const status = asRecord(event.status);
  const statusType = asRecord(status?.type);

  return {
    providerGameId: asString(event.id) ?? "",
    provider: "espn-site",
    gameDate: asString(event.date),
    status: asString(statusType?.description) ?? asString(statusType?.name),
    homeTeamName: asString(homeTeam.displayName) ?? asString(homeTeam.name),
    awayTeamName: asString(awayTeam.displayName) ?? asString(awayTeam.name),
    homeTeamAbbreviation: asString(homeTeam.abbreviation),
    awayTeamAbbreviation: asString(awayTeam.abbreviation),
    venueName: asString(venue?.fullName),
    probablePitchers: {
      home: null,
      away: null,
    },
  };
}

function eventMatchesGame(event: NormalizedProviderGame, game: GameSummary) {
  const homeCandidates = [event.homeTeamName, event.homeTeamAbbreviation]
    .filter(Boolean)
    .map((value) => normalizeSearch(String(value)));
  const awayCandidates = [event.awayTeamName, event.awayTeamAbbreviation]
    .filter(Boolean)
    .map((value) => normalizeSearch(String(value)));
  const gameHome = [game.homeTeam.name, game.homeTeam.abbreviation].map(normalizeSearch);
  const gameAway = [game.awayTeam.name, game.awayTeam.abbreviation].map(normalizeSearch);
  const homeMatch = homeCandidates.some((candidate) =>
    gameHome.some((name) => name.includes(candidate) || candidate.includes(name)),
  );
  const awayMatch = awayCandidates.some((candidate) =>
    gameAway.some((name) => name.includes(candidate) || candidate.includes(name)),
  );

  return homeMatch && awayMatch;
}

export async function fetchEspnScoreboard(date: string) {
  const url = new URL(`${ESPN_SITE}/scoreboard`);
  url.searchParams.set("dates", date.replace(/-/g, ""));

  return fetchProviderJson<{ events?: EspnEvent[] }>(url, {
    source: "espn-site-scoreboard",
    ttlMs: ESPN_SITE_TTL_MS,
  });
}

export async function findEspnGameForMlbGame(
  game: GameSummary,
): Promise<ProviderResult<NormalizedProviderGame>> {
  const fetchedAt = new Date().toISOString();

  try {
    const scoreboard = await fetchEspnScoreboard(game.officialDate);
    const normalized = (scoreboard.events ?? []).map(normalizeEspnEvent);
    const matched = normalized.find((event) => eventMatchesGame(event, game)) ?? null;

    return {
      source: "espn-site",
      status: matched ? "ok" : "missing",
      fetchedAt,
      data: matched,
      warnings: matched ? [] : ["ESPN Site scoreboard did not match this MLB game."],
    };
  } catch (error) {
    return {
      source: "espn-site",
      status: "error",
      fetchedAt,
      data: null,
      warnings: [error instanceof Error ? error.message : "ESPN Site scoreboard failed."],
    };
  }
}

export async function fetchEspnSummary(
  eventId: string | null,
): Promise<ProviderResult<{
  injuries: NormalizedInjuryNote[];
  odds: NormalizedOddsContext | null;
}>> {
  const fetchedAt = new Date().toISOString();

  if (!eventId) {
    return {
      source: "espn-site-summary",
      status: "missing",
      fetchedAt,
      data: null,
      warnings: ["No ESPN event id was available."],
    };
  }

  try {
    const url = new URL(`${ESPN_SITE}/summary`);
    url.searchParams.set("event", eventId);
    const summary = await fetchProviderJson<Record<string, unknown>>(url, {
      source: "espn-site-summary",
      ttlMs: ESPN_SITE_TTL_MS,
    });
    const injuries = ((summary.injuries as unknown[]) ?? [])
      .map(asRecord)
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .flatMap((teamEntry) => {
        const team = asRecord(teamEntry.team);
        return ((teamEntry.injuries as unknown[]) ?? [])
          .map(asRecord)
          .filter((entry): entry is Record<string, unknown> => entry !== null)
          .map((injury) => {
            const athlete = asRecord(injury.athlete);
            return {
              teamName: asString(team?.displayName) ?? asString(team?.name),
              athleteName: asString(athlete?.displayName) ?? asString(athlete?.fullName),
              status: asString(injury.status),
              detail: asString(injury.detail) ?? asString(injury.type) ?? "Injury note",
              source: "espn-site",
            };
          });
      });
    const oddsEntry = asRecord(((summary.odds as unknown[]) ?? [])[0]);
    const homeMoneyline = asNumber(oddsEntry?.homeTeamOdds);
    const awayMoneyline = asNumber(oddsEntry?.awayTeamOdds);

    return {
      source: "espn-site-summary",
      status: "ok",
      fetchedAt,
      data: {
        injuries,
        odds:
          homeMoneyline !== null || awayMoneyline !== null
            ? {
                provider: "espn-site",
                homeMoneyline,
                awayMoneyline,
                marketImpliedHomeWinProb: null,
                marketImpliedAwayWinProb: null,
                noVigHomeWinProb: null,
                noVigAwayWinProb: null,
              }
            : null,
      },
      warnings: [],
    };
  } catch (error) {
    return {
      source: "espn-site-summary",
      status: "error",
      fetchedAt,
      data: null,
      warnings: [error instanceof Error ? error.message : "ESPN Site summary failed."],
    };
  }
}
