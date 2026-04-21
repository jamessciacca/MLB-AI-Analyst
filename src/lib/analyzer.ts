import {
  getGameByPk,
  getLineupContext,
  getPlayerById,
  getPlayerHittingStats,
  getPlayerPitchingStats,
  getStartingLineupPlayers,
  getTeamFieldingStats,
  getVenueById,
} from "@/lib/mlb";
import {
  getBatterExpectedStats,
  getBatterStatcastRows,
  getPitchMix,
  getPitcherExpectedStats,
  getPitcherStatcastRows,
  getSprintSpeed,
  getTeamDefenseExtras,
} from "@/lib/statcast";
import { getGameWeather } from "@/lib/weather";
import {
  type AnalysisMarket,
  type AnalysisModelInput,
  type LineupComparisonResult,
  type AnalysisResult,
  type TeamDefenseSnapshot,
} from "@/lib/types";
import { scoreOutcomeChance } from "@/lib/scoring";

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

  const scored = scoreOutcomeChance(modelInput, market);

  return {
    ...scored,
    analysisId: `${playerId}-${gamePk}-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    aiSummary: null,
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
