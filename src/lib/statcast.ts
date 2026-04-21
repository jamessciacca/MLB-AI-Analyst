import Papa from "papaparse";

import { remember } from "@/lib/cache";
import {
  type ExpectedStatsLine,
  type PitchMixEntry,
  type SprintSpeedLine,
  type StatcastEventRow,
  type TeamDefenseSnapshot,
} from "@/lib/types";
import { asNumber, asString } from "@/lib/utils";

const HOUR_MS = 60 * 60 * 1000;
const SAVANT_CACHE_MS = 2 * HOUR_MS;

const PITCH_FIELD_TO_ENTRY = {
  n_ff: { code: "FF", label: "4-seam fastball" },
  n_si: { code: "SI", label: "sinker" },
  n_fc: { code: "FC", label: "cutter" },
  n_sl: { code: "SL", label: "slider" },
  n_ch: { code: "CH", label: "changeup" },
  n_cu: { code: "CU", label: "curveball" },
  n_fs: { code: "FS", label: "splitter" },
  n_kn: { code: "KN", label: "knuckleball" },
  n_st: { code: "ST", label: "sweeper" },
  n_sv: { code: "SV", label: "slurve" },
} as const;

const TEAM_DISPLAY_LOOKUP: Record<string, string> = {
  "arizona diamondbacks": "Diamondbacks",
  "atlanta braves": "Braves",
  "baltimore orioles": "Orioles",
  "boston red sox": "Red Sox",
  "chicago cubs": "Cubs",
  "chicago white sox": "White Sox",
  "cincinnati reds": "Reds",
  "cleveland guardians": "Guardians",
  "colorado rockies": "Rockies",
  "detroit tigers": "Tigers",
  "houston astros": "Astros",
  "kansas city royals": "Royals",
  "los angeles angels": "Angels",
  "los angeles dodgers": "Dodgers",
  "miami marlins": "Marlins",
  "milwaukee brewers": "Brewers",
  "minnesota twins": "Twins",
  "new york mets": "Mets",
  "new york yankees": "Yankees",
  "athletics": "Athletics",
  "oakland athletics": "Athletics",
  "philadelphia phillies": "Phillies",
  "pittsburgh pirates": "Pirates",
  "san diego padres": "Padres",
  "san francisco giants": "Giants",
  "seattle mariners": "Mariners",
  "st. louis cardinals": "Cardinals",
  "tampa bay rays": "Rays",
  "texas rangers": "Rangers",
  "toronto blue jays": "Blue Jays",
  "washington nationals": "Nationals",
};

type CsvRow = Record<string, string>;

