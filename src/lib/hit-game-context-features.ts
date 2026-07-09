import {
  type GameSummary,
  type GameWinPredictionResult,
  type GameWinTeamSnapshot,
  type HitGameContextFeatures,
} from "./types.ts";
import type { ExternalContext } from "./providers/provider-types.ts";
import { clamp } from "./utils.ts";

type HitGameContextConfig = {
  enabled: boolean;
  weight: number;
  maxBoost: number;
  maxPenalty: number;
  useMarketImpliedWinProbability: boolean;
  useInternalWinModel: boolean;
  blendMarketAndInternalWinContext: boolean;
  internalWeightWhenBlended: number;
};

function envFlag(name: string, fallback: boolean) {
  const value = process.env[name];

  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function envNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export function getHitGameContextConfig(): HitGameContextConfig {
  return {
    enabled: envFlag("ENABLE_GAME_CONTEXT_FOR_HIT_PROPS", true),
    weight: clamp(envNumber("HIT_GAME_CONTEXT_WEIGHT", 1), 0, 2),
    maxBoost: clamp(envNumber("MAX_GAME_CONTEXT_BOOST", 0.008), 0, 0.03),
    maxPenalty: clamp(envNumber("MAX_GAME_CONTEXT_PENALTY", 0.018), 0, 0.04),
    useMarketImpliedWinProbability: envFlag("USE_MARKET_IMPLIED_WIN_PROBABILITY", true),
    useInternalWinModel: envFlag("USE_INTERNAL_WIN_MODEL", true),
    blendMarketAndInternalWinContext: envFlag("BLEND_MARKET_AND_INTERNAL_WIN_CONTEXT", true),
    internalWeightWhenBlended: clamp(
      envNumber("HIT_GAME_CONTEXT_INTERNAL_BLEND_WEIGHT", 0.6),
      0,
      1,
    ),
  };
}

function rateEdge(value: number | null | undefined, baseline: number, scale: number) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 0;
  }

  return clamp((value - baseline) / scale, -1.25, 1.25);
}

function estimateLineupStrength(team: GameWinTeamSnapshot) {
  const topFiveCount = team.lineupPlayers.filter((player) => (player.lineupSlot ?? 99) <= 5).length;
  const lineupReleased = team.lineupStatus === "released" ? 1 : team.lineupStatus === "partial" ? 0.55 : 0.25;

  return clamp((topFiveCount / 5 - 0.72) * 0.6 + (lineupReleased - 0.5) * 0.22, -0.35, 0.35);
}

function estimateOffenseStrength(team: GameWinTeamSnapshot) {
  const opsEdge = rateEdge(team.offense?.ops, 0.733, 0.11);
  const obpEdge = rateEdge(team.offense?.obp, 0.318, 0.04);
  const slgEdge = rateEdge(team.offense?.slg, 0.415, 0.08);
  const recentEdge = rateEdge(team.recent.runDifferentialPerGame, 0, 1.6);

  return clamp(
    opsEdge * 0.42 +
      obpEdge * 0.2 +
      slgEdge * 0.22 +
      recentEdge * 0.08 +
      estimateLineupStrength(team),
    -1.2,
    1.2,
  );
}

function estimateRunPreventionStrength(team: GameWinTeamSnapshot) {
  const eraEdge = rateEdge(4.2 - (team.starter.season?.era ?? team.starter.priorSeason?.era ?? 4.2), 0, 1.5);
  const whipEdge = rateEdge(1.28 - (team.starter.season?.whip ?? team.starter.priorSeason?.whip ?? 1.28), 0, 0.35);
  const bullpenEdge = rateEdge(4.15 - (team.pitching?.era ?? 4.15), 0, 1.2);
  const defenseEdge = rateEdge(team.defense?.oaa, 0, 18);

  return clamp(
    eraEdge * 0.32 + whipEdge * 0.18 + bullpenEdge * 0.28 + defenseEdge * 0.16,
    -1.15,
    1.15,
  );
}

function marketHomeProbability(externalContext: ExternalContext | null | undefined) {
  return (
    externalContext?.odds?.noVigHomeWinProb ??
    externalContext?.features.marketImpliedHomeWinProb ??
    null
  );
}

function marketAwayProbability(externalContext: ExternalContext | null | undefined) {
  return (
    externalContext?.odds?.noVigAwayWinProb ??
    externalContext?.features.marketImpliedAwayWinProb ??
    null
  );
}

