import { fetchWithRetry, remember } from "../cache.ts";
import { getPlayerRecentBattingGameLog } from "../mlb.ts";
import { getBatterStatcastRows } from "../statcast.ts";
import { type StatcastEventRow } from "../types.ts";
import { asNumber, asString, average, clamp } from "../utils.ts";

import {
  type AnalystAtBatQualitySummary,
  type AnalystLast10GameEntry,
  type AnalystLast10Summary,
} from "./types.ts";
import { scorePlateAppearance } from "./at-bat-quality-service.ts";

const MLB_FEED_BASE_URL = "https://statsapi.mlb.com/api/v1.1";
const FEED_TTL_MS = 15 * 60 * 1000;
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
  "foul_pitchout",
]);
const WHIFF_DESCRIPTIONS = new Set([
  "swinging_strike",
  "swinging_strike_blocked",
  "missed_bunt",
]);
const HIT_EVENTS = new Set(["single", "double", "triple", "home_run"]);
const WALK_EVENTS = new Set(["walk", "intentional_walk", "hit_by_pitch"]);

interface RawPlateAppearance {
  pitcherName: string | null;
  eventType: string | null;
  pitchCount: number;
  swings: number;
  whiffs: number;
  chaseOpportunities: number;
  chases: number;
  reachedDeepCount: boolean;
  launchSpeed: number | null;
  launchAngle: number | null;
  battedBallType: "line_drive" | "ground_ball" | "fly_ball" | "popup" | "unknown";
  isWalk: boolean;
  isStrikeout: boolean;
  isHit: boolean;
  ballInPlay: boolean;
}

function gameFeedUrl(gamePk: number) {
  return new URL(`game/${gamePk}/feed/live`, `${MLB_FEED_BASE_URL}/`).toString();
}

async function getGameFeed(gamePk: number): Promise<Record<string, unknown>> {
  const url = gameFeedUrl(gamePk);

  return remember(url, FEED_TTL_MS, async () => {
    const response = await fetchWithRetry(url, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    }, {
      retries: 2,
      timeoutMs: 12000,
    });

    if (!response.ok) {
      throw new Error(`MLB game feed request failed: ${response.status} ${url}`);
    }

    return (await response.json()) as Record<string, unknown>;
  });
}

function classifyBattedBallType(input: {
  trajectory: string | null;
  launchAngle: number | null;
}) {
  const trajectory = input.trajectory?.toLowerCase() ?? "";

  if (trajectory.includes("popup")) {
    return "popup";
  }
  if (trajectory.includes("ground")) {
    return "ground_ball";
  }
  if (trajectory.includes("line")) {
    return "line_drive";
  }
  if (trajectory.includes("fly")) {
    return "fly_ball";
  }

  const launchAngle = input.launchAngle;

  if (launchAngle === null) {
    return "unknown";
  }
  if (launchAngle >= 50) {
    return "popup";
  }
  if (launchAngle >= 18) {
    return "fly_ball";
  }
  if (launchAngle >= 8) {
    return "line_drive";
  }

  return "ground_ball";
}

function getLineupSpotFromFeed(feed: Record<string, unknown>, playerId: number) {
  const teams =
    (((feed.liveData as Record<string, unknown> | undefined)?.boxscore as
      | Record<string, unknown>
      | undefined)?.teams as Record<string, unknown> | undefined) ?? {};

  for (const side of ["home", "away"] as const) {
    const players = (teams[side] as Record<string, unknown> | undefined)?.players as
      | Record<string, Record<string, unknown>>
      | undefined;

    if (!players) {
      continue;
    }

    const player = Object.values(players).find(
      (candidate) =>
        asNumber((candidate.person as Record<string, unknown> | undefined)?.id) === playerId,
    );

    if (!player) {
      continue;
    }

    const battingOrder = asString(player.battingOrder);
    const lineupSlot = battingOrder ? Number(battingOrder[0]) : null;

    if (lineupSlot && Number.isFinite(lineupSlot)) {
      return Math.max(1, Math.min(9, lineupSlot));
    }
  }

  return null;
}

