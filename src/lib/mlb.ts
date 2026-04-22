import { fetchWithRetry, remember } from "@/lib/cache";
import {
  type BatterRecentGameLine,
  type FieldingStatLine,
  type GameSummary,
  type HittingStatLine,
  type LineupCardPlayer,
  type LineupStatus,
  type PitchingStatLine,
  type PlayerSearchResult,
  type PreviousSeriesGame,
  type StartingLineupPlayer,
  type TeamDirectoryEntry,
  type TeamGameInfo,
  type VenueSnapshot,
} from "@/lib/types";
import { asNumber, asString, minusDays, normalizeSearch, todayIsoDate } from "@/lib/utils";

const MLB_BASE_URL = "https://statsapi.mlb.com/api/v1";
const MLB_FEED_BASE_URL = "https://statsapi.mlb.com/api/v1.1";
const LIVE_GAME_TTL_MS = 5 * 1000;
const SCHEDULE_TTL_MS = 30 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TeamRecentGameSummary {
  gamePk: number;
  date: string;
  opponent: TeamGameInfo;
  isHome: boolean;
  teamScore: number | null;
  opponentScore: number | null;
  result: "win" | "loss" | "pending";
}

export interface TeamBullpenUsageSummary {
  recentInnings: number | null;
  backToBackRelievers: number | null;
  fatigueScore: number | null;
}

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
    const response = await fetchWithRetry(url, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    }, {
      retries: 2,
      timeoutMs: 9000,
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
    const response = await fetchWithRetry(url, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    }, {
      retries: 2,
      timeoutMs: 9000,
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

function mapProbablePitcher(
  probablePitcher: unknown,
): GameSummary["homeProbablePitcher"] {
  if (!probablePitcher) {
    return null;
  }

  const pitcher = probablePitcher as Record<string, unknown>;

  return {
    id: asNumber(pitcher.id) ?? 0,
    fullName: asString(pitcher.fullName) ?? "TBD",
    pitchHand:
      asString((pitcher.pitchHand as Record<string, unknown> | undefined)?.code) ??
      null,
  };
}

async function getPlayerPitchHand(playerId: number): Promise<string | null> {
  if (!playerId) {
    return null;
  }

  const json = await mlbJson<{ people?: Record<string, unknown>[] }>(
    `people/${playerId}`,
    undefined,
    HALF_HOUR_MS,
  );
  const person = json.people?.[0];

  return (
    asString((person?.pitchHand as Record<string, unknown> | undefined)?.code) ??
    null
  );
}

async function enrichProbablePitcherHand(
  pitcher: GameSummary["homeProbablePitcher"],
): Promise<GameSummary["homeProbablePitcher"]> {
  if (!pitcher || pitcher.pitchHand) {
    return pitcher;
  }

  return {
    ...pitcher,
    pitchHand: await getPlayerPitchHand(pitcher.id),
  };
}

async function enrichGamePitcherHands(game: GameSummary): Promise<GameSummary> {
  const [homeProbablePitcher, awayProbablePitcher] = await Promise.all([
    enrichProbablePitcherHand(game.homeProbablePitcher),
    enrichProbablePitcherHand(game.awayProbablePitcher),
  ]);

  return {
    ...game,
    homeProbablePitcher,
    awayProbablePitcher,
  };
}

function shouldHydrateLiveScore(game: GameSummary) {
  const status = game.status.toLowerCase();
  const hasScore =
    game.homeScore !== null &&
    game.homeScore !== undefined &&
    game.awayScore !== null &&
    game.awayScore !== undefined;
  const isFinished =
    status.includes("final") ||
    status.includes("game over") ||
    status.includes("completed");

  return !isFinished && (
    status.includes("live") ||
    status.includes("progress") ||
    status.includes("delayed") ||
    status.includes("suspended") ||
    hasScore
  );
}

async function enrichLiveScore(game: GameSummary): Promise<GameSummary> {
  if (!shouldHydrateLiveScore(game)) {
    return game;
  }

  try {
    const json = await mlbFeedJson<Record<string, unknown>>(
      `game/${game.gamePk}/feed/live`,
      LIVE_GAME_TTL_MS,
    );
    const gameData = json.gameData as Record<string, unknown> | undefined;
    const liveData = json.liveData as Record<string, unknown> | undefined;
    const status = gameData?.status as Record<string, unknown> | undefined;
    const linescore = liveData?.linescore as Record<string, unknown> | undefined;
    const teams = linescore?.teams as Record<string, unknown> | undefined;
    const home = teams?.home as Record<string, unknown> | undefined;
    const away = teams?.away as Record<string, unknown> | undefined;
    const inningState = asString(linescore?.inningState);
    const inning = asString(linescore?.currentInningOrdinal);
    const detailedState = asString(status?.detailedState) ?? game.status;
    const liveStatus =
      inning && inningState && detailedState.toLowerCase().includes("progress")
        ? `${inningState} ${inning}`
        : detailedState;

    return {
      ...game,
      status: liveStatus,
      homeScore: asNumber(home?.runs) ?? game.homeScore,
      awayScore: asNumber(away?.runs) ?? game.awayScore,
    };
  } catch {
    return game;
  }
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
      SCHEDULE_TTL_MS,
    ),
  ]);

  const games = json.dates?.flatMap((date) => date.games ?? []) ?? [];

  const summaries = games.map((game) => {
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
      homeScore: asNumber(homeData?.score),
      awayScore: asNumber(awayData?.score),
      homeProbablePitcher: mapProbablePitcher(homeData?.probablePitcher),
      awayProbablePitcher: mapProbablePitcher(awayData?.probablePitcher),
    };
  });

  const withPitcherHands = await Promise.all(summaries.map((game) => enrichGamePitcherHands(game)));
  return Promise.all(withPitcherHands.map((game) => enrichLiveScore(game)));
}