function chooseHomeWinProbability(input: {
  internalHomeWinProbability: number | null;
  marketHomeWinProbability: number | null;
  config: HitGameContextConfig;
}) {
  const { config, internalHomeWinProbability, marketHomeWinProbability } = input;

  if (
    config.useInternalWinModel &&
    config.useMarketImpliedWinProbability &&
    config.blendMarketAndInternalWinContext &&
    internalHomeWinProbability !== null &&
    marketHomeWinProbability !== null
  ) {
    return {
      source: "blended" as const,
      probability:
        internalHomeWinProbability * config.internalWeightWhenBlended +
        marketHomeWinProbability * (1 - config.internalWeightWhenBlended),
    };
  }

  if (config.useInternalWinModel && internalHomeWinProbability !== null) {
    return {
      source: "internal" as const,
      probability: internalHomeWinProbability,
    };
  }

  if (config.useMarketImpliedWinProbability && marketHomeWinProbability !== null) {
    return {
      source: "market" as const,
      probability: marketHomeWinProbability,
    };
  }

  return {
    source: "fallback" as const,
    probability: 0.5,
  };
}

function estimateTeamRuns(input: {
  team: GameWinTeamSnapshot;
  opponent: GameWinTeamSnapshot;
  teamWinProbability: number;
  parkWeatherRunFactor: number;
  homeFieldBonus: number;
}) {
  const offenseStrength = estimateOffenseStrength(input.team);
  const opponentPrevention = estimateRunPreventionStrength(input.opponent);

  return clamp(
    4.25 +
      offenseStrength * 0.78 -
      opponentPrevention * 0.52 +
      input.parkWeatherRunFactor * 1.15 +
      input.homeFieldBonus +
      (input.teamWinProbability - 0.5) * 0.58,
    2.7,
    6.8,
  );
}

