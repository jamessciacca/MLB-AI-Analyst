import {
  getGameByPk,
  getGamesByDate,
  getLineupContext,
  getLiveGameStatus,
  getPlayerById,
  getPlayerGameBattingLine,
  getPlayerHittingStats,
  getPlayerPitchingStats,
  getStartingLineupPlayers,
  getTeamFieldingStats,
  getVenueById,
} from "@/lib/mlb";
import {
  getBatterExpectedStats,
  getBatterStatcastRows,
  getBatterVsPitcherRows,
  getPitchMix,
  getPitcherExpectedStats,
  getPitcherStatcastRows,
  getSprintSpeed,
  getTeamDefenseExtras,
} from "@/lib/statcast";
import { getGameWeather } from "@/lib/weather";
import { getFeedbackCalibration } from "@/lib/feedback";
import {
  type AnalysisMarket,
  type AnalysisModelInput,
  type LineupComparisonResult,
  type AnalysisResult,
  type BatterVsPitcherSummary,
  type PreviousModelResult,
  type TeamDefenseSnapshot,
} from "@/lib/types";
import { scoreOutcomeChance } from "@/lib/scoring";
import { minusDays } from "@/lib/utils";

const HIT_EVENTS = new Set(["single", "double", "triple", "home_run"]);
const NON_AT_BAT_EVENTS = new Set([
  "walk",
  "intentional_walk",
  "hit_by_pitch",
  "sac_fly",
  "sac_bunt",
  "catcher_interf",
]);

function isAtBatEvent(event: string | null) {
  return Boolean(event) && !NON_AT_BAT_EVENTS.has(event ?? "");
}

function summarizeBatterVsPitcher(
  rows: Awaited<ReturnType<typeof getBatterVsPitcherRows>>,
  batterId: number,
  pitcherId: number,
  pitcherName: string,
): BatterVsPitcherSummary | null {
  const plateAppearanceRows = rows.filter((row) => row.events);
  const atBatRows = plateAppearanceRows.filter((row) => isAtBatEvent(row.events));

  if (plateAppearanceRows.length === 0) {
    return null;
  }

  const hits = atBatRows.filter((row) => HIT_EVENTS.has(row.events ?? "")).length;
  const homeRuns = atBatRows.filter((row) => row.events === "home_run").length;
  const strikeouts = plateAppearanceRows.filter((row) => row.events === "strikeout").length;
  const walks = plateAppearanceRows.filter((row) =>
    row.events === "walk" || row.events === "intentional_walk",
  ).length;
  const battingAverage = atBatRows.length > 0 ? hits / atBatRows.length : null;
  const lastFacedDate = plateAppearanceRows[0]?.gameDate ?? null;

  return {
    batterId,
    pitcherId,
    pitcherName,
    plateAppearances: plateAppearanceRows.length,
    atBats: atBatRows.length,
    hits,
    homeRuns,
    strikeouts,
    walks,
    battingAverage,
    lastFacedDate,
    summary:
      atBatRows.length > 0
        ? `${hits} hits in ${atBatRows.length} at-bats against ${pitcherName}.`
        : `Reached base without an official at-bat against ${pitcherName}.`,
  };
}

function outcomeSucceeded(market: AnalysisMarket, line: { hits: number; homeRuns: number }) {
  return market === "home_run" ? line.homeRuns > 0 : line.hits > 0;
}

function predictedSuccess(result: AnalysisResult) {
  if (result.recommendation === "good play") {
    return true;
  }
  if (result.recommendation === "avoid") {
    return false;
  }

  return result.market === "home_run"
    ? result.probabilities.atLeastOne >= 0.15
    : result.probabilities.atLeastOne >= 0.5;
}

function ratingFromPreviousResult(result: AnalysisResult, success: boolean) {
  const predicted = predictedSuccess(result);

  if (predicted === success) {
    return "correct" as const;
  }

  return predicted && !success ? ("too_high" as const) : ("too_low" as const);
}

function isFinalStatus(status: string | null) {
  const normalized = status?.toLowerCase() ?? "";

  return (
    normalized.includes("final") ||
    normalized.includes("game over") ||
    normalized.includes("completed")
  );
}

