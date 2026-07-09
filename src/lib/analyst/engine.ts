import { buildAnalysis } from "../analyzer.ts";
import { buildGameWinPrediction } from "../game-win-analyzer.ts";
import { buildManualOddsAnalysis } from "../odds-math.ts";
import { type AnalysisResult } from "../types.ts";
import { clamp, formatPercent } from "../utils.ts";

import { getBallparkContext } from "./ballpark-service.ts";
import { getAnalystCalibrationSummary } from "./calibration.ts";
import { buildGameScriptContext } from "./game-script-service.ts";
import { buildHitProjection } from "./hit-projection-engine.ts";
import { buildLast10GamePattern } from "./last10-game-service.ts";
import {
  americanOddsToImpliedProbability,
  expectedValueFromAmericanOdds,
  probabilityToAmericanOdds,
} from "./math.ts";
import { runMatchupSimulation } from "./matchup-simulation-service.ts";
import { getAnalystOddsContext, getPropOddsForPlayer } from "./odds-service.ts";
import { detectLast10Pattern } from "./pattern-detection-service.ts";
import { buildAnalystStatcastContext } from "./statcast-service.ts";
import {
  type AnalystLean,
  type AnalystMarket,
  type AnalystPredictionResult,
  type AnalystValueRating,
} from "./types.ts";
import { getAnalystWeights } from "./weights.ts";
import { getAnalystWeatherContext } from "./weather-service.ts";

function toProbabilityScore(edge: number, scale = 0.18) {
  return clamp(0.5 + edge * scale, 0.03, 0.97);
}

function safeDifference(
  left: number | null | undefined,
  right: number | null | undefined,
  fallback = 0,
) {
  if (
    left === null ||
    left === undefined ||
    right === null ||
    right === undefined ||
    !Number.isFinite(left) ||
    !Number.isFinite(right)
  ) {
    return fallback;
  }

  return left - right;
}

function lineupSpotBonus(lineupSlot: number | null | undefined) {
  if (!lineupSlot) {
    return 0;
  }

  const mapping: Record<number, number> = {
    1: 0.08,
    2: 0.07,
    3: 0.065,
    4: 0.055,
    5: 0.04,
    6: 0.02,
    7: -0.005,
    8: -0.02,
    9: -0.03,
  };

  return mapping[lineupSlot] ?? 0;
}

function marketLabel(market: AnalystMarket) {
  if (market === "home_run") {
    return "To Hit a Home Run";
  }
  if (market === "hit_2_plus") {
    return "To Record 2+ Hits";
  }
  if (market === "total_bases") {
    return "To Record 2+ Total Bases";
  }
  if (market === "rbi") {
    return "To Record an RBI";
  }
  if (market === "runs") {
    return "To Score a Run";
  }

  return "To Record a Hit";
}

function leanForProbability(
  probability: number,
  confidence: AnalysisResult["confidence"],
  market: AnalystMarket,
): AnalystLean {
  const strongThreshold =
    market === "home_run"
      ? 0.26
      : market === "hit_2_plus"
        ? 0.34
      : market === "total_bases"
        ? 0.42
        : market === "rbi" || market === "runs"
          ? 0.4
          : 0.66;
  const moderateThreshold =
    market === "home_run"
      ? 0.18
      : market === "hit_2_plus"
        ? 0.22
      : market === "total_bases"
        ? 0.32
        : market === "rbi" || market === "runs"
          ? 0.3
          : 0.56;
  const riskyThreshold = market === "home_run" ? 0.1 : market === "hit_2_plus" ? 0.16 : 0.45;

  if (probability >= strongThreshold && confidence !== "low") {
    return "strong";
  }
  if (probability >= moderateThreshold) {
    return "moderate";
  }
  if (probability >= riskyThreshold) {
    return "risky";
  }

  return "avoid";
}

function buildPitchMixNotes(analysis: AnalysisResult) {
  if (analysis.pitcher.pitchMix.length === 0) {
    return ["Pitch-mix detail unavailable."];
  }

  return analysis.pitcher.pitchMix.slice(0, 3).map((pitch) =>
    `${pitch.label} ${pitch.usage.toFixed(1)}% usage; analyst engine treats it as a primary shape in the matchup.`,
  );
}

