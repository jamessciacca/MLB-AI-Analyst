import { remember } from "@/lib/cache";
import {
  type FieldingStatLine,
  type GameSummary,
  type HittingStatLine,
  type PitchingStatLine,
  type PlayerSearchResult,
  type StartingLineupPlayer,
  type TeamDirectoryEntry,
  type VenueSnapshot,
} from "@/lib/types";
import { asNumber, asString, normalizeSearch, todayIsoDate } from "@/lib/utils";

const MLB_BASE_URL = "https://statsapi.mlb.com/api/v1";
const MLB_FEED_BASE_URL = "https://statsapi.mlb.com/api/v1.1";
const HALF_HOUR_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function currentSeason() {
  return new Date().getFullYear();
}

async function mlbJson<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
  ttlMs = HALF_HOUR_MS,
): Promise<T> {
  const url = new URL(path.replace(/^\//, ""), `${MLB_BASE_URL}/`);

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return remember(url.toString(), ttlMs, async () => {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`MLB API request failed: ${response.status} ${url}`);
    }

    return (await response.json()) as T;
  });
}

async function mlbFeedJson<T>(path: string, ttlMs = HALF_HOUR_MS): Promise<T> {
  const url = new URL(path.replace(/^\//, ""), `${MLB_FEED_BASE_URL}/`);

  return remember(url.toString(), ttlMs, async () => {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`MLB feed request failed: ${response.status} ${url}`);
    }

    return (await response.json()) as T;
  });
}

function mapTeamDirectoryEntry(team: Record<string, unknown>): TeamDirectoryEntry {
  return {
    id: asNumber(team.id) ?? 0,
    name: asString(team.name) ?? "Unknown Team",
    abbreviation:
      asString(team.abbreviation) ??
      asString(team.teamCode) ??
      asString(team.fileCode) ??
      "UNK",
  };
}

async function getTeamDirectoryMap(
  season = currentSeason(),
): Promise<Map<number, TeamDirectoryEntry>> {
  const json = await mlbJson<{ teams?: Record<string, unknown>[] }>(
    "teams",
    {
      sportId: 1,
      season,
    },
    DAY_MS,
  );

  return new Map(
    (json.teams ?? []).map((team) => {
      const mapped = mapTeamDirectoryEntry(team);
      return [mapped.id, mapped] as const;
    }),
  );
}

function mapPlayer(
  person: Record<string, unknown>,
  teamDirectory: Map<number, TeamDirectoryEntry>,
): PlayerSearchResult {
  const currentTeamId = asNumber(
    (person.currentTeam as Record<string, unknown> | undefined)?.id,
  );
  const currentTeam = currentTeamId ? teamDirectory.get(currentTeamId) : undefined;

  return {
    id: asNumber(person.id) ?? 0,
    fullName: asString(person.fullName) ?? "Unknown Player",
    firstName: asString(person.firstName) ?? "",
    lastName: asString(person.lastName) ?? "",
    currentAge: asNumber(person.currentAge),
    active: Boolean(person.active),
    currentTeamId,
    currentTeamName: currentTeam?.name ?? null,
    currentTeamAbbreviation: currentTeam?.abbreviation ?? null,
    primaryPosition:
      asString(
        (person.primaryPosition as Record<string, unknown> | undefined)?.abbreviation,
      ) ?? null,
    batSide:
      asString((person.batSide as Record<string, unknown> | undefined)?.code) ?? null,
    pitchHand:
      asString((person.pitchHand as Record<string, unknown> | undefined)?.code) ?? null,
  };
}

async function getCurrentBatters(
  season = currentSeason(),
): Promise<PlayerSearchResult[]> {
  const [teamDirectory, json] = await Promise.all([
    getTeamDirectoryMap(season),
    mlbJson<{ people?: Record<string, unknown>[] }>(
      "sports/1/players",
      {
        season,
      },
      HALF_HOUR_MS,
    ),
  ]);

  return (json.people ?? [])
    .map((person) => mapPlayer(person, teamDirectory))
    .filter((person) => person.active && person.primaryPosition !== "P")
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
}