export async function getGameByPk(
  gamePk: number,
  season = currentSeason(),
): Promise<GameSummary | null> {
  const games = await getGamesFromGamePk(gamePk, season);
  return games[0] ?? null;
}

export async function getPreviousSeriesGames(input: {
  homeTeamId: number;
  awayTeamId: number;
  beforeDate: string;
  season?: number;
  lookbackDays?: number;
  limit?: number;
}): Promise<PreviousSeriesGame[]> {
  const season = input.season ?? currentSeason();
  const lookbackDays = input.lookbackDays ?? 7;
  const limit = input.limit ?? 4;
  const teamIds = new Set([input.homeTeamId, input.awayTeamId]);
  const dates = Array.from({ length: lookbackDays }, (_, index) =>
    minusDays(input.beforeDate, index + 1),
  );
  const gamesByDate = await Promise.all(dates.map((date) => getGamesByDate(date, season)));

  return gamesByDate
    .flat()
    .filter((game) => teamIds.has(game.homeTeam.id) && teamIds.has(game.awayTeam.id))
    .filter((game) => game.homeScore !== null && game.awayScore !== null)
    .sort((left, right) => right.officialDate.localeCompare(left.officialDate))
    .slice(0, limit)
    .map((game) => ({
      gamePk: game.gamePk,
      officialDate: game.officialDate,
      status: game.status,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      winner:
        game.homeScore === null || game.awayScore === null || game.homeScore === game.awayScore
          ? null
          : game.homeScore > game.awayScore
            ? "home"
            : "away",
    }));
}

export async function getPlayerGameBattingLine(
  gamePk: number,
  playerId: number,
): Promise<{ hits: number; homeRuns: number; atBats: number } | null> {
  const json = await mlbFeedJson<Record<string, unknown>>(
    `game/${gamePk}/feed/live`,
    LIVE_GAME_TTL_MS,
  );
  const teams = (
    ((json.liveData as Record<string, unknown> | undefined)?.boxscore as
      | Record<string, unknown>
      | undefined)?.teams as Record<string, unknown> | undefined
  ) ?? { home: {}, away: {} };
  const homePlayers = (teams.home as Record<string, unknown> | undefined)?.players as
    | Record<string, Record<string, unknown>>
    | undefined;
  const awayPlayers = (teams.away as Record<string, unknown> | undefined)?.players as
    | Record<string, Record<string, unknown>>
    | undefined;
  const players = {
    ...(homePlayers ?? {}),
    ...(awayPlayers ?? {}),
  };
  const player =
    players[`ID${playerId}`] ??
    Object.values(players).find(
      (entry) => asNumber((entry.person as Record<string, unknown> | undefined)?.id) === playerId,
    );
  const batting = player?.stats
    ? ((player.stats as Record<string, unknown>).batting as Record<string, unknown> | undefined)
    : undefined;

  if (!batting) {
    return null;
  }

  return {
    hits: asNumber(batting.hits) ?? 0,
    homeRuns: asNumber(batting.homeRuns) ?? 0,
    atBats: asNumber(batting.atBats) ?? 0,
  };
}