function extractPlayerPlateAppearances(
  feed: Record<string, unknown>,
  playerId: number,
): RawPlateAppearance[] {
  const allPlays =
    (((feed.liveData as Record<string, unknown> | undefined)?.plays as
      | Record<string, unknown>
      | undefined)?.allPlays as Array<Record<string, unknown>> | undefined) ?? [];

  return allPlays.flatMap((play) => {
    const matchup = (play.matchup as Record<string, unknown> | undefined) ?? {};
    const batterId = asNumber((matchup.batter as Record<string, unknown> | undefined)?.id);

    if (batterId !== playerId) {
      return [];
    }

    const result = (play.result as Record<string, unknown> | undefined) ?? {};
    const eventType = asString(result.eventType) ?? asString(result.event);
    const playEvents = (play.playEvents as Array<Record<string, unknown>> | undefined) ?? [];
    const pitchEvents = playEvents.filter((event) => {
      if (event.isPitch === true) {
        return true;
      }

      return Boolean(event.pitchData);
    });
    const swings = pitchEvents.filter((event) =>
      SWING_DESCRIPTIONS.has(
        asString((event.details as Record<string, unknown> | undefined)?.description) ?? "",
      ),
    ).length;
    const whiffs = pitchEvents.filter((event) =>
      WHIFF_DESCRIPTIONS.has(
        asString((event.details as Record<string, unknown> | undefined)?.description) ?? "",
      ),
    ).length;
    const chasePitchEvents = pitchEvents.filter((event) => {
      const zone = asNumber((event.pitchData as Record<string, unknown> | undefined)?.zone);
      return zone !== null && (zone < 1 || zone > 9);
    });
    const chases = chasePitchEvents.filter((event) =>
      SWING_DESCRIPTIONS.has(
        asString((event.details as Record<string, unknown> | undefined)?.description) ?? "",
      ),
    ).length;
    const deepestCount = pitchEvents.reduce<{ balls: number; strikes: number }>(
      (best, event) => {
        const count = (event.count as Record<string, unknown> | undefined) ?? {};
        return {
          balls: Math.max(best.balls, asNumber(count.balls) ?? 0),
          strikes: Math.max(best.strikes, asNumber(count.strikes) ?? 0),
        };
      },
      { balls: 0, strikes: 0 },
    );
    const contactEvent = [...pitchEvents].reverse().find((event) => {
      const details = (event.details as Record<string, unknown> | undefined) ?? {};
      return Boolean(event.hitData) || details.isInPlay === true;
    });
    const hitData = (contactEvent?.hitData as Record<string, unknown> | undefined) ?? {};
    const trajectory = asString(hitData.trajectory);
    const launchSpeed = asNumber(hitData.launchSpeed);
    const launchAngle = asNumber(hitData.launchAngle);

    return [
      {
        pitcherName:
          asString((matchup.pitcher as Record<string, unknown> | undefined)?.fullName) ?? null,
        eventType,
        pitchCount: pitchEvents.length,
        swings,
        whiffs,
        chaseOpportunities: chasePitchEvents.length,
        chases,
        reachedDeepCount: deepestCount.balls >= 3 || deepestCount.strikes >= 2,
        launchSpeed,
        launchAngle,
        battedBallType: classifyBattedBallType({
          trajectory,
          launchAngle,
        }),
        isWalk: WALK_EVENTS.has(eventType ?? ""),
        isStrikeout: eventType === "strikeout",
        isHit: HIT_EVENTS.has(eventType ?? ""),
        ballInPlay:
          Boolean(contactEvent) ||
          eventType === "field_out" ||
          eventType === "force_out" ||
          eventType === "grounded_into_double_play" ||
          eventType === "double_play" ||
          HIT_EVENTS.has(eventType ?? ""),
      },
    ];
  });
}

function buildGameNotes(entry: AnalystLast10GameEntry) {
  const notes = [...entry.notes];

  if (entry.unluckyOuts >= 2) {
    notes.push("Bad luck outweighed the box score.");
  }
  if (entry.badOuts >= 2 || entry.strikeouts >= 2) {
    notes.push("Swing decisions were a real issue.");
  }
  if (entry.hardHitBalls >= 2 && entry.hits === 0) {
    notes.push("Process was better than the result.");
  }
  if (entry.hits >= 2 && entry.qualityOfContactScore < 0.5) {
    notes.push("Results beat the underlying contact quality.");
  }

  return [...new Set(notes)];
}