async function fetchCsvRows(url: string): Promise<CsvRow[]> {
  return remember(url, SAVANT_CACHE_MS, async () => {
    const response = await fetch(url, {
      headers: {
        Accept: "text/csv",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Statcast request failed: ${response.status} ${url}`);
    }

    const csv = await response.text();
    const parsed = Papa.parse<CsvRow>(csv, {
      header: true,
      skipEmptyLines: true,
    });

    if (parsed.errors.length > 0) {
      throw new Error(parsed.errors[0]?.message ?? "Unable to parse Statcast CSV");
    }

    return parsed.data;
  });
}

function currentSeason() {
  return new Date().getFullYear();
}

function canonicalTeamDisplayName(teamName: string): string {
  return TEAM_DISPLAY_LOOKUP[teamName.trim().toLowerCase()] ?? teamName.trim();
}

function mapExpectedStatsRow(row: CsvRow): ExpectedStatsLine {
  return {
    playerId: asNumber(row.player_id) ?? 0,
    playerName: asString(row["last_name, first_name"]) ?? "Unknown Player",
    plateAppearances: asNumber(row.pa),
    ballsInPlay: asNumber(row.bip),
    battingAverage: asNumber(row.ba),
    expectedBattingAverage: asNumber(row.est_ba),
    slugging: asNumber(row.slg),
    expectedSlugging: asNumber(row.est_slg),
    woba: asNumber(row.woba),
    expectedWoba: asNumber(row.est_woba),
    era: asNumber(row.era),
    expectedEra: asNumber(row.xera),
  };
}

async function getExpectedStatsMap(
  type: "batter" | "pitcher",
  season = currentSeason(),
): Promise<Map<number, ExpectedStatsLine>> {
  const url = `https://baseballsavant.mlb.com/expected_statistics?type=${type}&year=${season}&position=&team=&min=1&csv=true`;
  const rows = await fetchCsvRows(url);

  return new Map(
    rows.map((row) => {
      const mapped = mapExpectedStatsRow(row);
      return [mapped.playerId, mapped] as const;
    }),
  );
}

export async function getBatterExpectedStats(
  playerId: number,
  season = currentSeason(),
): Promise<ExpectedStatsLine | null> {
  return (await getExpectedStatsMap("batter", season)).get(playerId) ?? null;
}

export async function getPitcherExpectedStats(
  playerId: number,
  season = currentSeason(),
): Promise<ExpectedStatsLine | null> {
  return (await getExpectedStatsMap("pitcher", season)).get(playerId) ?? null;
}

async function getSprintSpeedMap(
  season = currentSeason(),
): Promise<Map<number, SprintSpeedLine>> {
  const url = `https://baseballsavant.mlb.com/sprint_speed_leaderboard?year=${season}&position=&team=&min=0&csv=true`;
  const rows = await fetchCsvRows(url);

  return new Map(
    rows.map((row) => [
      asNumber(row.player_id) ?? 0,
      {
        playerId: asNumber(row.player_id) ?? 0,
        sprintSpeed: asNumber(row.sprint_speed),
        competitiveRuns: asNumber(row.competitive_runs),
        homeToFirst: asNumber(row.hp_to_1b),
      },
    ]),
  );
}

export async function getSprintSpeed(
  playerId: number,
  season = currentSeason(),
): Promise<SprintSpeedLine | null> {
  return (await getSprintSpeedMap(season)).get(playerId) ?? null;
}

async function getPitchMixMap(
  season = currentSeason(),
): Promise<Map<number, PitchMixEntry[]>> {
  const url = `https://baseballsavant.mlb.com/pitch-arsenals?year=${season}&min=50&type=n_&hand=&csv=true`;
  const rows = await fetchCsvRows(url);

  return new Map(
    rows.map((row) => {
      const pitcherId = asNumber(row.pitcher) ?? 0;
      const mix: PitchMixEntry[] = [];

      for (const [field, metadata] of Object.entries(PITCH_FIELD_TO_ENTRY)) {
        const usage = asNumber(row[field]);

        if (usage && usage > 0) {
          mix.push({
            code: metadata.code,
            label: metadata.label,
            usage,
          });
        }
      }

      mix.sort((left, right) => right.usage - left.usage);

      return [pitcherId, mix] as const;
    }),
  );
}

export async function getPitchMix(
  pitcherId: number,
  season = currentSeason(),
): Promise<PitchMixEntry[]> {
  return (await getPitchMixMap(season)).get(pitcherId) ?? [];
}

async function getTeamDefenseExtrasMap(
  season = currentSeason(),
): Promise<Map<string, TeamDefenseSnapshot>> {
  const [oaaRows, armRows] = await Promise.all([
    fetchCsvRows(
      `https://baseballsavant.mlb.com/leaderboard/outs_above_average?type=Fielder&year=${season}&team=&range=year&min=0&pos=&roles=&viz=show&csv=true`,
    ),
    fetchCsvRows(
      `https://baseballsavant.mlb.com/leaderboard/arm-strength?type=team&year=${season}&pos=&team=&minThrows=50&csv=true`,
    ),
  ]);

  const map = new Map<string, TeamDefenseSnapshot>();

  for (const row of oaaRows) {
    const displayName = canonicalTeamDisplayName(
      asString(row.display_team_name) ?? "Unknown Team",
    );
    const existing = map.get(displayName) ?? {
      teamName: displayName,
      fieldingPct: null,
      errors: null,
      chances: null,
      oaa: 0,
      fieldingRunsPrevented: 0,
      armOverall: null,
    };

    existing.oaa = (existing.oaa ?? 0) + (asNumber(row.outs_above_average) ?? 0);
    existing.fieldingRunsPrevented =
      (existing.fieldingRunsPrevented ?? 0) +
      (asNumber(row.fielding_runs_prevented) ?? 0);
    map.set(displayName, existing);
  }

  for (const row of armRows) {
    const displayName = canonicalTeamDisplayName(
      asString(row.team_name) ?? "Unknown Team",
    );
    const existing = map.get(displayName) ?? {
      teamName: displayName,
      fieldingPct: null,
      errors: null,
      chances: null,
      oaa: null,
      fieldingRunsPrevented: null,
      armOverall: null,
    };

    existing.armOverall = asNumber(row.arm_overall);
    map.set(displayName, existing);
  }

  return map;
}

export async function getTeamDefenseExtras(
  teamName: string,
  season = currentSeason(),
): Promise<Pick<TeamDefenseSnapshot, "oaa" | "fieldingRunsPrevented" | "armOverall"> | null> {
  const displayName = canonicalTeamDisplayName(teamName);
  const row = (await getTeamDefenseExtrasMap(season)).get(displayName);

  if (!row) {
    return null;
  }

  return {
    oaa: row.oaa,
    fieldingRunsPrevented: row.fieldingRunsPrevented,
    armOverall: row.armOverall,
  };
}

function buildStatcastSearchUrl(
  playerType: "batter" | "pitcher",
  playerId: number,
  startDate: string,
  endDate: string,
  season = currentSeason(),
  opponentId?: number,
): string {
  const params = new URLSearchParams({
    all: "true",
    hfPT: "",
    hfAB: "",
    hfBBT: "",
    hfPR: "",
    hfZ: "",
    stadium: "",
    hfBBL: "",
    hfNewZones: "",
    hfGT: "R|PO|S|",
    hfC: "",
    hfSea: `${season}|`,
    hfSit: "",
    hfOuts: "",
    opponent: "",
    pitcher_throws: "",
    batter_stands: "",
    hfSA: "",
    player_type: playerType,
    hfInfield: "",
    team: "",
    position: "",
    hfOutfield: "",
    hfRO: "",
    home_road: "",
    game_date_gt: startDate,
    game_date_lt: endDate,
    hfFlag: "",
    hfPull: "",
    metric_1: "",
    hfInn: "",
    min_pitches: "0",
    min_results: "0",
    group_by: "name",
    sort_col: "pitches",
    player_event_sort: "h_launch_speed",
    sort_order: "desc",
    min_abs: "0",
    type: "details",
  });

  params.set(playerType === "pitcher" ? "pitchers_lookup[]" : "batters_lookup[]", String(playerId));

  if (opponentId) {
    params.set(playerType === "pitcher" ? "batters_lookup[]" : "pitchers_lookup[]", String(opponentId));
  }

  return `https://baseballsavant.mlb.com/statcast_search/csv?${params.toString()}`;
}

function mapStatcastEventRow(row: CsvRow): StatcastEventRow {
  return {
    gameDate: asString(row.game_date) ?? "",
    batterId: asNumber(row.batter),
    pitcherId: asNumber(row.pitcher),
    pitchType: asString(row.pitch_type),
    pitchName: asString(row.pitch_name),
    playerName: asString(row.player_name),
    events: asString(row.events),
    description: asString(row.description),
    batterStand: asString(row.stand),
    pitcherThrows: asString(row.p_throws),
    launchSpeed: asNumber(row.launch_speed),
    launchAngle: asNumber(row.launch_angle),
    estimatedBattingAverage: asNumber(row.estimated_ba_using_speedangle),
    estimatedWoba: asNumber(row.estimated_woba_using_speedangle),
    gameType: asString(row.game_type),
  };
}

async function getStatcastSearchRows(
  playerType: "batter" | "pitcher",
  playerId: number,
  endDate: string,
  season = currentSeason(),
  opponentId?: number,
): Promise<StatcastEventRow[]> {
  const startDate = `${season}-03-01`;
  const url = buildStatcastSearchUrl(playerType, playerId, startDate, endDate, season, opponentId);
  const rows = await fetchCsvRows(url);

  return rows
    .map(mapStatcastEventRow)
    .filter((row) => row.gameType === "R" && row.gameDate !== "");
}

export async function getBatterStatcastRows(
  playerId: number,
  endDate: string,
  season = currentSeason(),
): Promise<StatcastEventRow[]> {
  return getStatcastSearchRows("batter", playerId, endDate, season);
}

export async function getPitcherStatcastRows(
  playerId: number,
  endDate: string,
  season = currentSeason(),
): Promise<StatcastEventRow[]> {
  return getStatcastSearchRows("pitcher", playerId, endDate, season);
}

export async function getBatterVsPitcherRows(
  batterId: number,
  pitcherId: number,
  referenceDate: string,
  season = currentSeason(),
): Promise<StatcastEventRow[]> {
  const priorSeason = season - 1;
  const seasons = [season, priorSeason];
  const rows = await Promise.all(
    seasons.map((targetSeason) =>
      getStatcastSearchRows(
        "batter",
        batterId,
        targetSeason === season ? referenceDate : `${targetSeason}-11-30`,
        targetSeason,
        pitcherId,
      ),
    ),
  );

  return rows
    .flat()
    .filter((row) => row.pitcherId === pitcherId && row.gameDate < referenceDate)
    .sort((left, right) => right.gameDate.localeCompare(left.gameDate));
}
