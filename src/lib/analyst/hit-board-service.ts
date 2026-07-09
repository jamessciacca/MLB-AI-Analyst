import { buildAnalysis, buildLineupComparison } from "../analyzer.ts";
import { getGameByPk, getGamesByDate } from "../mlb.ts";
import { type AnalysisMarket, type AnalysisResult } from "../types.ts";
import { todayIsoDate } from "../utils.ts";

import {
  type BestHittersBoardResponse,
  type DailyTopHitPick,
  type DailyTopHitPickComparison,
  type GameHitBoardEntry,
  type PlayerHitAnalysisResponse,
} from "./board-types.ts";
import { buildAnalystPrediction } from "./engine.ts";
import {
  resolveGameForAnalystRequest,
  resolvePlayerForAnalystRequest,
  resolveUpcomingGameForPlayer,
} from "./mlb-data-service.ts";

function compactPlayerRow(result: AnalysisResult) {
  return {
    playerId: result.hitter.player.id,
    playerName: result.hitter.player.fullName,
    team: result.hitter.player.currentTeamAbbreviation,
    lineupSlot: result.hitter.lineupSlot,
    hitProbability: result.probabilities.atLeastOne,
    confidence: result.confidence,
    recommendation: result.recommendation,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatPercent(value: number, digits = 0) {
  return `${(value * 100).toFixed(digits)}%`;
}

function lineupOpportunityScore(lineupSlot: number | null | undefined) {
  if (!lineupSlot) {
    return 0.48;
  }

  const bySlot: Record<number, number> = {
    1: 0.94,
    2: 0.98,
    3: 0.95,
    4: 0.91,
    5: 0.82,
    6: 0.7,
    7: 0.58,
    8: 0.49,
    9: 0.43,
  };

  return bySlot[lineupSlot] ?? 0.48;
}

function recentHistoryScore(entry: GameHitBoardEntry) {
  const analyst = entry.selectedAnalyst;
  const selection = entry.selection;
  const selectedRow = selection?.comparisonTable.find(
    (row) => row.playerId === selection.selectedPlayerId,
  );

  if (!analyst || !selection) {
    return 0.5;
  }

  const last10 = analyst.last10Summary;
  const hitGameRate = last10
    ? last10.hitGames / Math.max(last10.gamesAnalyzed, 1)
    : selectedRow?.recentFormScore ?? 0.5;
  const expectedHits = clamp((last10?.expectedHitsPerGame ?? 0.72) / 1.25, 0.05, 0.95);
  const quality = clamp(
    0.5 +
      (analyst.atBatQualitySummary?.last10 ?? 0) * 0.16 +
      (analyst.atBatQualitySummary?.trend === "rising"
        ? 0.08
        : analyst.atBatQualitySummary?.trend === "falling"
          ? -0.06
          : 0),
    0.05,
    0.95,
  );
  const latest = last10?.games[0] ?? null;
  const previousGameBoost =
    latest && latest.atBats > 0
      ? latest.hits > 0
        ? 0.04
        : latest.qualityOfContactScore >= 0.35 || latest.unluckyOuts > 0
          ? 0.025
          : -0.025
      : 0;

  return clamp(
    hitGameRate * 0.42 +
      expectedHits * 0.2 +
      quality * 0.26 +
      (selectedRow?.atBatQualityScore ?? 0.5) * 0.12 +
      previousGameBoost,
    0.05,
    0.98,
  );
}

function previousGameSummary(entry: GameHitBoardEntry) {
  const latest = entry.selectedAnalyst?.last10Summary?.games[0] ?? null;

  if (!latest) {
    return "Previous-game detail was unavailable, so the model weighted the broader recent sample.";
  }

  const result =
    latest.atBats > 0
      ? `${latest.hits} H in ${latest.atBats} AB`
      : "no official at-bats";
  const quality =
    latest.qualityOfContactScore >= 0.35
      ? "strong contact quality"
      : latest.unluckyOuts > 0
        ? "some unlucky contact"
        : latest.qualityOfContactScore <= -0.15
          ? "thin contact quality"
          : "neutral contact quality";

  return `${latest.date} vs ${latest.opponent ?? "opponent"}: ${result}, ${quality}.`;
}

function matchupSummary(entry: GameHitBoardEntry) {
  const analyst = entry.selectedAnalyst;
  const selection = entry.selection;
  const selectedRow = selection?.comparisonTable.find(
    (row) => row.playerId === selection.selectedPlayerId,
  );

  if (!analyst || !selection || !selectedRow) {
    return "Matchup context was not available.";
  }

  return `${analyst.matchup.pitcher} (${analyst.matchup.pitcherHand ?? "hand unknown"}): ${selectedRow.reason}. ${analyst.matchup.batterVsPitcherHistory}`;
}

function buildDailyPick(entry: GameHitBoardEntry, rank: number): DailyTopHitPick | null {
  const selection = entry.selection;
  const analyst = entry.selectedAnalyst;
  const topPick = entry.topPick;
  const selectedRow = selection?.comparisonTable.find(
    (row) => row.playerId === selection.selectedPlayerId,
  );

  if (!entry.available || !selection || !analyst || !topPick || !selectedRow) {
    return null;
  }

  const lineupScore = lineupOpportunityScore(topPick.hitter.lineupSlot);
  const historyScore = recentHistoryScore(entry);
  const matchupScore = clamp(
    selectedRow.matchupScore * 0.72 +
      analyst.components.pitcherMatchupScore * 0.18 +
      analyst.components.teamOffenseScore * 0.1,
    0.05,
    0.98,
  );
  const dayScore = clamp(
    selection.finalScore * 0.28 +
      analyst.predictedProbability * 0.26 +
      matchupScore * 0.18 +
      lineupScore * 0.12 +
      historyScore * 0.12 +
      selectedRow.valueScore * 0.06 -
      selectedRow.riskScore * 0.08,
    0.01,
    0.99,
  );
  const opponent =
    entry.game.homeTeam.abbreviation === topPick.hitter.player.currentTeamAbbreviation
      ? entry.game.awayTeam.abbreviation
      : entry.game.homeTeam.abbreviation;
  const reasons = [
    `Ranks at ${formatPercent(analyst.predictedProbability, 1)} for 1+ hit with a ${selection.confidence} confidence tag.`,
    topPick.hitter.lineupSlot
      ? `Lineup spot ${topPick.hitter.lineupSlot} gives this profile a strong plate-appearance path.`
      : "Lineup spot is not confirmed, but the model kept the baseball case strong enough.",
    matchupScore >= 0.56
      ? `Matchup score clears the day-level bar at ${formatPercent(matchupScore, 0)}.`
      : null,
    historyScore >= 0.58
      ? `Recent and previous-game history grade well at ${formatPercent(historyScore, 0)}.`
      : null,
    analyst.detectedPattern?.explanation ?? null,
  ].filter((value): value is string => Boolean(value)).slice(0, 5);

  return {
    rank,
    playerId: topPick.hitter.player.id,
    playerName: topPick.hitter.player.fullName,
    team: topPick.hitter.player.currentTeamAbbreviation,
    opponent,
    gamePk: entry.game.gamePk,
    gameLabel: `${entry.game.awayTeam.abbreviation} @ ${entry.game.homeTeam.abbreviation}`,
    venueName: entry.game.venue.name,
    lineupSlot: topPick.hitter.lineupSlot,
    hitProbability: analyst.predictedProbability,
    fairOdds: analyst.fairOdds,
    edgeIfAvailable: analyst.edgeIfAvailable,
    confidence: selection.confidence,
    recommendation: selection.recommendation,
    dailyScore: dayScore,
    matchupScore,
    lineupOpportunityScore: lineupScore,
    recentHistoryScore: historyScore,
    previousGameSummary: previousGameSummary(entry),
    matchupSummary: matchupSummary(entry),
    comparisonSummary: "",
    whyTopFour: reasons,
    riskNotes: selection.risks.slice(0, 3),
  };
}

function compareDailyPicks(left: DailyTopHitPick, right: DailyTopHitPick) {
  return (
    right.dailyScore - left.dailyScore ||
    right.hitProbability - left.hitProbability ||
    right.matchupScore - left.matchupScore ||
    right.lineupOpportunityScore - left.lineupOpportunityScore ||
    left.playerName.localeCompare(right.playerName)
  );
}

function buildDailyTopPicksComparison(picks: DailyTopHitPick[]): DailyTopHitPickComparison | null {
  if (picks.length === 0) {
    return null;
  }

  const leader = picks[0];
  const enrichedPicks = picks.map((pick, index) => {
    const next = picks[index + 1] ?? null;
    const comparisonSummary =
      index === 0
        ? `${pick.playerName} is the top daily pick because he combines the strongest overall score with ${formatPercent(pick.hitProbability, 1)} model probability.`
        : next
          ? `${pick.playerName} stays ahead of ${next.playerName} by ${formatPercent(pick.dailyScore - next.dailyScore, 1)} of daily score, mostly from ${pick.matchupScore >= next.matchupScore ? "matchup" : pick.lineupOpportunityScore >= next.lineupOpportunityScore ? "lineup opportunity" : "recent-history"} edge.`
          : `${pick.playerName} rounds out the four because the profile stayed balanced across matchup, lineup opportunity, and recent history.`;

    return {
      ...pick,
      rank: index + 1,
      comparisonSummary,
    };
  });

  return {
    summary: `${leader.playerName} leads the ${picks.length}-pick shortlist, but the four are selected as a group by balancing model probability, pitcher matchup, lineup opportunity, last-10/previous-game history, market value, and risk.`,
    differentiators: [
      "Matchup is weighted through pitcher fit, team offense, environment, and batter-vs-pitcher history where available.",
      "Lineup spot is treated as opportunity, with top-half bats getting more plate-appearance credit.",
      "Recent history includes hit-game rate, expected hits, at-bat quality trend, and the most recent game result.",
      "The final comparison penalizes elevated risk so the shortlist is not just the four highest raw probabilities.",
    ],
    picks: enrichedPicks,
  };
}

function buildDailyTopPicks(boards: GameHitBoardEntry[]) {
  const picks = boards
    .map((entry) => buildDailyPick(entry, 0))
    .filter((pick): pick is DailyTopHitPick => Boolean(pick))
    .sort(compareDailyPicks)
    .slice(0, 4);
  const comparison = buildDailyTopPicksComparison(picks);

  return {
    picks: comparison?.picks ?? picks.map((pick, index) => ({ ...pick, rank: index + 1 })),
    comparison,
  };
}

export async function buildPlayerHitAnalysis(input: {
  playerId?: number | null;
  playerName?: string | null;
  gamePk?: number | null;
  officialDate?: string | null;
  market?: AnalysisMarket;
  sportsbookOdds?: number | null;
  manualOddsInput?: string | null;
  sportsbook?: string | null;
}): Promise<PlayerHitAnalysisResponse> {
  const { player, warnings: playerWarnings } = await resolvePlayerForAnalystRequest({
    playerId: input.playerId ?? null,
    playerName: input.playerName ?? null,
  });

  if (!player) {
    throw new Error(playerWarnings[0] ?? "Player not found.");
  }

  const gameResolution = input.gamePk
    ? { game: await resolveGameForAnalystRequest(input.gamePk), warnings: [] as string[] }
    : await resolveUpcomingGameForPlayer({
        player,
        officialDate: input.officialDate ?? null,
      });
  const game = gameResolution.game;

  if (!game) {
    throw new Error(gameResolution.warnings[0] ?? "No upcoming game found for player analysis.");
  }

  const market = input.market ?? "hit";
  const analysis = await buildAnalysis(player.id, game.gamePk, market);
  const analystEngine = await buildAnalystPrediction({
    playerId: player.id,
    gamePk: game.gamePk,
    market,
    analysis,
    sportsbookOdds: input.sportsbookOdds ?? null,
    manualOddsInput: input.manualOddsInput ?? null,
    sportsbook: input.sportsbook ?? null,
  });

  return {
    generatedAt: new Date().toISOString(),
    game,
    analysis,
    analystEngine,
    requestResolution: {
      matchedPlayerId: player.id,
      matchedPlayerName: player.fullName,
      matchedGamePk: game.gamePk,
      warnings: [...playerWarnings, ...gameResolution.warnings],
    },
    manualOdds: analystEngine.manualOdds,
    warnings: analystEngine.dataQuality.warnings,
    sourcesUsed: analystEngine.dataQuality.sourcesUsed,
  };
}

export async function buildGameHitBoard(input: {
  gamePk: number;
  market?: "hit";
}): Promise<GameHitBoardEntry> {
  const market = input.market ?? "hit";
  const game = (await getGamesByDate()).find((candidate) => candidate.gamePk === input.gamePk)
    ?? (await getGameByPk(input.gamePk));

  if (!game) {
    throw new Error("Game not found.");
  }

  try {
    const comparison = await buildLineupComparison(input.gamePk, market);
    const selectedAnalyst = comparison.topPick
      ? await buildAnalystPrediction({
          playerId: comparison.topPick.hitter.player.id,
          gamePk: input.gamePk,
          market,
          analysis: comparison.topPick,
        }).catch(() => null)
      : null;

    return {
      game: comparison.game,
      available: Boolean(comparison.topPick),
      topPick: comparison.topPick,
      selectedAnalyst,
      selection: comparison.selection,
      players: comparison.players.slice(0, 8).map(compactPlayerRow),
      skippedPlayers: comparison.skippedPlayers,
      warnings: [
        ...(comparison.selection?.dataWarnings ?? []),
        ...(comparison.topPick?.notes ?? []).slice(0, 2),
      ],
    };
  } catch (error) {
    return {
      game,
      available: false,
      topPick: null,
      selectedAnalyst: null,
      selection: null,
      players: [],
      skippedPlayers: [],
      warnings: [
        error instanceof Error
          ? error.message
          : "Game hit board could not be built for this matchup.",
      ],
    };
  }
}

export async function buildBestHittersBoard(input?: {
  officialDate?: string | null;
}): Promise<BestHittersBoardResponse> {
  const officialDate = input?.officialDate ?? todayIsoDate();
  const games = await getGamesByDate(officialDate);
  const boards = await Promise.all(games.map((game) => buildGameHitBoard({ gamePk: game.gamePk })));
  const warnings = boards
    .filter((entry) => !entry.available)
    .map((entry) => `${entry.game.awayTeam.abbreviation} @ ${entry.game.homeTeam.abbreviation}: ${entry.warnings[0] ?? "unavailable"}`);

  boards.sort((left, right) => {
    const leftScore = left.selection?.finalScore ?? left.selectedAnalyst?.predictedProbability ?? 0;
    const rightScore = right.selection?.finalScore ?? right.selectedAnalyst?.predictedProbability ?? 0;
    return rightScore - leftScore;
  });
  const dailyTop = buildDailyTopPicks(boards);

  return {
    officialDate,
    generatedAt: new Date().toISOString(),
    market: "hit",
    games: boards,
    dailyTopPicks: dailyTop.picks,
    dailyTopPicksComparison: dailyTop.comparison,
    warnings,
    sourcesUsed: [
      "MLB StatsAPI",
      "Baseball Savant",
      "Open-Meteo when weather is available",
      "The Odds API when configured",
      "Local feedback calibration",
    ],
  };
}