function scoreNameMatch(player: PlayerSearchResult, query: string): number {
  const normalizedQuery = normalizeSearch(query);
  const fullName = normalizeSearch(player.fullName);
  const lastFirst = normalizeSearch(`${player.lastName} ${player.firstName}`);

  if (fullName === normalizedQuery) {
    return 100;
  }
  if (lastFirst === normalizedQuery) {
    return 95;
  }
  if (fullName.startsWith(normalizedQuery)) {
    return 90;
  }
  if (lastFirst.startsWith(normalizedQuery)) {
    return 85;
  }
  if (fullName.includes(` ${normalizedQuery}`)) {
    return 75;
  }
  if (fullName.includes(normalizedQuery)) {
    return 65;
  }
  return 0;
}

export async function searchBatters(query: string): Promise<PlayerSearchResult[]> {
  const normalizedQuery = normalizeSearch(query);

  if (normalizedQuery.length < 2) {
    return [];
  }

  const batters = await getCurrentBatters();
  return batters
    .map((player) => ({
      player,
      score: scoreNameMatch(player, normalizedQuery),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 12)
    .map((candidate) => candidate.player);
}

export async function getPlayerById(
  playerId: number,
  season = currentSeason(),
): Promise<PlayerSearchResult | null> {
  const batters = await getCurrentBatters(season);
  const batterMatch = batters.find((player) => player.id === playerId);

  if (batterMatch) {
    return batterMatch;
  }

  const teamDirectory = await getTeamDirectoryMap(season);
  const json = await mlbJson<{ people?: Record<string, unknown>[] }>(
    `people/${playerId}`,
    undefined,
    HALF_HOUR_MS,
  );

  const person = json.people?.[0];
  return person ? mapPlayer(person, teamDirectory) : null;
}

export async function getGamesByDate(
  officialDate = todayIsoDate(),
  season = currentSeason(),
): Promise<GameSummary[]> {
  const [teamDirectory, json] = await Promise.all([
    getTeamDirectoryMap(season),
    mlbJson<{ dates?: Array<{ games?: Record<string, unknown>[] }> }>(
      "schedule",
      {
        sportId: 1,
        date: officialDate,
        hydrate: "probablePitcher",
      },
      HALF_HOUR_MS,
    ),
  ]);

  const games = json.dates?.flatMap((date) => date.games ?? []) ?? [];

  return games.map((game) => {
    const homeTeamId = asNumber(
      (
        (game.teams as Record<string, unknown> | undefined)?.home as
          | Record<string, unknown>
          | undefined
      )?.team &&
        (
          ((game.teams as Record<string, unknown> | undefined)?.home as
            | Record<string, unknown>
            | undefined)?.team as Record<string, unknown>
        ).id,
    ) ?? 0;
    const awayTeamId = asNumber(
      (
        (game.teams as Record<string, unknown> | undefined)?.away as
          | Record<string, unknown>
          | undefined
      )?.team &&
        (
          ((game.teams as Record<string, unknown> | undefined)?.away as
            | Record<string, unknown>
            | undefined)?.team as Record<string, unknown>
        ).id,
    ) ?? 0;

    const homeTeam = teamDirectory.get(homeTeamId);
    const awayTeam = teamDirectory.get(awayTeamId);
    const homeData = (game.teams as Record<string, unknown> | undefined)
      ?.home as Record<string, unknown> | undefined;
    const awayData = (game.teams as Record<string, unknown> | undefined)
      ?.away as Record<string, unknown> | undefined;

    return {
      gamePk: asNumber(game.gamePk) ?? 0,
      officialDate: asString(game.officialDate) ?? officialDate,
      gameDate: asString(game.gameDate) ?? officialDate,
      status:
        asString(
          (game.status as Record<string, unknown> | undefined)?.detailedState,
        ) ?? "Scheduled",
      dayNight: asString(game.dayNight),
      venue: {
        id: asNumber((game.venue as Record<string, unknown> | undefined)?.id) ?? 0,
        name:
          asString((game.venue as Record<string, unknown> | undefined)?.name) ??
          "Unknown Venue",
      },
      homeTeam: {
        id: homeTeamId,
        name: homeTeam?.name ?? "Unknown Team",
        abbreviation: homeTeam?.abbreviation ?? "UNK",
      },
      awayTeam: {
        id: awayTeamId,
        name: awayTeam?.name ?? "Unknown Team",
        abbreviation: awayTeam?.abbreviation ?? "UNK",
      },
      homeProbablePitcher: homeData?.probablePitcher
        ? {
            id:
              asNumber(
                (homeData.probablePitcher as Record<string, unknown>).id,
              ) ?? 0,
            fullName:
              asString(
                (homeData.probablePitcher as Record<string, unknown>).fullName,
              ) ?? "TBD",
          }
        : null,
      awayProbablePitcher: awayData?.probablePitcher
        ? {
            id:
              asNumber(
                (awayData.probablePitcher as Record<string, unknown>).id,
              ) ?? 0,
            fullName:
              asString(
                (awayData.probablePitcher as Record<string, unknown>).fullName,
              ) ?? "TBD",
          }
        : null,
    };
  });
}

export async function getGameByPk(
  gamePk: number,
  season = currentSeason(),
): Promise<GameSummary | null> {
  const games = await getGamesFromGamePk(gamePk, season);
  return games[0] ?? null;
}

async function getGamesFromGamePk(
  gamePk: number,
  season = currentSeason(),
): Promise<GameSummary[]> {
  const [teamDirectory, json] = await Promise.all([
    getTeamDirectoryMap(season),
    mlbJson<{ dates?: Array<{ games?: Record<string, unknown>[] }> }>(
      "schedule",
      {
        sportId: 1,
        gamePk,
        hydrate: "probablePitcher",
      },
      HALF_HOUR_MS,
    ),
  ]);

  const games = json.dates?.flatMap((date) => date.games ?? []) ?? [];
  return games.map((game) => {
    const homeTeamId = asNumber(
      (((game.teams as Record<string, unknown>).home as Record<string, unknown>).team as Record<
        string,
        unknown
      >).id,
    ) ?? 0;
    const awayTeamId = asNumber(
      (((game.teams as Record<string, unknown>).away as Record<string, unknown>).team as Record<
        string,
        unknown
      >).id,
    ) ?? 0;
    const homeData = (game.teams as Record<string, unknown>).home as Record<
      string,
      unknown
    >;
    const awayData = (game.teams as Record<string, unknown>).away as Record<
      string,
      unknown
    >;

    return {
      gamePk: asNumber(game.gamePk) ?? 0,
      officialDate: asString(game.officialDate) ?? todayIsoDate(),
      gameDate: asString(game.gameDate) ?? todayIsoDate(),
      status:
        asString(
          (game.status as Record<string, unknown> | undefined)?.detailedState,
        ) ?? "Scheduled",
      dayNight: asString(game.dayNight),
      venue: {
        id: asNumber((game.venue as Record<string, unknown> | undefined)?.id) ?? 0,
        name:
          asString((game.venue as Record<string, unknown> | undefined)?.name) ??
          "Unknown Venue",
      },
      homeTeam: {
        id: homeTeamId,
        name: teamDirectory.get(homeTeamId)?.name ?? "Unknown Team",
        abbreviation: teamDirectory.get(homeTeamId)?.abbreviation ?? "UNK",
      },
      awayTeam: {
        id: awayTeamId,
        name: teamDirectory.get(awayTeamId)?.name ?? "Unknown Team",
        abbreviation: teamDirectory.get(awayTeamId)?.abbreviation ?? "UNK",
      },
      homeProbablePitcher: homeData.probablePitcher
        ? {
            id:
              asNumber(
                (homeData.probablePitcher as Record<string, unknown>).id,
              ) ?? 0,
            fullName:
              asString(
                (homeData.probablePitcher as Record<string, unknown>).fullName,
              ) ?? "TBD",
          }
        : null,
      awayProbablePitcher: awayData.probablePitcher
        ? {
            id:
              asNumber(
                (awayData.probablePitcher as Record<string, unknown>).id,
              ) ?? 0,
            fullName:
              asString(
                (awayData.probablePitcher as Record<string, unknown>).fullName,
              ) ?? "TBD",
          }
        : null,
    };
  });
}

function parseHittingStatLine(stat: Record<string, unknown>): HittingStatLine {
  return {
    gamesPlayed: asNumber(stat.gamesPlayed),
    atBats: asNumber(stat.atBats),
    hits: asNumber(stat.hits),
    avg: asNumber(stat.avg),
    obp: asNumber(stat.obp),
    slg: asNumber(stat.slg),
    ops: asNumber(stat.ops),
    homeRuns: asNumber(stat.homeRuns),
    plateAppearances: asNumber(stat.plateAppearances),
    strikeOuts: asNumber(stat.strikeOuts),
    baseOnBalls: asNumber(stat.baseOnBalls),
    babip: asNumber(stat.babip),
  };
}

function parsePitchingStatLine(stat: Record<string, unknown>): PitchingStatLine {
  return {
    gamesPlayed: asNumber(stat.gamesPlayed),
    inningsPitched: asNumber(stat.inningsPitched),
    era: asNumber(stat.era),
    avg: asNumber(stat.avg),
    whip: asNumber(stat.whip),
    strikeOuts: asNumber(stat.strikeOuts),
    baseOnBalls: asNumber(stat.baseOnBalls),
    hits: asNumber(stat.hits),
    battersFaced: asNumber(stat.battersFaced),
  };
}

function parseFieldingStatLine(stat: Record<string, unknown>): FieldingStatLine {
  return {
    gamesPlayed: asNumber(stat.gamesPlayed),
    assists: asNumber(stat.assists),
    putOuts: asNumber(stat.putOuts),
    errors: asNumber(stat.errors),
    chances: asNumber(stat.chances),
    fielding: asNumber(stat.fielding),
  };
}

function extractStatSplit(json: Record<string, unknown>): Record<string, unknown> | null {
  const stats = json.stats as Array<Record<string, unknown>> | undefined;
  const splits = stats?.[0]?.splits as Array<Record<string, unknown>> | undefined;
  return (splits?.[0]?.stat as Record<string, unknown> | undefined) ?? null;
}

export async function getPlayerHittingStats(
  playerId: number,
  season = currentSeason(),
): Promise<HittingStatLine | null> {
  const json = await mlbJson<Record<string, unknown>>(
    `people/${playerId}/stats`,
    {
      stats: "season",
      group: "hitting",
      season,
      gameType: "R",
    },
    HALF_HOUR_MS,
  );

  const stat = extractStatSplit(json);
  return stat ? parseHittingStatLine(stat) : null;
}

export async function getPlayerPitchingStats(
  playerId: number,
  season = currentSeason(),
): Promise<PitchingStatLine | null> {
  const json = await mlbJson<Record<string, unknown>>(
    `people/${playerId}/stats`,
    {
      stats: "season",
      group: "pitching",
      season,
      gameType: "R",
    },
    HALF_HOUR_MS,
  );

  const stat = extractStatSplit(json);
  return stat ? parsePitchingStatLine(stat) : null;
}

export async function getTeamFieldingStats(
  teamId: number,
  season = currentSeason(),
): Promise<FieldingStatLine | null> {
  const json = await mlbJson<Record<string, unknown>>(
    `teams/${teamId}/stats`,
    {
      stats: "season",
      group: "fielding",
      season,
      gameType: "R",
    },
    HALF_HOUR_MS,
  );

  const stat = extractStatSplit(json);
  return stat ? parseFieldingStatLine(stat) : null;
}

export async function getVenueById(
  venueId: number,
  season = currentSeason(),
): Promise<VenueSnapshot | null> {
  const json = await mlbJson<{ venues?: Array<Record<string, unknown>> }>(
    "venues",
    {
      venueIds: venueId,
      season,
      hydrate: "location,fieldInfo",
    },
    DAY_MS,
  );

  const venue = json.venues?.[0];

  if (!venue) {
    return null;
  }

  const location = venue.location as Record<string, unknown> | undefined;
  const fieldInfo = venue.fieldInfo as Record<string, unknown> | undefined;
  const coordinates =
    location?.defaultCoordinates as Record<string, unknown> | undefined;

  return {
    venueId,
    name: asString(venue.name) ?? "Unknown Venue",
    latitude: asNumber(coordinates?.latitude),
    longitude: asNumber(coordinates?.longitude),
    elevationFeet: asNumber(location?.elevation),
    azimuthAngle: asNumber(location?.azimuthAngle),
    roofType: asString(fieldInfo?.roofType),
    turfType: asString(fieldInfo?.turfType),
    dimensions: {
      leftLine: asNumber(fieldInfo?.leftLine),
      left: asNumber(fieldInfo?.left),
      leftCenter: asNumber(fieldInfo?.leftCenter),
      center: asNumber(fieldInfo?.center),
      rightCenter: asNumber(fieldInfo?.rightCenter),
      rightLine: asNumber(fieldInfo?.rightLine),
    },
  };
}

export async function getLineupContext(
  gamePk: number,
  playerId: number,
): Promise<{ lineupSlot: number | null }> {
  try {
    const json = await mlbFeedJson<Record<string, unknown>>(`game/${gamePk}/feed/live`);
    const teams = (
      ((json.liveData as Record<string, unknown> | undefined)?.boxscore as
        | Record<string, unknown>
        | undefined)?.teams as Record<string, unknown> | undefined
    ) ?? { home: {}, away: {} };

    for (const side of ["home", "away"] as const) {
      const teamBoxscore = teams[side] as Record<string, unknown> | undefined;
      const players = teamBoxscore?.players as
        | Record<string, Record<string, unknown>>
        | undefined;

      if (!players) {
        continue;
      }

      const player = Object.values(players).find(
        (candidate) =>
          asNumber((candidate.person as Record<string, unknown> | undefined)?.id) ===
          playerId,
      );

      if (!player) {
        continue;
      }

      const battingOrder = asString(player.battingOrder);
      const lineupSlot = battingOrder ? Number(battingOrder[0]) : null;

      return {
        lineupSlot:
          lineupSlot && Number.isFinite(lineupSlot)
            ? Math.max(1, Math.min(9, lineupSlot))
            : null,
      };
    }
  } catch {
    return {
      lineupSlot: null,
    };
  }

  return {
    lineupSlot: null,
  };
}

export async function getStartingLineupPlayers(
  gamePk: number,
  season = currentSeason(),
): Promise<StartingLineupPlayer[]> {
  const [json, game, teamDirectory] = await Promise.all([
    mlbFeedJson<Record<string, unknown>>(`game/${gamePk}/feed/live`),
    getGameByPk(gamePk, season),
    getTeamDirectoryMap(season),
  ]);

  if (!game) {
    throw new Error("Game not found.");
  }

  const teams = (
    ((json.liveData as Record<string, unknown> | undefined)?.boxscore as
      | Record<string, unknown>
      | undefined)?.teams as Record<string, unknown> | undefined
  ) ?? { home: {}, away: {} };

  const lineupPlayers: StartingLineupPlayer[] = [];

  for (const side of ["home", "away"] as const) {
    const teamBoxscore = teams[side] as Record<string, unknown> | undefined;
    const players = teamBoxscore?.players as
      | Record<string, Record<string, unknown>>
      | undefined;
    const teamId = asNumber((teamBoxscore?.team as Record<string, unknown> | undefined)?.id);
    const team =
      (teamId ? teamDirectory.get(teamId) : null) ??
      (side === "home" ? game.homeTeam : game.awayTeam);

    if (!players) {
      continue;
    }

    for (const candidate of Object.values(players)) {
      const battingOrder = asString(candidate.battingOrder);
      const positionAbbreviation = asString(
        (candidate.position as Record<string, unknown> | undefined)?.abbreviation,
      );
      const person = candidate.person as Record<string, unknown> | undefined;
      const playerId = asNumber(person?.id);

      if (!battingOrder || !playerId || positionAbbreviation === "P") {
        continue;
      }

      const lineupSlot = Number(battingOrder[0]);
      const player = await getPlayerById(playerId, season);

      if (!player) {
        continue;
      }

      lineupPlayers.push({
        player,
        team: {
          id: team.id,
          name: team.name,
          abbreviation: team.abbreviation,
        },
        lineupSlot:
          Number.isFinite(lineupSlot) && lineupSlot > 0
            ? Math.max(1, Math.min(9, lineupSlot))
            : null,
      });
    }
  }

  return lineupPlayers.sort((left, right) => {
    if (left.team.id !== right.team.id) {
      return left.team.abbreviation.localeCompare(right.team.abbreviation);
    }

    return (left.lineupSlot ?? 99) - (right.lineupSlot ?? 99);
  });
}