export function buildHitGameContextFeatures(input: {
  game: GameSummary;
  hitterTeamId: number;
  gameWinPrediction: GameWinPredictionResult | null;
  externalContext: ExternalContext | null | undefined;
}): HitGameContextFeatures | null {
  const config = getHitGameContextConfig();

  if (!config.enabled) {
    return null;
  }

  const hitterIsHome = input.hitterTeamId === input.game.homeTeam.id;
  const hitterIsAway = input.hitterTeamId === input.game.awayTeam.id;

  if (!hitterIsHome && !hitterIsAway) {
    return null;
  }

  const internalHomeWinProbability = input.gameWinPrediction?.homeWinProbability ?? null;
  const selectedHomeWin = chooseHomeWinProbability({
    internalHomeWinProbability,
    marketHomeWinProbability: marketHomeProbability(input.externalContext),
    config,
  });
  const homeWinProbability = clamp(selectedHomeWin.probability, 0.08, 0.92);
  const awayWinProbability = clamp(1 - homeWinProbability, 0.08, 0.92);
  const hitterTeamWinProbability = hitterIsHome ? homeWinProbability : awayWinProbability;
  const opponentTeamWinProbability = 1 - hitterTeamWinProbability;
  const internalHitterTeamWinProbability =
    internalHomeWinProbability === null
      ? null
      : hitterIsHome
        ? internalHomeWinProbability
        : 1 - internalHomeWinProbability;
  const marketHitterTeamWinProbability =
    marketHomeProbability(input.externalContext) === null
      ? null
      : hitterIsHome
        ? marketHomeProbability(input.externalContext)
        : marketAwayProbability(input.externalContext);
  const homeTeam = input.gameWinPrediction?.homeTeam ?? null;
  const awayTeam = input.gameWinPrediction?.awayTeam ?? null;
  const hitterTeam = hitterIsHome ? homeTeam : awayTeam;
  const opponentTeam = hitterIsHome ? awayTeam : homeTeam;
  const parkWeatherRunFactor =
    (input.gameWinPrediction?.features.park_run_factor ?? 0) +
    (input.gameWinPrediction?.features.weather_run_environment ?? 0);

  const estimatedHomeRuns =
    homeTeam && awayTeam
      ? estimateTeamRuns({
          team: homeTeam,
          opponent: awayTeam,
          teamWinProbability: homeWinProbability,
          parkWeatherRunFactor,
          homeFieldBonus: 0.12,
        })
      : clamp(4.3 + (homeWinProbability - 0.5) * 1.2 + parkWeatherRunFactor * 0.8, 3, 6.2);
  const estimatedAwayRuns =
    homeTeam && awayTeam
      ? estimateTeamRuns({
          team: awayTeam,
          opponent: homeTeam,
          teamWinProbability: awayWinProbability,
          parkWeatherRunFactor,
          homeFieldBonus: -0.08,
        })
      : clamp(4.3 + (awayWinProbability - 0.5) * 1.2 + parkWeatherRunFactor * 0.8, 2.8, 6.1);
  const hitterTeamImpliedRuns = hitterIsHome ? estimatedHomeRuns : estimatedAwayRuns;
  const opponentTeamImpliedRuns = hitterIsHome ? estimatedAwayRuns : estimatedHomeRuns;
  const gameTotalRuns = clamp(estimatedHomeRuns + estimatedAwayRuns, 6.8, 11.6);
  const winProbabilityGap = Math.abs(hitterTeamWinProbability - opponentTeamWinProbability);
  const runTotalGap = Math.abs(hitterTeamImpliedRuns - opponentTeamImpliedRuns);
  const hitterTeamShareOfTotalRuns = clamp(hitterTeamImpliedRuns / gameTotalRuns, 0.22, 0.78);
  const gameCompetitivenessScore = clamp(
    1 -
      (Math.min(winProbabilityGap / 0.34, 1) * 0.62 +
        Math.min(runTotalGap / 2.3, 1) * 0.38),
    0,
    1,
  );
  const blowoutRiskScore = clamp(
    Math.min(winProbabilityGap / 0.34, 1) * 0.52 +
      Math.min(runTotalGap / 2.25, 1) * 0.33 +
      Math.max(0, (3.6 - Math.min(hitterTeamImpliedRuns, opponentTeamImpliedRuns)) / 1.6) *
        0.15,
    0,
    1,
  );
  const offensiveSupportScore = clamp(
    0.5 +
      (hitterTeamImpliedRuns - 4.3) / 2.2 * 0.36 +
      (hitterTeamWinProbability - 0.5) / 0.22 * 0.15 +
      (gameCompetitivenessScore - 0.5) * 0.14 +
      (hitterTeamShareOfTotalRuns - 0.5) * 0.14,
    0,
    1,
  );
  const offensiveSuppressionRisk = clamp(
    Math.max(0, (4.0 - hitterTeamImpliedRuns) / 1.8) * 0.48 +
      Math.max(0, (0.5 - hitterTeamWinProbability) / 0.22) * 0.28 +
      blowoutRiskScore * 0.16 +
      Math.max(0, (0.5 - hitterTeamShareOfTotalRuns) / 0.18) * 0.08,
    0,
    1,
  );
  const hitterTeamRunSupportIndex = clamp(
    (offensiveSupportScore - offensiveSuppressionRisk) * 0.9 +
      (hitterTeamShareOfTotalRuns - 0.5) * 0.35,
    -1,
    1,
  );
  const expectedPlateAppearanceEnvironment = clamp(
    1 +
      (gameTotalRuns - 8.6) * 0.014 +
      (gameCompetitivenessScore - 0.5) * 0.05 +
      (hitterTeamImpliedRuns - 4.3) * 0.018 -
      offensiveSuppressionRisk * 0.045,
    0.92,
    1.1,
  );
  const rawBoost = clamp(
    Math.max(0, offensiveSupportScore - 0.6) * 0.011 +
      Math.max(0, gameCompetitivenessScore - 0.58) * 0.004,
    0,
    config.maxBoost,
  );
  const rawPenalty = clamp(
    Math.max(0, offensiveSuppressionRisk - 0.45) * 0.024 +
      Math.max(0, blowoutRiskScore - 0.6) * 0.008,
    0,
    config.maxPenalty,
  );
  const contextAdjustmentDelta = clamp(
    (rawBoost - rawPenalty) * config.weight,
    -config.maxPenalty,
    config.maxBoost,
  );

  return {
    enabled: true,
    source: selectedHomeWin.source,
    hitterTeamWinProbability,
    opponentTeamWinProbability,
    internalHitterTeamWinProbability,
    marketHitterTeamWinProbability:
      marketHitterTeamWinProbability !== undefined ? marketHitterTeamWinProbability : null,
    winProbabilityGap,
    hitterTeamIsFavorite: hitterTeamWinProbability > opponentTeamWinProbability ? 1 : 0,
    hitterTeamIsUnderdog: hitterTeamWinProbability < opponentTeamWinProbability ? 1 : 0,
    hitterTeamImpliedRuns,
    opponentTeamImpliedRuns,
    gameTotalRuns,
    runTotalGap,
    hitterTeamShareOfTotalRuns,
    gameCompetitivenessScore,
    blowoutRiskScore,
    offensiveSuppressionRisk,
    offensiveSupportScore,
    hitContextBoost: rawBoost,
    hitContextPenalty: rawPenalty,
    expectedPlateAppearanceEnvironment,
    hitterTeamRunSupportIndex,
    contextAdjustmentDelta,
  };
}
