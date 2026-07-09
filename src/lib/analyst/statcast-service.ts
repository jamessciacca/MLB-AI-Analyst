import { getBatterStatcastRows, getPitcherStatcastRows } from "../statcast.ts";
import { type AnalysisResult, type StatcastEventRow } from "../types.ts";
import { average } from "../utils.ts";

import { type AnalystRollingMetrics, type AnalystStatcastContext } from "./types.ts";

const HIT_EVENTS = new Set(["single", "double", "triple", "home_run"]);
const EXTRA_BASE_VALUES: Record<string, number> = {
  single: 1,
  double: 2,
  triple: 3,
  home_run: 4,
};
const WALK_EVENTS = new Set(["walk", "intentional_walk", "hit_by_pitch"]);
const NON_AT_BAT_EVENTS = new Set([
  "walk",
  "intentional_walk",
  "hit_by_pitch",
  "sac_fly",
  "sac_bunt",
  "catcher_interf",
]);
const SWING_DESCRIPTIONS = new Set([
  "foul",
  "foul_tip",
  "foul_bunt",
  "hit_into_play",
  "hit_into_play_no_out",
  "hit_into_play_score",
  "swinging_strike",
  "swinging_strike_blocked",
  "missed_bunt",
]);
const WHIFF_DESCRIPTIONS = new Set([
  "swinging_strike",
  "swinging_strike_blocked",
  "missed_bunt",
]);

function finalRows(rows: StatcastEventRow[]) {
  return rows.filter((row) => row.events);
}

function atBatRows(rows: StatcastEventRow[]) {
  return finalRows(rows).filter((row) => row.events && !NON_AT_BAT_EVENTS.has(row.events));
}

function barrelLikeRate(rows: StatcastEventRow[]) {
  const tracked = rows.filter((row) => row.launchSpeed !== null && row.launchAngle !== null);

  if (tracked.length === 0) {
    return null;
  }

  return (
    tracked.filter((row) => {
      const launchSpeed = row.launchSpeed ?? 0;
      const launchAngle = row.launchAngle ?? 0;

      return launchSpeed >= 98 && launchAngle >= 24 && launchAngle <= 32;
    }).length / tracked.length
  );
}

function wobaWeight(event: string | null) {
  if (!event) {
    return 0;
  }

  if (event === "walk" || event === "intentional_walk") {
    return 0.69;
  }
  if (event === "hit_by_pitch") {
    return 0.72;
  }
  if (event === "single") {
    return 0.88;
  }
  if (event === "double") {
    return 1.247;
  }
  if (event === "triple") {
    return 1.578;
  }
  if (event === "home_run") {
    return 2.031;
  }

  return 0;
}

function filterLastNGames(rows: StatcastEventRow[], gameCount: number) {
  const dates = [...new Set(rows.map((row) => row.gameDate).filter(Boolean))].sort((left, right) =>
    right.localeCompare(left),
  );
  const allowed = new Set(dates.slice(0, gameCount));
  return rows.filter((row) => allowed.has(row.gameDate));
}

