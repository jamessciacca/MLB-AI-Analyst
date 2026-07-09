import { type AnalysisResult, type GameWinPredictionResult } from "../types.ts";
import { clamp, formatPercent } from "../utils.ts";

import { type AnalystGameScriptContext, type AnalystOddsContext } from "./types.ts";

function rateEdge(value: number | null | undefined, baseline: number, scale: number) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 0;
  }

  return clamp((value - baseline) / scale, -1.2, 1.2);
}

export function buildGameScriptContext(input: {
  analysis: AnalysisResult;
  gameWinPrediction: GameWinPredictionResult | null;
  oddsContext: AnalystOddsContext | null;
}): AnalystGameScriptContext {
  const hitterTeamId = input.analysis.hitter.player.currentTeamId;
  const hitterIsHome = hitterTeamId === input.analysis.game.homeTeam.id;
  const teamSnapshot = hitterIsHome ? input.gameWinPrediction?.homeTeam : input.gameWinPrediction?.awayTeam;
  const opponentSnapshot = hitterIsHome ? input.gameWinPrediction?.awayTeam : input.gameWinPrediction?.homeTeam;
  const teamWinProbability =
    hitterIsHome
      ? input.oddsContext?.noVigHomeProbability ?? input.gameWinPrediction?.homeWinProbability ?? 0.5
      : input.oddsContext?.noVigAwayProbability ?? input.gameWinPrediction?.awayWinProbability ?? 0.5;
  const environmentBump =
    (input.gameWinPrediction?.features.park_run_factor ?? 0) +
    (input.gameWinPrediction?.features.weather_run_environment ?? 0);
  const impliedRuns = input.analysis.hitGameContext?.hitterTeamImpliedRuns ?? clamp(
    4.3 + (teamWinProbability - 0.5) * 1.2 + environmentBump * 0.9,
    3.0,
    6.8,
  );
  const opponentImpliedRuns = input.analysis.hitGameContext?.opponentTeamImpliedRuns ?? clamp(
    4.15 + ((1 - teamWinProbability) - 0.5) * 1.1 + environmentBump * 0.9,
    2.8,
    6.4,
  );
  const starterMismatch =
    rateEdge(opponentSnapshot?.starter.season?.era, 4.15, 1.25) -
    rateEdge(teamSnapshot?.starter.season?.era, 4.15, 1.25);
  const bullpenMismatch =
    rateEdge(opponentSnapshot?.bullpen.fatigueScore, 0.45, 0.25) +
    rateEdge(teamSnapshot?.pitching?.era ? 4.1 - teamSnapshot.pitching.era : null, 0, 1.1);
  const offenseGap =
    rateEdge(teamSnapshot?.offense?.ops, 0.73, 0.08) -
    rateEdge(opponentSnapshot?.offense?.ops, 0.73, 0.08);
  const winGap = Math.abs(teamWinProbability - (1 - teamWinProbability));
  const runGap = Math.abs(impliedRuns - opponentImpliedRuns);
  const blowoutRisk = clamp(
    winGap * 0.65 +
      clamp(runGap / 3, 0, 1) * 0.2 +
      clamp(starterMismatch / 1.5, -1, 1) * 0.08 +
      clamp(bullpenMismatch / 1.5, -1, 1) * 0.04 +
      clamp(offenseGap / 1.5, -1, 1) * 0.03,
    0,
    1,
  );
  const likelyWinningTeam =
    teamWinProbability >= 0.5
      ? (teamSnapshot?.team.name ?? (hitterIsHome ? input.analysis.game.homeTeam.name : input.analysis.game.awayTeam.name))
      : (opponentSnapshot?.team.name ?? (hitterIsHome ? input.analysis.game.awayTeam.name : input.analysis.game.homeTeam.name));
  const oneSidedRisk = blowoutRisk >= 0.6;
  const summary =
    blowoutRisk >= 0.7
      ? `${likelyWinningTeam} carries a high one-sided game risk, which can change late plate-appearance quality.`
      : blowoutRisk >= 0.5
        ? `${likelyWinningTeam} has a moderate script edge, but the game still projects playable.`
        : "The matchup projects competitive enough that full offensive opportunity should stay in play.";
  const explanation =
    `Win context ${formatPercent(teamWinProbability, 1)}, implied runs ${impliedRuns.toFixed(1)} to ${opponentImpliedRuns.toFixed(1)}, blowout risk ${(blowoutRisk * 100).toFixed(0)}%.`;

  return {
    teamWinProbability,
    impliedRuns,
    opponentImpliedRuns,
    gameTotal:
      input.oddsContext?.totalRuns ??
      (input.analysis.hitGameContext?.gameTotalRuns ?? null),
    blowoutRisk,
    likelyWinningTeam,
    oneSidedRisk,
    summary,
    explanation,
  };
}
