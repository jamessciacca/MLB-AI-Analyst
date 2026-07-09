import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  americanOddsToImpliedProbability,
  normalizeAmericanOddsInput,
} from "../src/lib/prediction/odds-utils.ts";
import { buildPredictionExplanation } from "../src/lib/prediction/explanation-builder.ts";
import { buildPredictionFeatureSnapshot } from "../src/lib/prediction/prediction-features.ts";
import { evaluateResolvedPredictions } from "../src/lib/prediction/model-evaluation.ts";
import { exportFeedbackToPlayerGameTrainingCsv } from "../src/lib/feedback.ts";

function sampleAnalysis(overrides = {}) {
  return {
    analysisId: "analysis-1",
    generatedAt: "2026-04-24T12:00:00.000Z",
    modelVersion: "test",
    market: "hit",
    marketLabel: "Hit",
    recommendation: "good play",
    confidence: "medium",
    probabilities: {
      perAtBat: 0.25,
      atLeastOne: 0.64,
      atLeastTwo: 0.22,
      expectedHits: 1.05,
      expectedAtBats: 4.2,
    },
    hitter: {
      player: {
        id: 1,
        fullName: "Test Hitter",
        currentTeamId: 10,
        currentTeamName: "Test Club",
        currentTeamAbbreviation: "TST",
        primaryPosition: "OF",
        batSide: "L",
        pitchHand: null,
      },
      season: {
        gamesPlayed: 20,
        atBats: 80,
        runs: 12,
        hits: 24,
        avg: 0.3,
        obp: 0.37,
        slg: 0.48,
        ops: 0.85,
        homeRuns: 4,
        plateAppearances: 92,
        strikeOuts: 18,
        baseOnBalls: 10,
        babip: 0.32,
      },
      priorSeason: null,
      expected: {
        playerId: 1,
        playerName: "Test Hitter",
        plateAppearances: 92,
        ballsInPlay: 55,
        battingAverage: 0.29,
        expectedBattingAverage: 0.31,
        slugging: 0.5,
        expectedSlugging: 0.52,
        woba: 0.36,
        expectedWoba: 0.38,
        era: null,
        expectedEra: null,
      },
      priorExpected: null,
      sprint: null,
      lineupSlot: 2,
      recentGames: [
        { gamePk: 1, date: "2026-04-20", opponent: "AAA", atBats: 4, hits: 2, runs: 1, rbi: 1, homeRuns: 0 },
        { gamePk: 2, date: "2026-04-21", opponent: "AAA", atBats: 5, hits: 1, runs: 0, rbi: 0, homeRuns: 0 },
      ],
    },
    pitcher: {
      player: {
        id: 2,
        fullName: "Test Pitcher",
        currentTeamId: 20,
        currentTeamName: "Other Club",
        currentTeamAbbreviation: "OTH",
        primaryPosition: "P",
        batSide: null,
        pitchHand: "R",
      },
      season: {
        gamesPlayed: 5,
        inningsPitched: 28,
        era: 4.2,
        avg: 0.255,
        whip: 1.31,
        strikeOuts: 25,
        baseOnBalls: 9,
        hits: 27,
        homeRuns: 4,
        battersFaced: 120,
      },
      priorSeason: null,
      expected: null,
      priorExpected: null,
      pitchMix: [],
      probable: true,
    },
    game: {
      gamePk: 99,
      gameDate: "2026-04-24T23:00:00Z",
      officialDate: "2026-04-24",
      status: "Preview",
      venue: { id: 1, name: "Test Park" },
      homeTeam: { id: 10, name: "Test Club", abbreviation: "TST" },
      awayTeam: { id: 20, name: "Other Club", abbreviation: "OTH" },
      homeProbablePitcher: null,
      awayProbablePitcher: null,
      homeScore: null,
      awayScore: null,
      dayNight: "night",
      weather: null,
      lineupStatus: null,
    },
    venue: null,
    weather: null,
    defense: null,
    factors: [
      { label: "Recent form", value: "+", impact: "positive", detail: "Last 10 hit rate is above baseline." },
      { label: "Pitcher", value: "-", impact: "negative", detail: "Opposing starter misses bats." },
    ],
    notes: [],
    diagnostics: {
      hitterSampleSize: 80,
      hitterRecentSampleSize: 9,
      pitcherSampleSize: 120,
      pitchMixCoverage: 0,
    },
    summary: "",
    aiSummary: null,
    previousModelResult: null,
    batterVsPitcher: null,
    externalContext: null,
    hitGameContext: null,
    debug: null,
    ...overrides,
  };
}

test("American odds conversion follows sportsbook implied probability formulas", () => {
  assert.equal(americanOddsToImpliedProbability(-145)?.toFixed(6), "0.591837");
  assert.equal(americanOddsToImpliedProbability(120)?.toFixed(6), "0.454545");
  assert.equal(normalizeAmericanOddsInput("DK +450").ok, true);
});

test("prediction feature snapshots include recent form and matchup features", () => {
  const snapshot = buildPredictionFeatureSnapshot(sampleAnalysis());

  assert.equal(snapshot.batter_avg, 0.3);
  assert.equal(snapshot.recent5_hits_per_game, 1.5);
  assert.equal(snapshot.pitcher_throws_left, 0);
  assert.equal(snapshot.lineup_slot, 2);
});

test("explanation builder returns positive, negative, missing data, and safety note", () => {
  const explanation = buildPredictionExplanation({ result: sampleAnalysis() });

  assert.equal(explanation.finalProbability, 0.64);
  assert.equal(explanation.confidenceLabel, "medium");
  assert.ok(explanation.topPositiveFactors[0].includes("Recent form"));
  assert.ok(explanation.topNegativeFactors[0].includes("Pitcher"));
  assert.ok(explanation.safetyNote.includes("not a lock"));
});

test("model evaluation reports Brier score and recent record", () => {
  const summary = evaluateResolvedPredictions({
    predictions: [
      { analysisId: "a", playerId: 1, playerName: "A", gamePk: 1, market: "hit", probability: 0.7, recommendation: "good play", modelVersion: "test", generatedAt: "2026-04-01", savedAt: "2026-04-01" },
      { analysisId: "b", playerId: 2, playerName: "B", gamePk: 2, market: "hit", probability: 0.3, recommendation: "avoid", modelVersion: "test", generatedAt: "2026-04-01", savedAt: "2026-04-01" },
    ],
    outcomes: [
      { analysisId: "a", playerId: 1, gamePk: 1, market: "hit", probability: 0.7, recommendation: "good play", rating: "correct", savedAt: "2026-04-02", source: "auto_outcome", actualHits: 1, actualHomeRuns: 0, outcomeSuccess: true, auditedAt: "2026-04-02" },
      { analysisId: "b", playerId: 2, gamePk: 2, market: "hit", probability: 0.3, recommendation: "avoid", rating: "correct", savedAt: "2026-04-02", source: "auto_outcome", actualHits: 0, actualHomeRuns: 0, outcomeSuccess: true, auditedAt: "2026-04-02" },
    ],
  });

  assert.equal(summary.sampleSize, 2);
  assert.ok(summary.brierScore !== null && summary.brierScore < 0.1);
  assert.equal(summary.recentRecord.wins, 2);
});

test("feedback training export writes a CSV even with sparse local feedback", async () => {
  const output = path.join(tmpdir(), `player-game-training-${Date.now()}.csv`);
  const result = await exportFeedbackToPlayerGameTrainingCsv(output);

  assert.equal(existsSync(output), true);
  assert.ok(result.rows >= 0);
  rmSync(output, { force: true });
});