function valueRatingFromEdge(edge: number | null | undefined): AnalystValueRating {
  if (edge === null || edge === undefined || !Number.isFinite(edge)) {
    return "no odds available";
  }
  if (edge >= 0.035) {
    return "positive value";
  }
  if (edge <= -0.025) {
    return "overpriced";
  }

  return "neutral";
}

function formatAmericanOdds(odds: number | null | undefined) {
  if (odds === null || odds === undefined || !Number.isFinite(odds)) {
    return "n/a";
  }

  return odds > 0 ? `+${odds}` : String(odds);
}

function relevantOddsWarnings(
  requestedMarket: AnalystMarket,
  warnings: string[],
) {
  const normalizedMarket = requestedMarket === "home_run" ? "home run" : "hit";

  return warnings.filter((warning) => {
    const lowered = warning.toLowerCase();

    if (lowered.includes("home run odds")) {
      return normalizedMarket === "home run";
    }

    if (lowered.includes("hit odds")) {
      return normalizedMarket === "hit";
    }

    return true;
  });
}

function supportingMarketProbabilities(input: {
  hitProbability: number;
  homeRunProbability: number;
  totalBasesPowerScore: number;
  runProductionScore: number;
  runScoringScore: number;
  confidence: AnalysisResult["confidence"];
}) {
  const totalBasesProbability = clamp(
    0.1 + input.hitProbability * 0.38 + input.totalBasesPowerScore * 0.34,
    0.04,
    0.82,
  );
  const rbiProbability = clamp(
    0.08 + input.runProductionScore * 0.62,
    0.03,
    0.72,
  );
  const runsProbability = clamp(
    0.1 + input.runScoringScore * 0.58,
    0.04,
    0.74,
  );

  return [
    {
      market: "home_run" as const,
      predictedProbability: input.homeRunProbability,
      lean: leanForProbability(input.homeRunProbability, input.confidence, "home_run"),
      summary: `Power, launch profile, and environment put the HR context at ${formatPercent(input.homeRunProbability, 1)}.`,
    },
    {
      market: "total_bases" as const,
      predictedProbability: totalBasesProbability,
      lean: leanForProbability(totalBasesProbability, input.confidence, "total_bases"),
      summary: `Hit probability plus slugging context point to ${formatPercent(totalBasesProbability, 1)} for 2+ total bases.`,
    },
    {
      market: "rbi" as const,
      predictedProbability: rbiProbability,
      lean: leanForProbability(rbiProbability, input.confidence, "rbi"),
      summary: `Lineup slot and team run support place RBI context at ${formatPercent(rbiProbability, 1)}.`,
    },
    {
      market: "runs" as const,
      predictedProbability: runsProbability,
      lean: leanForProbability(runsProbability, input.confidence, "runs"),
      summary: `On-base skill and offensive environment place run-scoring context at ${formatPercent(runsProbability, 1)}.`,
    },
  ];
}

function componentScores(input: {
  analysis: AnalysisResult;
  requestedMarket: AnalystMarket;
  statcast: Awaited<ReturnType<typeof buildAnalystStatcastContext>>;
  homeRunReference: AnalysisResult | null;
}) {
  const batter = input.statcast.batter;
  const pitcher = input.statcast.pitcher;
  const hitProbability = input.analysis.market === "hit" || input.analysis.market === "hit_2_plus"
    ? input.analysis.probabilities.atLeastOne
    : clamp(
        0.18 +
          (input.analysis.hitter.expected?.expectedBattingAverage ?? input.analysis.hitter.season?.avg ?? 0.245) * 0.8,
        0.2,
        0.82,
      );
  const homeRunProbability =
    input.homeRunReference?.probabilities.atLeastOne ??
    clamp(
      0.04 +
        ((input.analysis.hitter.expected?.expectedSlugging ?? input.analysis.hitter.season?.slg ?? 0.4) - 0.4) * 0.28 +
        ((batter.last30.barrelRate ?? batter.season.barrelRate ?? 0.07) - 0.07) * 1.2,
      0.02,
      0.45,
    );

  const batterEdge =
    safeDifference(batter.last14.avg, 0.245) * 1.8 +
    safeDifference(batter.last30.xba, 0.245) * 1.4 +
    safeDifference(batter.vsHandedness.avg, 0.245) * 1.4 +
    safeDifference(batter.season.hardHitRate, 0.39) * 0.55 +
    lineupSpotBonus(input.analysis.hitter.lineupSlot);
  const pitcherEdge =
    safeDifference(0.245, pitcher.vsHandedness.avg) * 1.6 +
    safeDifference(input.analysis.pitcher.expected?.expectedBattingAverage, 0.245) * -1.25 +
    safeDifference(0.39, pitcher.season.hardHitRate) * 0.35 +
    safeDifference(0.22, input.analysis.pitcher.season?.strikeOuts && input.analysis.pitcher.season?.battersFaced
      ? input.analysis.pitcher.season.strikeOuts / input.analysis.pitcher.season.battersFaced
      : null) * 0.4 +
    (input.analysis.batterVsPitcher?.plateAppearances
      ? safeDifference(input.analysis.batterVsPitcher.battingAverage, 0.245) * 0.6
      : 0);

  return {
    statcast: input.statcast,
    hitProbability,
    homeRunProbability,
    batterContextScore: toProbabilityScore(batterEdge),
    pitcherMatchupScore: toProbabilityScore(pitcherEdge),
  };
}

