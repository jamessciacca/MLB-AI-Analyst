import { clamp } from "../utils.ts";

import {
  type AnalystAtBatQualitySummary,
  type AnalystLast10Summary,
  type AnalystSimulationSummary,
  type AnalystStatcastContext,
} from "./types.ts";
import { normalizeAtBatQualityScore } from "./at-bat-quality-service.ts";

function createSeed(input: string) {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;

  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function lineupProjectedPlateAppearances(lineupSlot: number | null | undefined, impliedRuns: number) {
  const baseBySlot: Record<number, number> = {
    1: 4.75,
    2: 4.58,
    3: 4.47,
    4: 4.36,
    5: 4.22,
    6: 4.05,
    7: 3.94,
    8: 3.82,
    9: 3.74,
  };
  const base = lineupSlot ? baseBySlot[lineupSlot] ?? 4 : 4;

  return clamp(base + (impliedRuns - 4.3) * 0.18, 3.1, 5.3);
}

export function runMatchupSimulation(input: {
  playerId: number;
  gamePk: number;
  modelPerAtBatProbability: number;
  last10Summary: AnalystLast10Summary | null;
  atBatQualitySummary: AnalystAtBatQualitySummary | null;
  statcast: AnalystStatcastContext;
  pitcherMatchupScore: number;
  lineupSlot: number | null | undefined;
  impliedRuns: number;
  ballparkHitFactor: number;
  weatherHitAdjustment: number;
  bullpenFatigue: number | null | undefined;
  simulations?: number;
}): AnalystSimulationSummary | null {
  const last10Games = input.last10Summary?.games ?? [];
  const totalAtBats = last10Games.reduce((sum, game) => sum + game.atBats, 0);
  const totalHits = last10Games.reduce((sum, game) => sum + game.hits, 0);
  const last10PerAtBat =
    totalAtBats > 0 ? totalHits / totalAtBats : input.modelPerAtBatProbability;
  const last10AtBatQuality = normalizeAtBatQualityScore(input.atBatQualitySummary?.last10 ?? 0);
  const last5AtBatQuality = normalizeAtBatQualityScore(input.atBatQualitySummary?.last5 ?? 0);
  const batterVsHand =
    input.statcast.batter.vsHandedness.avg ??
    input.statcast.batter.last14.avg ??
    input.statcast.batter.season.avg ??
    0.245;
  const pitcherAllowed =
    input.statcast.pitcher.vsHandedness.avg ??
    input.statcast.pitcher.last14.avg ??
    input.statcast.pitcher.season.avg ??
    0.245;
  const pitcherKRate =
    input.statcast.pitcher.vsHandedness.strikeoutRate ??
    input.statcast.pitcher.season.strikeoutRate ??
    0.22;
  const pitcherWhiffRate =
    input.statcast.pitcher.vsHandedness.whiffRate ??
    input.statcast.pitcher.season.whiffRate ??
    0.25;
  const pitcherHardHitAllowed =
    input.statcast.pitcher.vsHandedness.hardHitRate ??
    input.statcast.pitcher.season.hardHitRate ??
    0.39;
  const projectedPlateAppearances = lineupProjectedPlateAppearances(
    input.lineupSlot,
    input.impliedRuns,
  );
  const bullpenBoost = (input.bullpenFatigue ?? 0.45) - 0.45;
  const basePerPa = clamp(
    input.modelPerAtBatProbability * 0.32 +
      last10PerAtBat * 0.18 +
      batterVsHand * 0.14 +
      pitcherAllowed * 0.14 +
      last10AtBatQuality * 0.1 +
      last5AtBatQuality * 0.06 +
      (1 - pitcherKRate) * 0.03 +
      (1 - pitcherWhiffRate) * 0.02 +
      pitcherHardHitAllowed * 0.05 +
      (input.pitcherMatchupScore - 0.5) * 0.08 +
      (input.ballparkHitFactor - 1) * 0.1 +
      input.weatherHitAdjustment * 0.06 +
      bullpenBoost * 0.05,
    0.06,
    0.62,
  );
  const simulations = input.simulations ?? 10000;
  const seed = createSeed(`${input.playerId}:${input.gamePk}:last10-sim`);
  const random = mulberry32(seed);
  let hitGames = 0;
  let totalHitsSimulated = 0;

  for (let simulationIndex = 0; simulationIndex < simulations; simulationIndex += 1) {
    const paRoll = random();
    const plateAppearances =
      paRoll < 0.18
        ? Math.max(3, Math.floor(projectedPlateAppearances))
        : paRoll > 0.82
          ? Math.min(5, Math.ceil(projectedPlateAppearances))
          : Math.max(3, Math.min(5, Math.round(projectedPlateAppearances)));
    let hitsThisGame = 0;

    for (let paIndex = 0; paIndex < plateAppearances; paIndex += 1) {
      const perPa = clamp(
        basePerPa +
          (paIndex >= 3 ? bullpenBoost * 0.015 : 0) +
          (random() - 0.5) * 0.05,
        0.02,
        0.78,
      );

      if (random() < perPa) {
        hitsThisGame += 1;
      }
    }

    if (hitsThisGame > 0) {
      hitGames += 1;
    }
    totalHitsSimulated += hitsThisGame;
  }

  const simulatedHitProbability = hitGames / simulations;
  const standardError = Math.sqrt(
    (simulatedHitProbability * (1 - simulatedHitProbability)) / simulations,
  );
  const low = clamp(simulatedHitProbability - 1.96 * standardError, 0.01, 0.99);
  const high = clamp(simulatedHitProbability + 1.96 * standardError, 0.01, 0.99);
  const factors = [
    last10PerAtBat > input.modelPerAtBatProbability
      ? "Last-10 hit rate is running ahead of the season baseline."
      : null,
    last5AtBatQuality > last10AtBatQuality
      ? "Recent at-bat quality has improved over the shorter window."
      : null,
    input.pitcherMatchupScore >= 0.54
      ? "Pitcher matchup score is favorable for balls in play."
      : null,
    input.impliedRuns >= 4.7
      ? "Run environment supports extra plate appearances."
      : null,
    input.ballparkHitFactor > 1.02
      ? "Ballpark trends slightly toward offense."
      : null,
    pitcherKRate >= 0.26 ? "Pitcher strikeout pressure still caps the floor." : null,
  ].filter((value): value is string => Boolean(value)).slice(0, 4);

  return {
    simulations,
    seed,
    projectedPlateAppearances,
    simulatedHitProbability,
    noHitProbability: 1 - simulatedHitProbability,
    averageSimulatedHits: totalHitsSimulated / simulations,
    confidenceInterval: [low, high],
    mostImportantFactors: factors,
    summary: `Seeded ${simulations.toLocaleString()}-game simulation gives ${(
      simulatedHitProbability * 100
    ).toFixed(1)}% for at least one hit across about ${projectedPlateAppearances.toFixed(1)} projected plate appearances.`,
  };
}