function averageAtBatQuality(games: AnalystLast10GameEntry[], count: number) {
  const window = games.slice(0, count);

  if (window.length === 0) {
    return null;
  }

  return average(window.map((game) => game.atBatQualityScore));
}

function trendLabel(recent: number | null, baseline: number | null) {
  if (recent === null || baseline === null) {
    return "steady" as const;
  }
  if (recent - baseline >= 0.15) {
    return "rising" as const;
  }
  if (baseline - recent >= 0.15) {
    return "falling" as const;
  }

  return "steady" as const;
}

function aggregateLast10Summary(games: AnalystLast10GameEntry[]): AnalystLast10Summary {
  const gamesAnalyzed = games.length;
  const hitGames = games.filter((game) => game.hits > 0).length;
  const hitlessGames = games.filter((game) => game.atBats > 0 && game.hits === 0).length;
  const qualityLast3 = averageAtBatQuality(games, 3);
  const qualityLast10 = averageAtBatQuality(games, 10);
  const qualityTrend = trendLabel(qualityLast3, qualityLast10);

  return {
    gamesAnalyzed,
    averageHitsPerGame: average(games.map((game) => game.hits)),
    hitGames,
    hitlessGames,
    hardHitRate:
      games.reduce((sum, game) => sum + game.hardHitBalls, 0) /
        Math.max(
          games.reduce((sum, game) => sum + game.ballsInPlay, 0),
          1,
        ) || null,
    expectedHitsPerGame: average(games.map((game) => game.expectedHits)),
    qualityTrend,
    summary:
      games.length === 0
        ? "No recent games were available."
        : `${hitGames}/${games.length} recent games produced a hit, with ${qualityTrend} at-bat quality and ${games.reduce((sum, game) => sum + game.unluckyOuts, 0)} unlucky outs in the sample.`,
    games,
  };
}

function buildAtBatQualitySummary(
  games: AnalystLast10GameEntry[],
): AnalystAtBatQualitySummary {
  const last3 = averageAtBatQuality(games, 3);
  const last5 = averageAtBatQuality(games, 5);
  const last10 = averageAtBatQuality(games, 10);
  const trend = trendLabel(last3, last10);

  return {
    last3,
    last5,
    last10,
    trend,
    summary:
      last10 === null
        ? "At-bat quality is unavailable."
        : `At-bat quality sits at ${last10.toFixed(2)} over the last 10 games and is ${trend} over the last 3-game window.`,
  };
}

