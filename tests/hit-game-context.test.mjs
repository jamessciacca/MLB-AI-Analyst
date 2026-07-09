import assert from "node:assert/strict";
import test from "node:test";

import { buildHitGameContextFeatures } from "../src/lib/hit-game-context-features.ts";
import { buildMlHitFeatureVector } from "../src/lib/ml-hit-features.ts";
import { scoreHitChance, scoreOutcomeChance } from "../src/lib/scoring.ts";

function makeGameWinPrediction({
  homeWinProbability,
  awayWinProbability,
  homeOps,
  awayOps,
  parkRunFactor = 0,
  weatherRunEnvironment = 0,
}) {
  return {
    homeWinProbability,
    awayWinProbability,
    homeTeam: {
      team: { id: 1, name: "Home", abbreviation: "HOM" },
      probablePitcher: { id: 10, fullName: "Home Starter", pitchHand: "R" },
      starter: {
        season: { era: 3.5, whip: 1.16 },
        expected: null,
        priorSeason: { era: 3.7, whip: 1.18 },
        priorExpected: null,
      },
      offense: { ops: homeOps, obp: 0.33, slg: 0.43 },
      pitching: { era: 3.9, whip: 1.22 },
      fielding: { fielding: 0.985 },
      defense: { oaa: 6, fieldingRunsPrevented: 0, armOverall: 0 },
      lineupStatus: "released",
      lineupPlayers: Array.from({ length: 9 }, (_, index) => ({
        id: 100 + index,
        fullName: `Home ${index + 1}`,
        lineupSlot: index + 1,
        primaryPosition: "OF",
        batSide: "R",
      })),
      recent: { games: 10, wins: 6, losses: 4, winPct: 0.6, runDifferentialPerGame: 0.4, restDays: 1 },
      bullpen: { recentInnings: 12, backToBackRelievers: 1, fatigueScore: 0.3 },
    },
    awayTeam: {
      team: { id: 2, name: "Away", abbreviation: "AWY" },
      probablePitcher: { id: 20, fullName: "Away Starter", pitchHand: "L" },
      starter: {
        season: { era: 4.5, whip: 1.31 },
        expected: null,
        priorSeason: { era: 4.2, whip: 1.28 },
        priorExpected: null,
      },
      offense: { ops: awayOps, obp: 0.31, slg: 0.4 },
      pitching: { era: 4.35, whip: 1.29 },
      fielding: { fielding: 0.983 },
      defense: { oaa: -4, fieldingRunsPrevented: 0, armOverall: 0 },
      lineupStatus: "released",
      lineupPlayers: Array.from({ length: 9 }, (_, index) => ({
        id: 200 + index,
        fullName: `Away ${index + 1}`,
        lineupSlot: index + 1,
        primaryPosition: "OF",
        batSide: "L",
      })),
      recent: { games: 10, wins: 4, losses: 6, winPct: 0.4, runDifferentialPerGame: -0.5, restDays: 1 },
      bullpen: { recentInnings: 14, backToBackRelievers: 2, fatigueScore: 0.45 },
    },
    features: {
      park_run_factor: parkRunFactor,
      weather_run_environment: weatherRunEnvironment,
    },
  };
}

