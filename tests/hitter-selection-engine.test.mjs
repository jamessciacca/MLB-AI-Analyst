import test from "node:test";
import assert from "node:assert/strict";

import { selectBestHitterForGame } from "../src/lib/analyst/hitter-selection-service.ts";

function makePlayer(input) {
  return {
    analysis: {
      market: "hit",
      confidence: input.confidence ?? "medium",
      recommendation: "good play",
      probabilities: {
        atLeastOne: input.hitProbability,
      },
      hitter: {
        player: {
          id: input.playerId,
          fullName: input.playerName,
          currentTeamAbbreviation: input.teamAbbreviation,
          currentTeamName: input.teamName,
        },
        lineupSlot: input.lineupSlot,
        season: {
          ops: input.ops,
          homeRuns: input.homeRuns,
        },
        expected: {
          expectedSlugging: input.xslg,
        },
      },
      game: {
        homeTeam: {
          abbreviation: "NYY",
        },
        awayTeam: {
          abbreviation: "BOS",
        },
      },
    },
    analyst: {
      predictedProbability: input.hitProbability,
      recommendation: input.analystRecommendation ?? "moderate",
      edgeIfAvailable: null,
      topReasonsAgainst: input.topReasonsAgainst ?? [],
      last10Summary: {
        gamesAnalyzed: 10,
        hitGames: input.hitGames ?? 6,
        expectedHitsPerGame: input.expectedHitsPerGame ?? 0.9,
        qualityTrend: input.qualityTrend ?? "steady",
        games: Array.from({ length: 10 }, (_, index) => ({
          date: `2026-04-${String(20 - index).padStart(2, "0")}`,
          hits: index < (input.hitGames ?? 6) ? 1 : 0,
          atBats: 4,
          unluckyOuts: input.unluckyOuts ?? 0,
          atBatQualityScore: input.atBatQualityScore ?? 0.1,
        })),
      },
      atBatQualitySummary: {
        last10: input.atBatQualityScore ?? 0.1,
        last5: input.last5Quality ?? input.atBatQualityScore ?? 0.1,
        trend: input.qualityTrend ?? "steady",
      },
      detectedPattern: input.pattern
        ? {
            patternLabel: input.pattern,
          }
        : null,
      components: {
        pitcherMatchupScore: input.matchupScore,
        teamOffenseScore: input.teamOffenseScore ?? 0.56,
        gameEnvironmentScore: input.environmentScore ?? 0.54,
      },
      gameScript: {
        blowoutRisk: input.blowoutRisk ?? 0.34,
      },
      dataQuality: {
        missingFields: [],
        warnings: [],
      },
    },
  };
}

test("selection engine can choose the better profile over the bigger-name star", () => {
  const result = selectBestHitterForGame({
    market: "hit",
    players: [
      makePlayer({
        playerId: 1,
        playerName: "Big Star",
        teamAbbreviation: "NYY",
        teamName: "Yankees",
        lineupSlot: 3,
        ops: 0.95,
        xslg: 0.56,
        homeRuns: 34,
        hitProbability: 0.63,
        matchupScore: 0.46,
        atBatQualityScore: -0.25,
        last5Quality: -0.3,
        qualityTrend: "falling",
        topReasonsAgainst: ["Higher strikeout risk in this matchup."],
        hitGames: 4,
      }),
      makePlayer({
        playerId: 2,
        playerName: "Value Bat",
        teamAbbreviation: "NYY",
        teamName: "Yankees",
        lineupSlot: 2,
        ops: 0.77,
        xslg: 0.43,
        homeRuns: 10,
        hitProbability: 0.66,
        matchupScore: 0.61,
        atBatQualityScore: 0.45,
        last5Quality: 0.58,
        qualityTrend: "rising",
        pattern: "bounce_back_candidate",
        hitGames: 7,
        unluckyOuts: 2,
      }),
      makePlayer({
        playerId: 3,
        playerName: "Secondary Option",
        teamAbbreviation: "BOS",
        teamName: "Red Sox",
        lineupSlot: 1,
        ops: 0.81,
        xslg: 0.45,
        homeRuns: 15,
        hitProbability: 0.6,
        matchupScore: 0.55,
        atBatQualityScore: 0.18,
        hitGames: 6,
      }),
    ],
  });

  assert.ok(result);
  assert.equal(result.selectedHitter, "Value Bat");
  assert.ok(
    result.whyNotTheStarPlayer.some((reason) => reason.includes("Big Star")),
  );
  assert.ok(result.analystNarrative.analystParagraph.includes("not just the biggest name"));
});

test("selection engine keeps a clear probability leader as the top hit pick", () => {
  const result = selectBestHitterForGame({
    market: "hit",
    players: [
      makePlayer({
        playerId: 4,
        playerName: "Clear Probability Leader",
        teamAbbreviation: "SEA",
        teamName: "Mariners",
        lineupSlot: 3,
        ops: 0.9,
        xslg: 0.52,
        homeRuns: 22,
        hitProbability: 0.75,
        matchupScore: 0.5,
        atBatQualityScore: 0.02,
        hitGames: 5,
      }),
      makePlayer({
        playerId: 5,
        playerName: "Profile Darling",
        teamAbbreviation: "STL",
        teamName: "Cardinals",
        lineupSlot: 2,
        ops: 0.73,
        xslg: 0.38,
        homeRuns: 5,
        hitProbability: 0.68,
        matchupScore: 0.68,
        atBatQualityScore: 0.62,
        last5Quality: 0.72,
        qualityTrend: "rising",
        pattern: "bounce_back_candidate",
        hitGames: 8,
      }),
    ],
  });

  assert.ok(result);
  assert.equal(result.selectedHitter, "Clear Probability Leader");
  assert.equal(result.hitProbability, 0.75);
});