export async function buildAnalystPrediction(input: {
  playerId: number;
  gamePk: number;
  market?: AnalystMarket;
  analysis?: AnalysisResult | null;
  sportsbookOdds?: number | null;
  manualOddsInput?: string | null;
  sportsbook?: string | null;
}): Promise<AnalystPredictionResult> {
  const requestedMarket = input.market ?? "hit";
  const baseMarket =
    requestedMarket === "home_run"
      ? "home_run"
      : requestedMarket === "hit_2_plus"
        ? "hit_2_plus"
        : "hit";
  const analysis =
    input.analysis && input.analysis.market === baseMarket
      ? input.analysis
      : await buildAnalysis(input.playerId, input.gamePk, baseMarket);
  const homeRunReference =
    baseMarket === "home_run"
      ? analysis
      : await buildAnalysis(input.playerId, input.gamePk, "home_run").catch(() => null);
  const [gameWinPrediction, weatherContext, oddsBundle, calibration, last10Context] = await Promise.all([
    buildGameWinPrediction(input.gamePk).catch(() => null),
    getAnalystWeatherContext({
      venue: analysis.venue,
      game: analysis.game,
      existingWeather: analysis.weather,
    }),
    getAnalystOddsContext({
      game: analysis.game,
      externalContext: analysis.externalContext,
    }),
    getAnalystCalibrationSummary(requestedMarket, analysis.probabilities.atLeastOne),
    requestedMarket === "hit" || requestedMarket === "hit_2_plus"
      ? buildLast10GamePattern({
          playerId: analysis.hitter.player.id,
          referenceDate: analysis.game.officialDate,
        }).catch(() => ({
          last10Summary: null,
          atBatQualitySummary: null,
          warnings: ["Last-10 game pattern analysis was unavailable for this hitter."],
        }))
      : Promise.resolve({
          last10Summary: null,
          atBatQualitySummary: null,
          warnings: [] as string[],
        }),
  ]);
  const oddsContext = oddsBundle.moneyline;
  const oddsWarnings = relevantOddsWarnings(requestedMarket, oddsBundle.warnings);
  const statcast = await buildAnalystStatcastContext(analysis);
  const weights = getAnalystWeights();
  const statcastComponents = componentScores({
    analysis,
    requestedMarket,
    statcast,
    homeRunReference,
  });
  const ballpark = getBallparkContext(analysis.venue, analysis.game);
  const gameScript = buildGameScriptContext({
    analysis,
    gameWinPrediction,
    oddsContext,
  });
  const teamOffenseEdge =
    safeDifference(gameScript.impliedRuns, 4.3) * 0.45 +
    lineupSpotBonus(analysis.hitter.lineupSlot) +
    safeDifference(gameWinPrediction?.homeTeam.bullpen.fatigueScore, gameWinPrediction?.awayTeam.bullpen.fatigueScore) * 0.1 +
    safeDifference(analysis.hitGameContext?.hitterTeamRunSupportIndex, 0) * 0.22;
  const environmentEdge =
    (ballpark.hitFactor - 1) * (requestedMarket === "home_run" ? 0.6 : 0.42) +
    (ballpark.homeRunFactor - 1) * (requestedMarket === "home_run" ? 0.95 : 0.18) +
    safeDifference(weatherContext?.temperatureF, 70) * 0.0025 +
    safeDifference(1, weatherContext?.airDensityScore, 0) * 0.25 +
    (weatherContext?.windImpact === "blowing_out"
      ? requestedMarket === "home_run"
        ? 0.08
        : 0.025
      : weatherContext?.windImpact === "blowing_in"
        ? requestedMarket === "home_run"
          ? -0.065
          : -0.02
        : 0);
  const marketEdge =
    safeDifference(
      gameScript.teamWinProbability,
      0.5,
    ) * 0.35 +
    safeDifference(oddsContext?.totalRuns, 8.5) * 0.03 +
    safeDifference(gameScript.impliedRuns, 4.3) * 0.08;
  const modelProbability =
    requestedMarket === "home_run"
      ? statcastComponents.homeRunProbability
      : requestedMarket === "hit_2_plus"
        ? analysis.probabilities.atLeastTwo ?? analysis.probabilities.atLeastOne
        : requestedMarket === "total_bases"
          ? clamp(
            0.12 +
              statcastComponents.hitProbability * 0.45 +
              ((analysis.hitter.expected?.expectedSlugging ?? analysis.hitter.season?.slg ?? 0.4) - 0.4) * 0.5,
            0.05,
            0.8,
          )
        : requestedMarket === "rbi"
      ? clamp(0.08 + gameScript.impliedRuns * 0.05 + lineupSpotBonus(analysis.hitter.lineupSlot) * 0.8, 0.04, 0.75)
          : requestedMarket === "runs"
            ? clamp(
                0.1 +
                  (analysis.hitter.season?.obp ?? analysis.hitter.priorSeason?.obp ?? 0.318) * 0.45 +
                  lineupSpotBonus(analysis.hitter.lineupSlot) * 0.65 +
                  safeDifference(gameScript.impliedRuns, 4.3) * 0.05,
                0.05,
                0.76,
              )
            : statcastComponents.hitProbability;
  const playerPropOdds =
    requestedMarket === "hit"
      ? getPropOddsForPlayer({
          props: oddsBundle.batterHits,
          playerName: analysis.hitter.player.fullName,
          market: "batter_hits",
        })
      : requestedMarket === "home_run"
        ? getPropOddsForPlayer({
            props: oddsBundle.batterHomeRuns,
            playerName: analysis.hitter.player.fullName,
            market: "batter_home_runs",
          })
        : null;
  const teamOffenseScore = toProbabilityScore(teamOffenseEdge);
  const gameEnvironmentScore = toProbabilityScore(environmentEdge);
  const playerMarketProbability =
    playerPropOdds?.noVigOverProbability ??
    playerPropOdds?.overImpliedProbability ??
    null;
  const marketProbability =
    playerMarketProbability !== null
      ? clamp(playerMarketProbability * 0.72 + toProbabilityScore(marketEdge) * 0.28, 0.03, 0.97)
      : toProbabilityScore(marketEdge);
  const feedbackCalibrationScore = clamp(
    modelProbability + calibration.adjustment,
    0.01,
    0.99,
  );
  const isHomeHitter = analysis.hitter.player.currentTeamId === analysis.game.homeTeam.id;
  const opponentBullpenFatigue = gameWinPrediction
    ? isHomeHitter
      ? gameWinPrediction.awayTeam.bullpen.fatigueScore
      : gameWinPrediction.homeTeam.bullpen.fatigueScore
    : null;
  const detectedPattern =
    requestedMarket === "hit"
      ? detectLast10Pattern({
          last10Summary: last10Context.last10Summary,
          atBatQualitySummary: last10Context.atBatQualitySummary,
          pitcherMatchupScore: statcastComponents.pitcherMatchupScore,
        })
      : null;
  const simulationSummary =
    requestedMarket === "hit"
      ? runMatchupSimulation({
          playerId: analysis.hitter.player.id,
          gamePk: analysis.game.gamePk,
          modelPerAtBatProbability: analysis.probabilities.perAtBat,
          last10Summary: last10Context.last10Summary,
          atBatQualitySummary: last10Context.atBatQualitySummary,
          statcast,
          pitcherMatchupScore: statcastComponents.pitcherMatchupScore,
          lineupSlot: analysis.hitter.lineupSlot,
          impliedRuns: gameScript.impliedRuns,
          ballparkHitFactor: ballpark.hitFactor,
          weatherHitAdjustment: gameEnvironmentScore - 0.5,
          bullpenFatigue: opponentBullpenFatigue,
        })
      : null;
  const hitProjection =
    requestedMarket === "hit"
      ? buildHitProjection({
          seasonBaselineProbability: modelProbability,
          pitcherMatchupScore: statcastComponents.pitcherMatchupScore,
          last10Summary: last10Context.last10Summary,
          atBatQualitySummary: last10Context.atBatQualitySummary,
          simulationSummary,
          environmentScore: clamp(gameEnvironmentScore * 0.7 + teamOffenseScore * 0.3, 0.01, 0.99),
          feedbackCalibrationScore,
        })
      : null;
  const finalProbability =
    requestedMarket === "hit" && hitProjection
      ? clamp(
          hitProjection.finalProbability * (1 - weights.marketContext) +
            marketProbability * weights.marketContext,
          0.01,
          0.99,
        )
      : clamp(
          modelProbability * weights.modelProbability +
            statcastComponents.batterContextScore * weights.batterContext +
            statcastComponents.pitcherMatchupScore * weights.pitcherMatchup +
            teamOffenseScore * weights.teamOffense +
            gameEnvironmentScore * weights.gameEnvironment +
            marketProbability * weights.marketContext +
            feedbackCalibrationScore * weights.feedbackCalibration,
          0.01,
          0.99,
        );
  const recommendation = leanForProbability(finalProbability, analysis.confidence, requestedMarket);
  const fairOdds = probabilityToAmericanOdds(finalProbability);
  const sportsbookOdds =
    input.sportsbookOdds ??
    (requestedMarket === "hit" || requestedMarket === "home_run"
      ? playerPropOdds?.overOdds ?? null
      : analysis.hitter.player.currentTeamId === analysis.game.homeTeam.id
        ? oddsContext?.homeMoneyline ?? null
        : oddsContext?.awayMoneyline ?? null);
  const impliedSportsbookProbability = americanOddsToImpliedProbability(sportsbookOdds);
  const noVigMarketProbability =
    playerPropOdds?.noVigOverProbability ??
    (requestedMarket === "hit" || requestedMarket === "home_run"
      ? null
      : analysis.hitter.player.currentTeamId === analysis.game.homeTeam.id
        ? oddsContext?.noVigHomeProbability ?? null
        : oddsContext?.noVigAwayProbability ?? null);
  const edgeIfAvailable =
    sportsbookOdds !== null && impliedSportsbookProbability !== null
      ? finalProbability - impliedSportsbookProbability
      : null;
  const expectedValuePercent = expectedValueFromAmericanOdds(finalProbability, sportsbookOdds);
  const manualOdds =
    input.manualOddsInput && sportsbookOdds !== null
      ? buildManualOddsAnalysis({
          modelProbability: finalProbability,
          originalInput: input.manualOddsInput,
          normalizedOdds: sportsbookOdds,
          sportsbook: input.sportsbook ?? null,
        })
      : null;
  const valueRating = valueRatingFromEdge(edgeIfAvailable);
  const topReasonsFor = [
    statcastComponents.batterContextScore > 0.54
      ? `Batter form is live: last-14 hit quality profile points to ${formatPercent(statcastComponents.batterContextScore, 0)} context strength.`
      : null,
    detectedPattern?.patternLabel === "bounce_back_candidate"
      ? "Last game looked better than the box score, which makes this a real bounce-back candidate."
      : null,
    (last10Context.atBatQualitySummary?.trend ?? "steady") === "rising"
      ? "At-bat quality has been trending up over the short sample."
      : null,
    statcastComponents.pitcherMatchupScore > 0.54
      ? `Pitcher matchup is favorable against this handedness and quality-of-contact profile.`
      : null,
    simulationSummary
      ? `Simulation still lands ${formatPercent(simulationSummary.simulatedHitProbability, 1)} for at least one hit.`
      : null,
    edgeIfAvailable !== null && edgeIfAvailable >= 0.03
      ? `Sportsbook price is softer than the model at ${formatPercent(edgeIfAvailable, 1)} of edge.`
      : null,
    manualOdds && manualOdds.edge >= 0.07
      ? `User-entered ${manualOdds.sportsbook ?? "sportsbook"} odds create a strong positive value gap.`
      : null,
    gameScript.impliedRuns >= 4.8
      ? `Team scoring environment is healthy at ${gameScript.impliedRuns.toFixed(1)} implied runs.`
      : null,
    weatherContext?.windImpact === "blowing_out"
      ? `Wind is helping offense: ${weatherContext.windSummary}`
      : null,
    ballpark.hitFactor > 1.02 || ballpark.homeRunFactor > 1.04
      ? `${ballpark.venueName} grades as a positive offensive environment.`
      : null,
    analysis.hitter.lineupSlot !== null && analysis.hitter.lineupSlot <= 5
      ? `Projected lineup slot ${analysis.hitter.lineupSlot} supports full plate-appearance volume.`
      : null,
  ].filter((value): value is string => Boolean(value)).slice(0, 4);
  const pitcherEra = analysis.pitcher.season?.era ?? null;
  const topReasonsAgainst = [
    detectedPattern?.patternLabel === "avoid"
      ? "Recent last-10 pattern throws a caution flag because the process has been slipping."
      : null,
    detectedPattern?.patternLabel === "fake_hot_streak"
      ? "Recent hit results may be running a bit hotter than the underlying contact quality."
      : null,
    analysis.pitcher.player?.fullName && pitcherEra !== null && pitcherEra < 3.6
      ? `${analysis.pitcher.player.fullName} still brings above-average run prevention.`
      : null,
    gameScript.blowoutRisk >= 0.62
      ? `Blowout risk is elevated at ${(gameScript.blowoutRisk * 100).toFixed(0)}%, which can warp late-game opportunity.`
      : null,
    weatherContext?.windImpact === "blowing_in"
      ? `Weather leans against damage: ${weatherContext.windSummary}`
      : null,
    analysis.pitcher.player?.pitchHand
      ? `Pitcher handedness creates a ${analysis.hitter.player.batSide ?? "unknown"}-vs-${analysis.pitcher.player.pitchHand} split check.`
      : null,
    edgeIfAvailable !== null && edgeIfAvailable <= -0.025
      ? "The current sportsbook price is tighter than the model prefers."
      : null,
    manualOdds && manualOdds.edge <= -0.07
      ? `The user-entered ${manualOdds.sportsbook ?? "sportsbook"} line looks materially overpriced against the model.`
      : null,
    oddsContext === null
      ? "Vegas context is missing, so the model is leaning more heavily on internal baseball inputs."
      : null,
    analysis.game.lineupStatus?.status !== "released"
      ? "Lineup is not fully confirmed yet, which lowers certainty on plate appearances and RBI/run context."
      : null,
  ].filter((value): value is string => Boolean(value)).slice(0, 4);
  const supportingMarkets = supportingMarketProbabilities({
    hitProbability: statcastComponents.hitProbability,
    homeRunProbability: statcastComponents.homeRunProbability,
    totalBasesPowerScore:
      clamp(
        ((analysis.hitter.expected?.expectedSlugging ?? analysis.hitter.season?.slg ?? 0.4) - 0.4) * 1.2 +
          ((statcastComponents.statcast.batter.last30.hardHitRate ?? 0.39) - 0.39) * 0.7 +
          gameScript.impliedRuns * 0.04,
        0,
        1,
      ),
    runProductionScore:
      clamp(
        gameScript.impliedRuns * 0.08 +
          lineupSpotBonus(analysis.hitter.lineupSlot) +
          ((analysis.hitter.season?.ops ?? 0.733) - 0.733) * 1.2 +
          (gameScript.teamWinProbability - 0.5) * 0.25,
        0,
        1,
      ),
    runScoringScore:
      clamp(
        ((analysis.hitter.season?.obp ?? analysis.hitter.priorSeason?.obp ?? 0.318) - 0.318) * 1.5 +
          lineupSpotBonus(analysis.hitter.lineupSlot) +
          gameScript.impliedRuns * 0.07,
        0,
        1,
      ),
    confidence: analysis.confidence,
  });
  const missingFields = [
    analysis.pitcher.player ? null : "probable_pitcher",
    analysis.weather ? null : "weather",
    oddsContext || playerPropOdds ? null : "odds",
    analysis.venue ? null : "venue",
    analysis.game.lineupStatus?.status === "released" ? null : "confirmed_lineup",
    calibration.sampleSize > 0 ? null : "feedback_calibration",
  ].filter((value): value is string => Boolean(value));
  const warnings = [
    ...statcastComponents.statcast.warnings,
    ...last10Context.warnings,
    ...oddsWarnings,
    ...(analysis.externalContext?.confidenceFlags ?? []),
    ...(analysis.externalContext?.missingFields.map((field) => `External context missing ${field}.`) ?? []),
    ...(analysis.pitcher.probable ? [] : ["Probable pitcher is missing, so matchup confidence is lower."]),
    ...(manualOdds ? ["Manual sportsbook odds were user-entered and are not official market data."] : []),
    ...(oddsContext || playerPropOdds
      ? []
      : ["The Odds API key was missing or odds were unavailable; Vegas context was skipped or downgraded."]),
  ];
  const sourcesUsed = [
    "MLB StatsAPI",
    "Baseball Savant",
    last10Context.last10Summary ? "MLB live play-by-play" : null,
    weatherContext ? "Open-Meteo" : null,
    oddsContext?.source === "the-odds-api" || playerPropOdds
      ? "The Odds API"
      : oddsContext?.source === "espn-fallback"
        ? "ESPN odds fallback"
        : null,
    manualOdds ? "User-entered sportsbook odds" : null,
    calibration.sampleSize > 0 ? "Local outcome feedback" : null,
  ].filter((value): value is string => Boolean(value));
  const manualOddsSummary = manualOdds
    ? ` The manually entered ${manualOdds.sportsbook ?? "sportsbook"} line of ${formatAmericanOdds(manualOdds.normalizedOdds)} implies ${formatPercent(manualOdds.impliedProbability, 1)}, leaving a ${manualOdds.edge >= 0 ? "+" : "-"}${formatPercent(Math.abs(manualOdds.edge), 1)} edge.`
    : "";

  return {
    playerName: analysis.hitter.player.fullName,
    playerId: analysis.hitter.player.id,
    gamePk: analysis.game.gamePk,
    market: requestedMarket,
    marketLabel: marketLabel(requestedMarket),
    predictedProbability: finalProbability,
    confidence: analysis.confidence,
    recommendation,
    fairOdds,
    sportsbookOdds,
    sportsbookImpliedProbability: impliedSportsbookProbability,
    noVigMarketProbability,
    valueRating,
    sportsbookOddsIfAvailable: sportsbookOdds ?? null,
    edgeIfAvailable,
    expectedValuePercent,
    summary: `${analysis.hitter.player.fullName} ${marketLabel(requestedMarket).toLowerCase()} projects at ${formatPercent(finalProbability, 1)} with ${analysis.confidence} confidence. ${detectedPattern ? `${detectedPattern.explanation} ` : ""}${gameScript.summary}${manualOddsSummary}`,
    topReasonsFor,
    topReasonsAgainst,
    gameScript,
    matchup: {
      pitcher: analysis.pitcher.player?.fullName ?? "TBD",
      pitcherHand: analysis.pitcher.player?.pitchHand ?? null,
      batterVsHand:
        statcastComponents.statcast.batter.vsHandedness.avg !== null
          ? `${formatPercent(statcastComponents.statcast.batter.vsHandedness.avg, 1)} outcome rate vs ${analysis.pitcher.player?.pitchHand ?? "that"} hand`
          : "Split sample vs this handedness is limited.",
      pitchMixNotes: buildPitchMixNotes(analysis),
      batterVsPitcherHistory:
        analysis.batterVsPitcher?.summary ??
        `${analysis.hitter.player.fullName} has no meaningful batter-vs-pitcher history in the local Statcast sample.`,
    },
    environment: {
      ballpark,
      weather: weatherContext,
      windImpact: weatherContext?.windSummary ?? "Wind context unavailable.",
      summary: `${ballpark.venueName} hit factor ${ballpark.hitFactor.toFixed(2)}, HR factor ${ballpark.homeRunFactor.toFixed(2)}.${weatherContext ? ` ${weatherContext.windSummary}` : ""}`,
    },
    vegas: oddsContext,
    playerPropOdds,
    manualOdds,
    dataQuality: {
      confidence: analysis.confidence,
      sourcesUsed,
      missingFields,
      warnings,
    },
    last10Summary: last10Context.last10Summary,
    atBatQualitySummary: last10Context.atBatQualitySummary,
    detectedPattern,
    simulationSummary,
    supportingMarkets,
    components: {
      modelProbability,
      batterContextScore: statcastComponents.batterContextScore,
      pitcherMatchupScore: statcastComponents.pitcherMatchupScore,
      teamOffenseScore,
      gameEnvironmentScore,
      marketProbability,
      feedbackCalibrationScore,
      appliedFeedbackAdjustment: calibration.adjustment,
      weights,
      hitProjectionBreakdown: hitProjection?.breakdown ?? null,
    },
  };
}