export async function buildAnalysis(
  playerId: number,
  gamePk: number,
  market: AnalysisMarket = "hit",
): Promise<AnalysisResult> {
  const currentSeason = new Date().getFullYear();
  const priorSeason = currentSeason - 1;

  const [hitter, game] = await Promise.all([
    getPlayerById(playerId, currentSeason),
    getGameByPk(gamePk, currentSeason),
  ]);

  if (!hitter) {
    throw new Error("Hitter not found.");
  }

  if (!game) {
    throw new Error("Game not found.");
  }

  const hitterTeamId = hitter.currentTeamId;
  const hitterIsHome = hitterTeamId === game.homeTeam.id;
  const hitterIsAway = hitterTeamId === game.awayTeam.id;

  if (!hitterIsHome && !hitterIsAway) {
    throw new Error(
      `${hitter.fullName} is not on either team for the selected game.`,
    );
  }

  const opponentTeam = hitterIsHome ? game.awayTeam : game.homeTeam;
  const probablePitcherInfo = hitterIsHome
    ? game.awayProbablePitcher
    : game.homeProbablePitcher;

  const [
    hitterSeason,
    hitterPriorSeason,
    hitterExpected,
    hitterPriorExpected,
    hitterSprint,
    hitterRows,
    venue,
    fieldingStats,
    lineupContext,
  ] = await Promise.all([
    getPlayerHittingStats(hitter.id, currentSeason),
    getPlayerHittingStats(hitter.id, priorSeason),
    getBatterExpectedStats(hitter.id, currentSeason),
    getBatterExpectedStats(hitter.id, priorSeason),
    getSprintSpeed(hitter.id, currentSeason),
    getBatterStatcastRows(hitter.id, game.officialDate, currentSeason),
    getVenueById(game.venue.id, currentSeason),
    getTeamFieldingStats(opponentTeam.id, currentSeason),
    getLineupContext(gamePk, hitter.id),
  ]);

  const [
    pitcher,
    pitcherSeason,
    pitcherPriorSeason,
    pitcherExpected,
    pitcherPriorExpected,
    pitcherRows,
    pitchMix,
    defenseExtras,
  ] =
    probablePitcherInfo
      ? await Promise.all([
          getPlayerById(probablePitcherInfo.id, currentSeason),
          getPlayerPitchingStats(probablePitcherInfo.id, currentSeason),
          getPlayerPitchingStats(probablePitcherInfo.id, priorSeason),
          getPitcherExpectedStats(probablePitcherInfo.id, currentSeason),
          getPitcherExpectedStats(probablePitcherInfo.id, priorSeason),
          getPitcherStatcastRows(probablePitcherInfo.id, game.officialDate, currentSeason),
          getPitchMix(probablePitcherInfo.id, currentSeason),
          getTeamDefenseExtras(opponentTeam.name, currentSeason),
        ])
      : [
          null,
          null,
          null,
          null,
          null,
          [],
          [],
          await getTeamDefenseExtras(opponentTeam.name, currentSeason),
        ];

  const weather = await getGameWeather(venue, game.gameDate);
  const feedbackCalibration = await getFeedbackCalibration(market);
  const batterVsPitcherRows =
    pitcher && probablePitcherInfo
      ? await getBatterVsPitcherRows(
          hitter.id,
          probablePitcherInfo.id,
          game.officialDate,
          currentSeason,
        )
      : [];
  const batterVsPitcher = pitcher
    ? summarizeBatterVsPitcher(
        batterVsPitcherRows,
        hitter.id,
        pitcher.id,
        pitcher.fullName,
      )
    : null;

  const defense: TeamDefenseSnapshot | null =
    fieldingStats || defenseExtras
      ? {
          teamName: opponentTeam.name,
          fieldingPct: fieldingStats?.fielding ?? null,
          errors: fieldingStats?.errors ?? null,
          chances: fieldingStats?.chances ?? null,
          oaa: defenseExtras?.oaa ?? null,
          fieldingRunsPrevented: defenseExtras?.fieldingRunsPrevented ?? null,
          armOverall: defenseExtras?.armOverall ?? null,
        }
      : null;

  const modelInput: AnalysisModelInput = {
    hitter: {
      player: hitter,
      season: hitterSeason,
      priorSeason: hitterPriorSeason,
      expected: hitterExpected,
      priorExpected: hitterPriorExpected,
      sprint: hitterSprint,
      lineupSlot: lineupContext.lineupSlot,
      events: hitterRows,
    },
    pitcher: {
      player: pitcher,
      season: pitcherSeason,
      priorSeason: pitcherPriorSeason,
      expected: pitcherExpected,
      priorExpected: pitcherPriorExpected,
      pitchMix,
      events: pitcherRows,
      probable: Boolean(probablePitcherInfo),
    },
    game,
    venue,
    weather,
    defense,
  };

  const scored = scoreOutcomeChance(modelInput, market, feedbackCalibration.adjustment);

  return {
    ...scored,
    analysisId: `${playerId}-${gamePk}-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    aiSummary: null,
    batterVsPitcher,
  };
}

export async function buildPreviousModelResult(
  playerId: number,
  referenceGamePk: number,
  market: AnalysisMarket = "hit",
): Promise<PreviousModelResult> {
  const referenceGame = await getGameByPk(referenceGamePk);
  const previousDate = minusDays(referenceGame?.officialDate ?? new Date().toISOString(), 1);
  const marketLabel = market === "home_run" ? "Home Run" : "Hit";
  const player = await getPlayerById(playerId);

  if (!player) {
    return {
      date: previousDate,
      market,
      marketLabel,
      game: null,
      probability: null,
      recommendation: null,
      rating: "no_game",
      actualHits: null,
      actualHomeRuns: null,
      actualAtBats: null,
      outcomeSuccess: null,
      message: "Previous-day hitter lookup was unavailable.",
    };
  }

  const games = await getGamesByDate(previousDate);
  const previousGame =
    games.find(
      (game) =>
        game.homeTeam.id === player.currentTeamId || game.awayTeam.id === player.currentTeamId,
    ) ?? null;

  if (!previousGame) {
    return {
      date: previousDate,
      market,
      marketLabel,
      game: null,
      probability: null,
      recommendation: null,
      rating: "no_game",
      actualHits: null,
      actualHomeRuns: null,
      actualAtBats: null,
      outcomeSuccess: null,
      message: `${player.fullName} did not have a team game on ${previousDate}.`,
    };
  }

  const previousAnalysis = await buildAnalysis(playerId, previousGame.gamePk, market);
  const [line, status] = await Promise.all([
    getPlayerGameBattingLine(previousGame.gamePk, playerId),
    getLiveGameStatus(previousGame.gamePk),
  ]);

  if (!line) {
    return {
      date: previousDate,
      market,
      marketLabel,
      game: previousGame,
      probability: previousAnalysis.probabilities.atLeastOne,
      recommendation: previousAnalysis.recommendation,
      rating: "no_boxscore",
      actualHits: null,
      actualHomeRuns: null,
      actualAtBats: null,
      outcomeSuccess: null,
      message: "Previous-day boxscore is not available for this hitter yet.",
    };
  }

  const success = outcomeSucceeded(market, line);
  const rating = isFinalStatus(status) ? ratingFromPreviousResult(previousAnalysis, success) : "pending";

  return {
    date: previousDate,
    market,
    marketLabel,
    game: previousGame,
    probability: previousAnalysis.probabilities.atLeastOne,
    recommendation: previousAnalysis.recommendation,
    rating,
    actualHits: line.hits,
    actualHomeRuns: line.homeRuns,
    actualAtBats: line.atBats,
    outcomeSuccess: success,
    message:
      rating === "pending"
        ? "Previous-day game is not final yet."
        : `Previous-day model checked against the final boxscore.`,
  };
}

export async function buildLineupComparison(
  gamePk: number,
  market: AnalysisMarket = "hit",
): Promise<LineupComparisonResult> {
  const currentSeason = new Date().getFullYear();
  const [game, lineupPlayers] = await Promise.all([
    getGameByPk(gamePk, currentSeason),
    getStartingLineupPlayers(gamePk, currentSeason),
  ]);

  if (!game) {
    throw new Error("Game not found.");
  }

  if (lineupPlayers.length === 0) {
    throw new Error("No published starting lineup was found for this game yet.");
  }

  const settled = await Promise.allSettled(
    lineupPlayers.map((entry) => buildAnalysis(entry.player.id, gamePk, market)),
  );

  const players: AnalysisResult[] = [];
  const skippedPlayers: string[] = [];

  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    const entry = lineupPlayers[index];

    if (result.status === "fulfilled") {
      players.push({
        ...result.value,
        hitter: {
          ...result.value.hitter,
          lineupSlot: entry.lineupSlot ?? result.value.hitter.lineupSlot,
        },
      });
      continue;
    }

    skippedPlayers.push(
      `${entry.player.fullName}: ${
        result.reason instanceof Error ? result.reason.message : "analysis failed"
      }`,
    );
  }

  players.sort(
    (left, right) =>
      right.probabilities.atLeastOne - left.probabilities.atLeastOne ||
      left.hitter.player.fullName.localeCompare(right.hitter.player.fullName),
  );

  return {
    generatedAt: new Date().toISOString(),
    market,
    marketLabel: market === "home_run" ? "Home Run" : "Hit",
    game,
    topPick: players[0] ?? null,
    players,
    skippedPlayers,
  };
}