export async function buildLast10GamePattern(input: {
  playerId: number;
  referenceDate: string;
  season?: number;
}): Promise<{
  last10Summary: AnalystLast10Summary | null;
  atBatQualitySummary: AnalystAtBatQualitySummary | null;
  warnings: string[];
}> {
  const season = input.season ?? new Date().getFullYear();
  const warnings: string[] = [];
  const recentGames = await getPlayerRecentBattingGameLog(input.playerId, season, 10);

  if (recentGames.length === 0) {
    return {
      last10Summary: null,
      atBatQualitySummary: null,
      warnings: ["No recent game log entries were available for the hitter."],
    };
  }

  if (recentGames.length < 10) {
    warnings.push(`Only ${recentGames.length} recent games were available for last-10 pattern analysis.`);
  }

  const statcastRows = await getBatterStatcastRows(input.playerId, input.referenceDate, season).catch(
    () => [],
  );
  const statcastRowsByDate = new Map<string, StatcastEventRow[]>();

  for (const row of statcastRows) {
    if (!row.gameDate) {
      continue;
    }

    const bucket = statcastRowsByDate.get(row.gameDate) ?? [];
    bucket.push(row);
    statcastRowsByDate.set(row.gameDate, bucket);
  }

  const games = await Promise.all(
    recentGames.map(async (gameLog) => {
      if (!gameLog.gamePk) {
        warnings.push(`Game ID was missing for ${gameLog.date}; box-score-only fallback was used.`);

        return {
          gamePk: null,
          date: gameLog.date,
          opponent: gameLog.opponent,
          pitcherFacedList: [],
          battingOrderSpot: null,
          atBats: gameLog.atBats,
          hits: gameLog.hits,
          walks: 0,
          strikeouts: 0,
          ballsInPlay: Math.max(gameLog.atBats - gameLog.hits, 0),
          hardHitBalls: 0,
          barrels: 0,
          lineDrives: 0,
          groundBalls: 0,
          flyBalls: 0,
          popups: 0,
          expectedHits: 0,
          xbaAverage: null,
          averageExitVelocity: null,
          maxExitVelocity: null,
          contactRate: null,
          whiffRate: null,
          chaseRate: null,
          qualityOfContactScore: 0.5,
          atBatQualityScore: 0,
          unluckyOuts: 0,
          badOuts: 0,
          notes: ["Live play-by-play was unavailable for this game."],
        } satisfies AnalystLast10GameEntry;
      }

      try {
        const feed = await getGameFeed(gameLog.gamePk);
        const plateAppearances = extractPlayerPlateAppearances(feed, input.playerId);
        const dateStatcastRows = statcastRowsByDate.get(gameLog.date) ?? [];
        const lineupSpot = getLineupSpotFromFeed(feed, input.playerId);
        const paResults = plateAppearances.map((plateAppearance, index) => {
          const estimatedHitValue =
            dateStatcastRows[index]?.estimatedBattingAverage ??
            dateStatcastRows.find(
              (row) =>
                row.launchSpeed !== null &&
                plateAppearance.launchSpeed !== null &&
                Math.abs((row.launchSpeed ?? 0) - plateAppearance.launchSpeed) <= 1.5 &&
                row.launchAngle !== null &&
                plateAppearance.launchAngle !== null &&
                Math.abs((row.launchAngle ?? 0) - plateAppearance.launchAngle) <= 4,
            )?.estimatedBattingAverage ??
            null;

          return scorePlateAppearance({
            eventType: plateAppearance.eventType,
            description: null,
            pitchCount: plateAppearance.pitchCount,
            swings: plateAppearance.swings,
            whiffs: plateAppearance.whiffs,
            chaseOpportunities: plateAppearance.chaseOpportunities,
            chases: plateAppearance.chases,
            reachedDeepCount: plateAppearance.reachedDeepCount,
            launchSpeed: plateAppearance.launchSpeed,
            launchAngle: plateAppearance.launchAngle,
            estimatedHitValue,
            battedBallType: plateAppearance.battedBallType,
            isWalk: plateAppearance.isWalk,
            isStrikeout: plateAppearance.isStrikeout,
            isHit: plateAppearance.isHit,
            ballInPlay: plateAppearance.ballInPlay,
          });
        });
        const ballsInPlay = plateAppearances.filter((plateAppearance) => plateAppearance.ballInPlay);
        const hardHitBalls = ballsInPlay.filter(
          (plateAppearance) => (plateAppearance.launchSpeed ?? 0) >= 95,
        ).length;
        const barrels = ballsInPlay.filter(
          (plateAppearance) =>
            (plateAppearance.launchSpeed ?? 0) >= 98 &&
            (plateAppearance.launchAngle ?? -90) >= 24 &&
            (plateAppearance.launchAngle ?? 90) <= 32,
        ).length;
        const expectedHits = paResults.reduce(
          (sum, result) => sum + (result.expectedHitValue ?? 0),
          0,
        );
        const xbaRows = dateStatcastRows.filter(
          (row) => row.estimatedBattingAverage !== null,
        );
        const pitchCount = plateAppearances.reduce((sum, plateAppearance) => sum + plateAppearance.pitchCount, 0);
        const swings = plateAppearances.reduce((sum, plateAppearance) => sum + plateAppearance.swings, 0);
        const whiffs = plateAppearances.reduce((sum, plateAppearance) => sum + plateAppearance.whiffs, 0);
        const chaseOpportunities = plateAppearances.reduce(
          (sum, plateAppearance) => sum + plateAppearance.chaseOpportunities,
          0,
        );
        const chases = plateAppearances.reduce((sum, plateAppearance) => sum + plateAppearance.chases, 0);
        const pitcherFacedList = [...new Set(plateAppearances.map((plateAppearance) => plateAppearance.pitcherName).filter(Boolean))];

        const entry: AnalystLast10GameEntry = {
          gamePk: gameLog.gamePk,
          date: gameLog.date,
          opponent: gameLog.opponent,
          pitcherFacedList: pitcherFacedList as string[],
          battingOrderSpot: lineupSpot,
          atBats: gameLog.atBats,
          hits: gameLog.hits,
          walks: plateAppearances.filter((plateAppearance) => plateAppearance.isWalk).length,
          strikeouts: plateAppearances.filter((plateAppearance) => plateAppearance.isStrikeout).length,
          ballsInPlay: ballsInPlay.length,
          hardHitBalls,
          barrels,
          lineDrives: ballsInPlay.filter((plateAppearance) => plateAppearance.battedBallType === "line_drive").length,
          groundBalls: ballsInPlay.filter((plateAppearance) => plateAppearance.battedBallType === "ground_ball").length,
          flyBalls: ballsInPlay.filter((plateAppearance) => plateAppearance.battedBallType === "fly_ball").length,
          popups: ballsInPlay.filter((plateAppearance) => plateAppearance.battedBallType === "popup").length,
          expectedHits,
          xbaAverage: average(xbaRows.map((row) => row.estimatedBattingAverage)),
          averageExitVelocity: average(ballsInPlay.map((plateAppearance) => plateAppearance.launchSpeed)),
          maxExitVelocity:
            ballsInPlay.length > 0
              ? Math.max(...ballsInPlay.map((plateAppearance) => plateAppearance.launchSpeed ?? 0))
              : null,
          contactRate: swings > 0 ? (swings - whiffs) / swings : pitchCount > 0 ? 1 : null,
          whiffRate: swings > 0 ? whiffs / swings : null,
          chaseRate: chaseOpportunities > 0 ? chases / chaseOpportunities : null,
          qualityOfContactScore: clamp(
            0.45 +
              (average(ballsInPlay.map((plateAppearance) => plateAppearance.launchSpeed)) ?? 88 - 88) * 0.012 +
              (average(paResults.map((result) => result.expectedHitValue)) ?? 0.18 - 0.18) * 0.9,
            0.05,
            0.95,
          ),
          atBatQualityScore: average(paResults.map((result) => result.score)) ?? 0,
          unluckyOuts: paResults.filter((result) => result.unluckyOut).length,
          badOuts: paResults.filter((result) => result.badOut).length,
          notes: paResults.flatMap((result) => result.notes).slice(0, 6),
        };

        entry.notes = buildGameNotes(entry);
        return entry;
      } catch {
        warnings.push(`Fell back to box-score-only detail for ${gameLog.date} ${gameLog.opponent ?? ""}.`.trim());

        return {
          gamePk: gameLog.gamePk,
          date: gameLog.date,
          opponent: gameLog.opponent,
          pitcherFacedList: [],
          battingOrderSpot: null,
          atBats: gameLog.atBats,
          hits: gameLog.hits,
          walks: 0,
          strikeouts: 0,
          ballsInPlay: Math.max(gameLog.atBats - gameLog.hits, 0),
          hardHitBalls: 0,
          barrels: 0,
          lineDrives: 0,
          groundBalls: 0,
          flyBalls: 0,
          popups: 0,
          expectedHits: average((statcastRowsByDate.get(gameLog.date) ?? []).map((row) => row.estimatedBattingAverage)) ?? 0,
          xbaAverage: average((statcastRowsByDate.get(gameLog.date) ?? []).map((row) => row.estimatedBattingAverage)),
          averageExitVelocity: average((statcastRowsByDate.get(gameLog.date) ?? []).map((row) => row.launchSpeed)),
          maxExitVelocity: null,
          contactRate: null,
          whiffRate: null,
          chaseRate: null,
          qualityOfContactScore: 0.5,
          atBatQualityScore: 0,
          unluckyOuts: 0,
          badOuts: 0,
          notes: ["Box score available, but play-by-play quality detail was missing."],
        } satisfies AnalystLast10GameEntry;
      }
    }),
  );

  const sortedGames = games.sort((left, right) => right.date.localeCompare(left.date));

  return {
    last10Summary: aggregateLast10Summary(sortedGames),
    atBatQualitySummary: buildAtBatQualitySummary(sortedGames),
    warnings,
  };
}