export async function getLiveGameStatus(gamePk: number): Promise<string | null> {
  const json = await mlbFeedJson<Record<string, unknown>>(
    `game/${gamePk}/feed/live`,
    LIVE_GAME_TTL_MS,
  );

  return (
    asString(
      ((json.gameData as Record<string, unknown> | undefined)?.status as
        | Record<string, unknown>
        | undefined)?.detailedState,
    ) ??
    asString(
      ((json.gameData as Record<string, unknown> | undefined)?.status as
        | Record<string, unknown>
        | undefined)?.abstractGameState,
    )
  );
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
  const summaries = games.map((game) => {
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
      homeScore: asNumber(homeData.score),
      awayScore: asNumber(awayData.score),
      homeProbablePitcher: mapProbablePitcher(homeData.probablePitcher),
      awayProbablePitcher: mapProbablePitcher(awayData.probablePitcher),
    };
  });

  return Promise.all(summaries.map((game) => enrichGamePitcherHands(game)));
}

function parseHittingStatLine(stat: Record<string, unknown>): HittingStatLine {
  return {
    gamesPlayed: asNumber(stat.gamesPlayed),
    atBats: asNumber(stat.atBats),
    runs: asNumber(stat.runs),
    hits: asNumber(stat.hits),
    avg: asNumber(stat.avg),
    obp: asNumber(stat.obp),
    slg: asNumber(stat.slg),
    ops: asNumber(stat.ops),
    homeRuns: asNumber(stat.homeRuns),
    doubles: asNumber(stat.doubles),
    triples: asNumber(stat.triples),
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
    homeRuns: asNumber(stat.homeRuns),
    runs: asNumber(stat.runs),
    earnedRuns: asNumber(stat.earnedRuns),
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

export async function getPlayerRecentBattingGameLog(
  playerId: number,
  season = currentSeason(),
  limit = 5,
): Promise<BatterRecentGameLine[]> {
  const json = await mlbJson<Record<string, unknown>>(
    `people/${playerId}/stats`,
    {
      stats: "gameLog",
      group: "hitting",
      season,
      gameType: "R",
    },
    HALF_HOUR_MS,
  );
  const stats = json.stats as Array<Record<string, unknown>> | undefined;
  const splits = stats?.[0]?.splits as Array<Record<string, unknown>> | undefined;

  return (splits ?? [])
    .map((split): BatterRecentGameLine => {
      const stat = (split.stat as Record<string, unknown> | undefined) ?? {};
      const game = (split.game as Record<string, unknown> | undefined) ?? {};
      const opponent = split.opponent as Record<string, unknown> | undefined;

      return {
        gamePk: asNumber(game.gamePk),
        date: asString(split.date) ?? "",
        opponent: asString(opponent?.abbreviation) ?? asString(opponent?.name),
        atBats: asNumber(stat.atBats) ?? 0,
        runs: asNumber(stat.runs) ?? 0,
        hits: asNumber(stat.hits) ?? 0,
        rbi: asNumber(stat.rbi) ?? 0,
        homeRuns: asNumber(stat.homeRuns) ?? 0,
      };
    })
    .filter((line) => line.date)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, limit);
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

export async function getTeamHittingStats(
  teamId: number,
  season = currentSeason(),
): Promise<HittingStatLine | null> {
  const json = await mlbJson<Record<string, unknown>>(
    `teams/${teamId}/stats`,
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

export async function getTeamPitchingStats(
  teamId: number,
  season = currentSeason(),
): Promise<PitchingStatLine | null> {
  const json = await mlbJson<Record<string, unknown>>(
    `teams/${teamId}/stats`,
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

function isoDateOffset(date: string, days: number) {
  const nextDate = new Date(`${date}T12:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate.toISOString().slice(0, 10);
}

export async function getTeamRecentGameSummaries(
  teamId: number,
  beforeDate: string,
  season = currentSeason(),
  limit = 10,
): Promise<TeamRecentGameSummary[]> {
  const [teamDirectory, json] = await Promise.all([
    getTeamDirectoryMap(season),
    mlbJson<{ dates?: Array<{ games?: Record<string, unknown>[] }> }>(
      "schedule",
      {
        sportId: 1,
        teamId,
        startDate: isoDateOffset(beforeDate, -21),
        endDate: isoDateOffset(beforeDate, -1),
      },
      HALF_HOUR_MS,
    ),
  ]);
  const games = json.dates?.flatMap((date) => date.games ?? []) ?? [];

  return games
    .flatMap((game): TeamRecentGameSummary[] => {
      const teams = (game.teams as Record<string, unknown> | undefined) ?? {};
      const home = teams.home as Record<string, unknown> | undefined;
      const away = teams.away as Record<string, unknown> | undefined;
      const homeTeamRaw = home?.team as Record<string, unknown> | undefined;
      const awayTeamRaw = away?.team as Record<string, unknown> | undefined;
      const homeTeamId = asNumber(homeTeamRaw?.id);
      const awayTeamId = asNumber(awayTeamRaw?.id);
      const isHome = homeTeamId === teamId;
      const isAway = awayTeamId === teamId;

      if (!isHome && !isAway) {
        return [];
      }

      const opponentId = isHome ? awayTeamId : homeTeamId;
      const opponent = opponentId ? teamDirectory.get(opponentId) : undefined;
      const teamScore = asNumber((isHome ? home : away)?.score);
      const opponentScore = asNumber((isHome ? away : home)?.score);
      const result =
        teamScore === null || opponentScore === null
          ? "pending"
          : teamScore > opponentScore
            ? "win"
            : "loss";

      return [
        {
          gamePk: asNumber(game.gamePk) ?? 0,
          date: asString(game.officialDate) ?? beforeDate,
          opponent: {
            id: opponentId ?? 0,
            name: opponent?.name ?? "Unknown Team",
            abbreviation: opponent?.abbreviation ?? "UNK",
          },
          isHome,
          teamScore,
          opponentScore,
          result,
        },
      ];
    })
    .filter((game) => game.gamePk && game.date < beforeDate)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, limit);
}

function baseballInningsToNumber(value: unknown) {
  const text = asString(value);

  if (!text) {
    return 0;
  }

  const [wholeText, outsText] = text.split(".");
  const whole = Number(wholeText);
  const outs = Number(outsText ?? 0);

  if (!Number.isFinite(whole) || !Number.isFinite(outs)) {
    return 0;
  }

  return whole + Math.min(Math.max(outs, 0), 2) / 3;
}

async function getRelieverUsageForGame(gamePk: number, teamId: number) {
  const json = await mlbFeedJson<Record<string, unknown>>(
    `game/${gamePk}/feed/live`,
    LIVE_GAME_TTL_MS,
  );
  const teams = (
    ((json.liveData as Record<string, unknown> | undefined)?.boxscore as
      | Record<string, unknown>
      | undefined)?.teams as Record<string, unknown> | undefined
  ) ?? { home: {}, away: {} };
  const side = asNumber(
    ((teams.home as Record<string, unknown> | undefined)?.team as
      | Record<string, unknown>
      | undefined)?.id,
  ) === teamId
    ? "home"
    : "away";
  const teamBoxscore = teams[side] as Record<string, unknown> | undefined;
  const players = teamBoxscore?.players as
    | Record<string, Record<string, unknown>>
    | undefined;

  if (!players) {
    return [];
  }

  return Object.values(players).flatMap((player) => {
    const stats = player.stats as Record<string, unknown> | undefined;
    const pitching = stats?.pitching as Record<string, unknown> | undefined;
    const person = player.person as Record<string, unknown> | undefined;
    const playerId = asNumber(person?.id);

    if (!pitching || !playerId) {
      return [];
    }

    const innings = baseballInningsToNumber(pitching.inningsPitched);
    const gamesStarted = asNumber(pitching.gamesStarted) ?? 0;

    if (innings <= 0 || gamesStarted > 0) {
      return [];
    }

    return [
      {
        playerId,
        innings,
      },
    ];
  });
}

export async function getTeamBullpenUsageSummary(
  teamId: number,
  beforeDate: string,
  season = currentSeason(),
): Promise<TeamBullpenUsageSummary> {
  const recentGames = await getTeamRecentGameSummaries(teamId, beforeDate, season, 3);
  const finalGames = recentGames.filter((game) => game.result !== "pending");

  if (finalGames.length === 0) {
    return {
      recentInnings: null,
      backToBackRelievers: null,
      fatigueScore: null,
    };
  }

  try {
    const usageByGame = await Promise.all(
      finalGames.map((game) => getRelieverUsageForGame(game.gamePk, teamId)),
    );
    const recentInnings = usageByGame
      .flat()
      .reduce((sum, entry) => sum + entry.innings, 0);
    const latest = new Set(usageByGame[0]?.map((entry) => entry.playerId) ?? []);
    const previous = new Set(usageByGame[1]?.map((entry) => entry.playerId) ?? []);
    const backToBackRelievers = [...latest].filter((playerId) => previous.has(playerId)).length;
    const fatigueScore = Math.min(1, recentInnings / 12 + backToBackRelievers * 0.12);

    return {
      recentInnings,
      backToBackRelievers,
      fatigueScore,
    };
  } catch {
    return {
      recentInnings: null,
      backToBackRelievers: null,
      fatigueScore: null,
    };
  }
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

export async function getGameLineupStatus(gamePk: number): Promise<{
  status: LineupStatus;
  homeCount: number;
  awayCount: number;
  totalCount: number;
  homePlayers: LineupCardPlayer[];
  awayPlayers: LineupCardPlayer[];
}> {
  try {
    const json = await mlbFeedJson<Record<string, unknown>>(
      `game/${gamePk}/feed/live`,
      LIVE_GAME_TTL_MS,
    );
    const teams = (
      ((json.liveData as Record<string, unknown> | undefined)?.boxscore as
        | Record<string, unknown>
        | undefined)?.teams as Record<string, unknown> | undefined
    ) ?? { home: {}, away: {} };

    function getLineupPlayers(side: "home" | "away") {
      const teamBoxscore = teams[side] as Record<string, unknown> | undefined;
      const players = teamBoxscore?.players as
        | Record<string, Record<string, unknown>>
        | undefined;

      if (!players) {
        return [];
      }

      return Object.values(players)
        .flatMap((candidate): LineupCardPlayer[] => {
          const battingOrder = asString(candidate.battingOrder);
          const positionAbbreviation = asString(
            (candidate.position as Record<string, unknown> | undefined)?.abbreviation,
          );
          const person = candidate.person as Record<string, unknown> | undefined;
          const playerId = asNumber(person?.id);
          const fullName = asString(person?.fullName);
          const batSide =
            asString((person?.batSide as Record<string, unknown> | undefined)?.code) ?? null;
          const lineupSlot = battingOrder ? Number(battingOrder[0]) : null;

          if (!battingOrder || !playerId || !fullName || positionAbbreviation === "P") {
            return [];
          }

          return [
            {
              id: playerId,
              fullName,
              lineupSlot:
                lineupSlot && Number.isFinite(lineupSlot)
                  ? Math.max(1, Math.min(9, lineupSlot))
                  : null,
              primaryPosition: positionAbbreviation ?? null,
              batSide,
            },
          ];
        })
        .sort((left, right) => (left.lineupSlot ?? 99) - (right.lineupSlot ?? 99));
    }

    const homePlayers = getLineupPlayers("home");
    const awayPlayers = getLineupPlayers("away");
    const homeCount = homePlayers.length;
    const awayCount = awayPlayers.length;
    const totalCount = homeCount + awayCount;
    const status: LineupStatus =
      homeCount >= 9 && awayCount >= 9
        ? "released"
        : totalCount > 0
          ? "partial"
          : "pending";

    return {
      status,
      homeCount,
      awayCount,
      totalCount,
      homePlayers,
      awayPlayers,
    };
  } catch {
    return {
      status: "pending",
      homeCount: 0,
      awayCount: 0,
      totalCount: 0,
      homePlayers: [],
      awayPlayers: [],
    };
  }
}
