import { buildAnalystPrediction } from "../analyst/engine.ts";
import { buildAnalysis } from "../analyzer.ts";
import { buildGameWinPrediction } from "../game-win-analyzer.ts";
import { buildManualOddsAnalysis } from "../odds-math.ts";
import { type AnalysisMarket } from "../types.ts";

import { buildPredictionExplanation } from "./explanation-builder.ts";

export async function buildPlayerPrediction(input: {
  playerId: number;
  gamePk: number;
  market: AnalysisMarket;
  sportsbookOdds?: number | null;
  manualOddsInput?: string | null;
  sportsbook?: string | null;
}) {
  const analysis = await buildAnalysis(input.playerId, input.gamePk, input.market);
  const analystEngine = await buildAnalystPrediction({
    playerId: input.playerId,
    gamePk: input.gamePk,
    market: input.market,
    analysis,
    sportsbookOdds: input.sportsbookOdds ?? null,
    manualOddsInput: input.manualOddsInput ?? null,
    sportsbook: input.sportsbook ?? null,
  });
  const manualOdds =
    input.sportsbookOdds !== null && input.sportsbookOdds !== undefined && input.manualOddsInput
      ? buildManualOddsAnalysis({
          modelProbability: analysis.probabilities.atLeastOne,
          originalInput: input.manualOddsInput,
          normalizedOdds: input.sportsbookOdds,
          sportsbook: input.sportsbook,
        })
      : null;

  return {
    analysis,
    analystEngine,
    explainability: buildPredictionExplanation({
      result: analysis,
      manualOdds,
    }),
  };
}

export async function buildTeamWinPrediction(input: { gamePk: number }) {
  return buildGameWinPrediction(input.gamePk);
}