function makeModelInput(hitGameContext) {
  return {
    hitter: {
      player: {
        id: 123,
        fullName: "William Contreras",
        currentTeamId: 1,
        currentTeamName: "Home",
        currentTeamAbbreviation: "HOM",
        batSide: "R",
      },
      season: {
        avg: 0.29,
        obp: 0.35,
        slg: 0.46,
        ops: 0.81,
        atBats: 100,
        gamesPlayed: 26,
        plateAppearances: 114,
        strikeOuts: 18,
        baseOnBalls: 10,
      },
      priorSeason: {
        avg: 0.284,
        obp: 0.34,
        slg: 0.455,
        ops: 0.795,
        atBats: 520,
        gamesPlayed: 136,
        plateAppearances: 585,
        strikeOuts: 95,
        baseOnBalls: 52,
      },
      expected: {
        expectedBattingAverage: 0.286,
        battingAverage: 0.282,
        expectedWoba: 0.352,
        woba: 0.348,
        expectedSlugging: 0.47,
        slugging: 0.46,
        plateAppearances: 114,
      },
      priorExpected: null,
      sprint: { sprintSpeed: 27.6 },
      lineupSlot: 2,
      events: [],
      recentGames: [
        { gamePk: 1, date: "2026-04-20", opponent: "AWY", atBats: 4, runs: 1, hits: 2, rbi: 1, homeRuns: 0 },
        { gamePk: 2, date: "2026-04-21", opponent: "AWY", atBats: 4, runs: 0, hits: 1, rbi: 0, homeRuns: 0 },
      ],
    },
    pitcher: {
      player: { id: 20, fullName: "Away Starter", pitchHand: "L" },
      season: {
        era: 4.4,
        whip: 1.29,
        avg: 0.252,
        battersFaced: 110,
        strikeOuts: 23,
        baseOnBalls: 10,
      },
      priorSeason: { era: 4.2, whip: 1.25, avg: 0.247, battersFaced: 600, strikeOuts: 130, baseOnBalls: 48 },
      expected: { expectedBattingAverage: 0.251, battingAverage: 0.249, expectedWoba: 0.326, woba: 0.324 },
      priorExpected: null,
      pitchMix: [],
      events: [],
      probable: true,
    },
    game: {
      gamePk: 555,
      officialDate: "2026-04-23",
      gameDate: "2026-04-23T23:10:00Z",
      homeTeam: { id: 1, name: "Home", abbreviation: "HOM" },
      awayTeam: { id: 2, name: "Away", abbreviation: "AWY" },
    },
    venue: {
      name: "Park",
      roofType: "open",
      turfType: "grass",
      dimensions: { leftLine: 335, leftCenter: 375, center: 400, rightCenter: 375, rightLine: 335 },
    },
    weather: {
      temperatureF: 72,
      precipitationProbability: 10,
      windSpeedMph: 8,
    },
    defense: {
      teamName: "Away",
      fieldingPct: 0.983,
      oaa: -4,
      armOverall: 0,
    },
    externalContext: { features: { weatherSeverityScore: 0.08, weatherBoostForHR: 0, marketImpliedHomeWinProb: 0.58, marketImpliedAwayWinProb: 0.42 } },
    gameWinContext: {
      hitterTeamWinProbability: hitGameContext?.hitterTeamWinProbability ?? 0.5,
      opponentWinProbability: hitGameContext?.opponentTeamWinProbability ?? 0.5,
      predictedWinnerTeamId: 1,
      confidence: "medium",
      modelVersion: "test-win-model",
    },
    hitGameContext,
  };
}

test("favorite and underdog contexts produce sensible support and suppression scores", () => {
  const favorite = buildHitGameContextFeatures({
    game: { homeTeam: { id: 1 }, awayTeam: { id: 2 } },
    hitterTeamId: 1,
    gameWinPrediction: makeGameWinPrediction({
      homeWinProbability: 0.64,
      awayWinProbability: 0.36,
      homeOps: 0.79,
      awayOps: 0.68,
      parkRunFactor: 0.03,
      weatherRunEnvironment: 0.02,
    }),
    externalContext: null,
  });
  const underdog = buildHitGameContextFeatures({
    game: { homeTeam: { id: 1 }, awayTeam: { id: 2 } },
    hitterTeamId: 2,
    gameWinPrediction: makeGameWinPrediction({
      homeWinProbability: 0.7,
      awayWinProbability: 0.3,
      homeOps: 0.81,
      awayOps: 0.66,
    }),
    externalContext: null,
  });

  assert.ok(favorite.offensiveSupportScore > underdog.offensiveSupportScore);
  assert.ok(underdog.offensiveSuppressionRisk > favorite.offensiveSuppressionRisk);
  assert.ok(underdog.contextAdjustmentDelta < favorite.contextAdjustmentDelta);
});

test("close games stay more competitive and lopsided games raise blowout risk", () => {
  const close = buildHitGameContextFeatures({
    game: { homeTeam: { id: 1 }, awayTeam: { id: 2 } },
    hitterTeamId: 1,
    gameWinPrediction: makeGameWinPrediction({
      homeWinProbability: 0.53,
      awayWinProbability: 0.47,
      homeOps: 0.75,
      awayOps: 0.74,
    }),
    externalContext: null,
  });
  const lopsided = buildHitGameContextFeatures({
    game: { homeTeam: { id: 1 }, awayTeam: { id: 2 } },
    hitterTeamId: 2,
    gameWinPrediction: makeGameWinPrediction({
      homeWinProbability: 0.76,
      awayWinProbability: 0.24,
      homeOps: 0.81,
      awayOps: 0.65,
    }),
    externalContext: null,
  });

  assert.ok(close.gameCompetitivenessScore > lopsided.gameCompetitivenessScore);
  assert.ok(lopsided.blowoutRiskScore > close.blowoutRiskScore);
});

