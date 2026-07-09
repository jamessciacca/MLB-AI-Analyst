import { clamp } from "../utils.ts";

import {
  type AnalystAtBatQualitySummary,
  type AnalystLast10Summary,
  type AnalystPatternDetection,
} from "./types.ts";

export function detectLast10Pattern(input: {
  last10Summary: AnalystLast10Summary | null;
  atBatQualitySummary: AnalystAtBatQualitySummary | null;
  pitcherMatchupScore?: number | null;
}): AnalystPatternDetection | null {
  const last10 = input.last10Summary;
  const quality = input.atBatQualitySummary;

  if (!last10 || !quality || last10.games.length === 0) {
    return null;
  }

  const latest = last10.games[0];
  const recentFive = last10.games.slice(0, 5);
  const hitRateLastFive =
    recentFive.reduce((sum, game) => sum + (game.hits > 0 ? 1 : 0), 0) /
    Math.max(recentFive.length, 1);
  const averageUnluckyOuts =
    recentFive.reduce((sum, game) => sum + game.unluckyOuts, 0) / Math.max(recentFive.length, 1);
  const averageBadOuts =
    recentFive.reduce((sum, game) => sum + game.badOuts, 0) / Math.max(recentFive.length, 1);
  const averageStrikeouts =
    recentFive.reduce((sum, game) => sum + game.strikeouts, 0) / Math.max(recentFive.length, 1);
  const contactVariance =
    Math.max(...recentFive.map((game) => game.atBatQualityScore)) -
    Math.min(...recentFive.map((game) => game.atBatQualityScore));
  const matchupPenalty = (input.pitcherMatchupScore ?? 0.5) < 0.45;

  if (
    latest.hits === 0 &&
    (latest.unluckyOuts >= 2 || latest.atBatQualityScore >= 0.6)
  ) {
    return {
      patternLabel: "bounce_back_candidate",
      patternScore: clamp(0.72 + latest.unluckyOuts * 0.05, 0.55, 0.95),
      confidence: latest.unluckyOuts >= 2 ? "high" : "medium",
      explanation:
        "The last box score missed, but the process did not. The hitter still created real contact quality and unlucky-out signals.",
      supportingGames: recentFive
        .filter((game) => game.unluckyOuts > 0 || game.atBatQualityScore > 0.4)
        .slice(0, 3)
        .map((game) => `${game.date}: ${game.hits}/${game.atBats}, ${game.unluckyOuts} unlucky outs`),
    };
  }

  if (hitRateLastFive >= 0.6 && (quality.last5 ?? 0) < 0.1 && averageUnluckyOuts < 0.4) {
    return {
      patternLabel: "fake_hot_streak",
      patternScore: 0.7,
      confidence: "medium",
      explanation:
        "Recent hit results look better than the underlying contact quality. The model sees more box-score heat than process heat.",
      supportingGames: recentFive
        .slice(0, 3)
        .map((game) => `${game.date}: ${game.hits}/${game.atBats}, quality ${game.atBatQualityScore.toFixed(2)}`),
    };
  }

  if (hitRateLastFive >= 0.6 && (quality.last5 ?? 0) >= 0.35) {
    return {
      patternLabel: "real_hot_streak",
      patternScore: 0.78,
      confidence: "high",
      explanation:
        "Hits and underlying process are moving together. The player is earning the hot stretch with better contact and cleaner at-bats.",
      supportingGames: recentFive
        .filter((game) => game.hits > 0)
        .slice(0, 3)
        .map((game) => `${game.date}: ${game.hits}/${game.atBats}, quality ${game.atBatQualityScore.toFixed(2)}`),
    };
  }

  if (
    hitRateLastFive <= 0.4 &&
    quality.trend === "rising" &&
    averageUnluckyOuts >= 0.6
  ) {
    return {
      patternLabel: "cold_but_improving",
      patternScore: 0.68,
      confidence: "medium",
      explanation:
        "Results have lagged, but the recent at-bats are sharper. The model sees a hitter whose process is improving before the hits fully show up.",
      supportingGames: recentFive
        .slice(0, 3)
        .map((game) => `${game.date}: quality ${game.atBatQualityScore.toFixed(2)}, unlucky outs ${game.unluckyOuts}`),
    };
  }

  if (
    (averageBadOuts >= 1.2 || averageStrikeouts >= 1.8 || quality.trend === "falling") &&
    matchupPenalty
  ) {
    return {
      patternLabel: "avoid",
      patternScore: 0.76,
      confidence: "high",
      explanation:
        "The recent at-bat quality is shaky and the matchup does not offer much relief. Strikeout pressure and weak-contact risk are both elevated.",
      supportingGames: recentFive
        .slice(0, 3)
        .map((game) => `${game.date}: ${game.strikeouts} K, ${game.badOuts} bad outs`),
    };
  }

  if (contactVariance <= 0.55 && averageStrikeouts <= 1 && last10.hitGames >= 6) {
    return {
      patternLabel: "consistent_contact",
      patternScore: 0.69,
      confidence: "medium",
      explanation:
        "The hitter has shown a repeatable contact profile without dramatic volatility. That usually plays well for safer hit-prop cases.",
      supportingGames: recentFive
        .slice(0, 3)
        .map((game) => `${game.date}: ${game.hits}/${game.atBats}, ${game.strikeouts} K`),
    };
  }

  if (contactVariance >= 1.2 || averageStrikeouts >= 2) {
    return {
      patternLabel: "boom_bust",
      patternScore: 0.64,
      confidence: "medium",
      explanation:
        "The recent sample has swung hard from loud contact to empty swings. That creates upside, but it is less stable for a hit prop.",
      supportingGames: recentFive
        .slice(0, 3)
        .map((game) => `${game.date}: quality ${game.atBatQualityScore.toFixed(2)}, ${game.strikeouts} K`),
    };
  }

  return {
    patternLabel: "steady_profile",
    patternScore: 0.58,
    confidence: "low",
    explanation:
      "The last-10 sample looks mostly stable without a major hot, cold, or bounce-back signal.",
    supportingGames: recentFive
      .slice(0, 3)
      .map((game) => `${game.date}: ${game.hits}/${game.atBats}`),
  };
}