function computeMetrics(rows: StatcastEventRow[]): AnalystRollingMetrics {
  const finalPlateAppearances = finalRows(rows);
  const atBats = atBatRows(rows);
  const hits = atBats.filter((row) => HIT_EVENTS.has(row.events ?? "")).length;
  const walks = finalPlateAppearances.filter((row) => WALK_EVENTS.has(row.events ?? "")).length;
  const strikeouts = finalPlateAppearances.filter((row) => row.events === "strikeout").length;
  const totalBases = atBats.reduce((sum, row) => sum + (EXTRA_BASE_VALUES[row.events ?? ""] ?? 0), 0);
  const tracked = rows.filter((row) => row.launchSpeed !== null);
  const swings = rows.filter((row) => SWING_DESCRIPTIONS.has(row.description ?? "")).length;
  const whiffs = rows.filter((row) => WHIFF_DESCRIPTIONS.has(row.description ?? "")).length;
  const xbaRows = rows.filter((row) => row.estimatedBattingAverage !== null);
  const xwobaRows = rows.filter((row) => row.estimatedWoba !== null);
  const plateAppearances = finalPlateAppearances.length;

  return {
    sampleSize: rows.length,
    plateAppearances,
    atBats: atBats.length,
    avg: atBats.length > 0 ? hits / atBats.length : null,
    obp: plateAppearances > 0 ? (hits + walks) / plateAppearances : null,
    slg: atBats.length > 0 ? totalBases / atBats.length : null,
    ops:
      atBats.length > 0 && plateAppearances > 0
        ? hits / atBats.length + (hits + walks) / plateAppearances
        : null,
    xba:
      xbaRows.length > 0
        ? average(xbaRows.map((row) => row.estimatedBattingAverage)) ?? null
        : null,
    xslg: atBats.length > 0 ? totalBases / atBats.length : null,
    woba: plateAppearances > 0 ? finalPlateAppearances.reduce((sum, row) => sum + wobaWeight(row.events), 0) / plateAppearances : null,
    xwoba:
      xwobaRows.length > 0
        ? average(xwobaRows.map((row) => row.estimatedWoba)) ?? null
        : null,
    hardHitRate:
      tracked.length > 0
        ? tracked.filter((row) => (row.launchSpeed ?? 0) >= 95).length / tracked.length
        : null,
    barrelRate: barrelLikeRate(rows),
    strikeoutRate: plateAppearances > 0 ? strikeouts / plateAppearances : null,
    walkRate: plateAppearances > 0 ? walks / plateAppearances : null,
    contactRate: swings > 0 ? (swings - whiffs) / swings : null,
    whiffRate: swings > 0 ? whiffs / swings : null,
    chaseRate: null,
    averageExitVelocity: tracked.length > 0 ? average(tracked.map((row) => row.launchSpeed)) : null,
    averageLaunchAngle:
      tracked.filter((row) => row.launchAngle !== null).length > 0
        ? average(tracked.map((row) => row.launchAngle))
        : null,
  };
}

export async function buildAnalystStatcastContext(
  analysis: AnalysisResult,
): Promise<AnalystStatcastContext> {
  const [batterRows, pitcherRows] = await Promise.all([
    getBatterStatcastRows(analysis.hitter.player.id, analysis.game.officialDate).catch(() => []),
    analysis.pitcher.player?.id
      ? getPitcherStatcastRows(analysis.pitcher.player.id, analysis.game.officialDate).catch(
          () => [],
        )
      : Promise.resolve([]),
  ]);
  const pitcherHand = analysis.pitcher.player?.pitchHand ?? null;
  const batterVsHandRows = pitcherHand
    ? batterRows.filter((row) => row.pitcherThrows === pitcherHand)
    : batterRows;
  const pitcherVsHandRows = analysis.hitter.player.batSide
    ? pitcherRows.filter((row) => row.batterStand === analysis.hitter.player.batSide)
    : pitcherRows;
  const warnings: string[] = [];

  if (batterRows.length === 0) {
    warnings.push("Recent batter Statcast rows were unavailable; season-level context is carrying more weight.");
  }
  if (pitcherRows.length === 0) {
    warnings.push("Pitcher Statcast rows were unavailable; pitcher matchup is using lighter context.");
  }
  warnings.push("Home/away Statcast split is not yet available from the current local row shape.");
  warnings.push("Chase rate is omitted until zone-level Statcast fields are added to the local mapping.");

  return {
    batter: {
      season: computeMetrics(batterRows),
      last7: computeMetrics(filterLastNGames(batterRows, 7)),
      last14: computeMetrics(filterLastNGames(batterRows, 14)),
      last30: computeMetrics(filterLastNGames(batterRows, 30)),
      vsHandedness: computeMetrics(batterVsHandRows),
      home: null,
      away: null,
    },
    pitcher: {
      season: computeMetrics(pitcherRows),
      last14: computeMetrics(filterLastNGames(pitcherRows, 14)),
      last30: computeMetrics(filterLastNGames(pitcherRows, 30)),
      vsHandedness: computeMetrics(pitcherVsHandRows),
    },
    warnings,
  };
}