test("context adjustment caps are respected", () => {
  const previousBoost = process.env.MAX_GAME_CONTEXT_BOOST;
  const previousPenalty = process.env.MAX_GAME_CONTEXT_PENALTY;
  process.env.MAX_GAME_CONTEXT_BOOST = "0.01";
  process.env.MAX_GAME_CONTEXT_PENALTY = "0.015";

  try {
    const context = buildHitGameContextFeatures({
      game: { homeTeam: { id: 1 }, awayTeam: { id: 2 } },
      hitterTeamId: 2,
      gameWinPrediction: makeGameWinPrediction({
        homeWinProbability: 0.82,
        awayWinProbability: 0.18,
        homeOps: 0.85,
        awayOps: 0.62,
      }),
      externalContext: null,
    });

    assert.ok(context.hitContextBoost <= 0.01 + 1e-9);
    assert.ok(context.hitContextPenalty <= 0.015 + 1e-9);
    assert.ok(context.contextAdjustmentDelta >= -0.015 - 1e-9);
  } finally {
    if (previousBoost === undefined) {
      delete process.env.MAX_GAME_CONTEXT_BOOST;
    } else {
      process.env.MAX_GAME_CONTEXT_BOOST = previousBoost;
    }
    if (previousPenalty === undefined) {
      delete process.env.MAX_GAME_CONTEXT_PENALTY;
    } else {
      process.env.MAX_GAME_CONTEXT_PENALTY = previousPenalty;
    }
  }
});

test("favorite boosts stay modest even in strong environments", () => {
  const favorite = buildHitGameContextFeatures({
    game: { homeTeam: { id: 1 }, awayTeam: { id: 2 } },
    hitterTeamId: 1,
    gameWinPrediction: makeGameWinPrediction({
      homeWinProbability: 0.78,
      awayWinProbability: 0.22,
      homeOps: 0.84,
      awayOps: 0.64,
      parkRunFactor: 0.04,
      weatherRunEnvironment: 0.03,
    }),
    externalContext: null,
  });

  assert.ok(favorite.hitContextBoost <= 0.008 + 1e-9);
  assert.ok(favorite.contextAdjustmentDelta <= 0.008 + 1e-9);
});

test("scoring output includes context explanation and debug values", () => {
  const hitGameContext = buildHitGameContextFeatures({
    game: { homeTeam: { id: 1 }, awayTeam: { id: 2 } },
    hitterTeamId: 2,
    gameWinPrediction: makeGameWinPrediction({
      homeWinProbability: 0.68,
      awayWinProbability: 0.32,
      homeOps: 0.8,
      awayOps: 0.67,
    }),
    externalContext: null,
  });
  const result = scoreHitChance(makeModelInput(hitGameContext));

  assert.ok(result.factors.some((factor) => factor.label === "Game script context"));
  assert.ok(result.notes.some((note) => note.includes("Game-shape context used")));
  assert.ok(result.debug?.hitGameContext?.preContextHitProbability !== null);
  assert.ok(result.debug?.hitGameContext?.finalHitProbability !== null);
});

test("ML feature vector accepts new game-context fields", () => {
  const hitGameContext = buildHitGameContextFeatures({
    game: { homeTeam: { id: 1 }, awayTeam: { id: 2 } },
    hitterTeamId: 1,
    gameWinPrediction: makeGameWinPrediction({
      homeWinProbability: 0.6,
      awayWinProbability: 0.4,
      homeOps: 0.78,
      awayOps: 0.7,
    }),
    externalContext: null,
  });
  const vector = buildMlHitFeatureVector(makeModelInput(hitGameContext));

  assert.equal(typeof vector.hitter_team_win_probability, "number");
  assert.equal(typeof vector.game_competitiveness_score, "number");
  assert.equal(typeof vector.hitter_team_run_support_index, "number");
});

test("home run scoring ignores hit-only game context overlays", () => {
  const hitGameContext = buildHitGameContextFeatures({
    game: { homeTeam: { id: 1 }, awayTeam: { id: 2 } },
    hitterTeamId: 1,
    gameWinPrediction: makeGameWinPrediction({
      homeWinProbability: 0.74,
      awayWinProbability: 0.26,
      homeOps: 0.82,
      awayOps: 0.64,
    }),
    externalContext: null,
  });
  const withContext = scoreOutcomeChance(makeModelInput(hitGameContext), "home_run");
  const withoutContext = scoreOutcomeChance(makeModelInput(null), "home_run");

  assert.equal(withContext.hitGameContext, null);
  assert.equal(withContext.debug, null);
  assert.deepEqual(
    withContext.factors.filter((factor) =>
      factor.label === "Game script context" || factor.label === "Offensive support",
    ),
    [],
  );
  assert.equal(
    withContext.probabilities.expectedAtBats,
    withoutContext.probabilities.expectedAtBats,
  );
});
