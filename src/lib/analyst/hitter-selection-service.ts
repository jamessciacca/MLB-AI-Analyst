import {
  type AnalysisResult,
  type HitterSelectionComparisonEntry,
  type HitterSelectionResult,
  type Recommendation,
} from "../types.ts";
import { clamp } from "../utils.ts";

import { buildAnalystNarrative } from "./analyst-narrative-service.ts";
import { type AnalystPredictionResult } from "./types.ts";

function normalizeRecommendation(recommendation: AnalystPredictionResult["recommendation"]): Recommendation {
  if (recommendation === "strong" || recommendation === "moderate") {
    return "good play";
  }
  if (recommendation === "risky") {
    return "neutral";
  }

  return "avoid";
}

function starPowerScore(entry: {
  analysis: AnalysisResult;
  analyst: AnalystPredictionResult;
}) {
  const seasonOps = entry.analysis.hitter.season?.ops ?? 0.72;
  const expectedSlugging =
    entry.analysis.hitter.expected?.expectedSlugging ?? entry.analysis.hitter.season?.slg ?? 0.4;
  const homeRuns = entry.analysis.hitter.season?.homeRuns ?? 14;
  const lineupBonus = entry.analysis.hitter.lineupSlot && entry.analysis.hitter.lineupSlot <= 4 ? 0.08 : 0;

  return clamp(
    (seasonOps - 0.72) * 0.85 +
      (expectedSlugging - 0.4) * 0.55 +
      homeRuns / 80 +
      lineupBonus +
      0.35,
    0.05,
    0.98,
  );
}

function buildComparisonReason(input: {
  analysis: AnalysisResult;
  analyst: AnalystPredictionResult;
  valueScore: number;
  underTheRadarScore: number;
  riskScore: number;
}) {
  const reasons = [
    input.analyst.detectedPattern?.patternLabel === "bounce_back_candidate"
      ? "bounce-back pattern after unlucky contact"
      : null,
    (input.analyst.atBatQualitySummary?.last5 ?? 0) > (input.analyst.atBatQualitySummary?.last10 ?? 0)
      ? "at-bat quality is improving"
      : null,
    input.analyst.components.pitcherMatchupScore >= 0.54
      ? "pitcher matchup is favorable"
      : null,
    input.valueScore >= 0.55 ? "better value profile than the obvious stars" : null,
    input.underTheRadarScore >= 0.58 ? "safer under-the-radar profile" : null,
    input.riskScore >= 0.55 ? "risk is elevated in this spot" : null,
  ].filter((value): value is string => Boolean(value));

  return reasons[0] ?? "balanced hit-prop profile";
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function compareSelectionRows(
  left: HitterSelectionComparisonEntry,
  right: HitterSelectionComparisonEntry,
) {
  const probabilityGap = right.hitProbability - left.hitProbability;

  if (Math.abs(probabilityGap) > 0.015) {
    return probabilityGap;
  }

  return (
    right.finalScore - left.finalScore ||
    probabilityGap ||
    left.playerName.localeCompare(right.playerName)
  );
}

export function selectBestHitterForGame(input: {
  market: AnalysisResult["market"];
  players: Array<{
    analysis: AnalysisResult;
    analyst: AnalystPredictionResult;
  }>;
}): HitterSelectionResult | null {
  if (input.players.length === 0) {
    return null;
  }

  const comparisonTable: HitterSelectionComparisonEntry[] = input.players.map((entry) => {
    const starPower = starPowerScore(entry);
    const recentFormScore = clamp(
      entry.analyst.last10Summary
        ? (entry.analyst.last10Summary.hitGames / Math.max(entry.analyst.last10Summary.gamesAnalyzed, 1)) * 0.45 +
            ((entry.analyst.last10Summary.expectedHitsPerGame ?? 0.7) / 1.2) * 0.25 +
            (entry.analyst.last10Summary.qualityTrend === "rising" ? 0.15 : entry.analyst.last10Summary.qualityTrend === "falling" ? -0.08 : 0)
        : 0.5,
      0.05,
      0.95,
    );
    const atBatQualityScore = clamp(
      0.5 +
        (entry.analyst.atBatQualitySummary?.last10 ?? 0) * 0.18 +
        (entry.analyst.atBatQualitySummary?.trend === "rising"
          ? 0.08
          : entry.analyst.atBatQualitySummary?.trend === "falling"
            ? -0.06
            : 0),
      0.05,
      0.95,
    );
    const rawProbabilityScore = entry.analyst.predictedProbability;
    const matchupScore = clamp(
      entry.analyst.components.pitcherMatchupScore * 0.65 +
        entry.analyst.components.teamOffenseScore * 0.15 +
        entry.analyst.components.gameEnvironmentScore * 0.2,
      0.05,
      0.95,
    );
    const valueScore = clamp(
      rawProbabilityScore * 0.62 +
        atBatQualityScore * 0.18 +
        recentFormScore * 0.12 -
        starPower * 0.18 -
        (entry.analyst.edgeIfAvailable !== null && entry.analyst.edgeIfAvailable !== undefined
          ? clamp(-entry.analyst.edgeIfAvailable, -0.12, 0.16)
          : 0),
      0.05,
      0.95,
    );
    const underTheRadarScore = clamp(
      (1 - starPower) * 0.58 + rawProbabilityScore * 0.24 + atBatQualityScore * 0.18,
      0.05,
      0.95,
    );
    const riskScore = clamp(
      (entry.analyst.detectedPattern?.patternLabel === "avoid" ? 0.2 : 0) +
        (entry.analyst.detectedPattern?.patternLabel === "boom_bust" ? 0.14 : 0) +
        (entry.analyst.dataQuality.missingFields.length > 0 ? 0.08 : 0) +
        (entry.analyst.gameScript.blowoutRisk >= 0.62 ? 0.08 : 0) +
        (entry.analysis.hitter.lineupSlot && entry.analysis.hitter.lineupSlot >= 7 ? 0.08 : 0) +
        entry.analyst.topReasonsAgainst.length * 0.045,
      0.05,
      0.95,
    );
    const finalScore = clamp(
      rawProbabilityScore * 0.34 +
        matchupScore * 0.18 +
        recentFormScore * 0.15 +
        atBatQualityScore * 0.15 +
        valueScore * 0.1 +
        underTheRadarScore * 0.08 -
        riskScore * 0.12,
      0.01,
      0.99,
    );

    return {
      playerId: entry.analysis.hitter.player.id,
      playerName: entry.analysis.hitter.player.fullName,
      teamAbbreviation: entry.analysis.hitter.player.currentTeamAbbreviation,
      teamName: entry.analysis.hitter.player.currentTeamName,
      lineupSlot: entry.analysis.hitter.lineupSlot,
      finalScore,
      hitProbability: entry.analyst.predictedProbability,
      confidence: entry.analysis.confidence,
      recommendation: normalizeRecommendation(entry.analyst.recommendation),
      rawProbabilityScore,
      matchupScore,
      recentFormScore,
      atBatQualityScore,
      valueScore,
      underTheRadarScore,
      riskScore,
      reason: buildComparisonReason({
        analysis: entry.analysis,
        analyst: entry.analyst,
        valueScore,
        underTheRadarScore,
        riskScore,
      }),
    };
  });

  comparisonTable.sort(compareSelectionRows);

  const selected = comparisonTable[0] ?? null;

  if (!selected) {
    return null;
  }

  const selectedFull = input.players.find(
    (entry) => entry.analysis.hitter.player.id === selected.playerId,
  );

  if (!selectedFull) {
    return null;
  }

  const sameTeamRows = comparisonTable.filter(
    (entry) => entry.teamAbbreviation === selected.teamAbbreviation,
  );
  const obviousStar =
    sameTeamRows
      .map((row) => ({
        row,
        starPower: starPowerScore(
          input.players.find((entry) => entry.analysis.hitter.player.id === row.playerId)!,
        ),
      }))
      .sort((left, right) => right.starPower - left.starPower)[0]?.row ?? null;
  const topAlternatives = comparisonTable
    .filter((entry) => entry.playerId !== selected.playerId)
    .slice(0, 3);
  const selectedAnalyst = selectedFull.analyst;
  const whyHeStandsOut = uniqueStrings([
    selectedAnalyst.last10Summary?.qualityTrend === "rising"
      ? "Strong recent process and improving last-10 game contact pattern."
      : null,
    (selectedAnalyst.atBatQualitySummary?.last10 ?? 0) > 0.2
      ? "At-bat quality has been better than a basic box-score read."
      : null,
    selectedAnalyst.detectedPattern?.patternLabel === "bounce_back_candidate"
      ? "He profiles as a bounce-back candidate after unlucky outs."
      : null,
    selectedAnalyst.components.pitcherMatchupScore >= 0.54
      ? "The pitcher matchup is friendlier than it is for many teammates."
      : null,
    selected.valueScore >= 0.55
      ? "He offers a better value profile than the bigger-name hitters around him."
      : null,
    selected.underTheRadarScore >= 0.58
      ? "He is more under-the-radar than the obvious star while keeping a strong hit probability."
      : null,
    selected.riskScore <= 0.3 ? "His risk profile is cleaner than the louder alternatives." : null,
  ]).slice(0, 4);
  const whyNotTheStarPlayer =
    obviousStar && obviousStar.playerId !== selected.playerId
      ? uniqueStrings([
          selected.recentFormScore > obviousStar.recentFormScore + 0.04
            ? `${obviousStar.playerName} has the bigger name, but ${selected.playerName} owns the better recent form for a hit prop.`
            : null,
          selected.atBatQualityScore > obviousStar.atBatQualityScore + 0.04
            ? `${selected.playerName} is winning the process battle on contact quality and swing quality.`
            : null,
          selected.matchupScore > obviousStar.matchupScore + 0.03
            ? `${obviousStar.playerName} draws the worse handedness or pitch-shape fit in this matchup.`
            : null,
          selected.valueScore > obviousStar.valueScore + 0.03
            ? `${obviousStar.playerName} grades as the pricier name-value play, while ${selected.playerName} shows the better edge.`
            : null,
        ]).slice(0, 3)
      : selectedAnalyst
          ? [
              `${selected.playerName} is the obvious star, but the model still kept him on top because the process, matchup, and projected edge all checked out.`,
            ]
          : [];
  const risks = uniqueStrings([
    ...selectedAnalyst.topReasonsAgainst,
    ...selectedAnalyst.dataQuality.warnings,
    selectedAnalyst.dataQuality.missingFields.includes("confirmed_lineup")
      ? "Lineup is not fully confirmed, so plate-appearance certainty is lower."
      : null,
  ]).slice(0, 4);
  const narrative = buildAnalystNarrative({
    selected,
    obviousStar,
    alternatives: topAlternatives,
    risks,
  });

  return {
    selectedPlayerId: selected.playerId,
    selectedHitter: selected.playerName,
    team: selected.teamName ?? selected.teamAbbreviation ?? "Unknown Team",
    opponent:
      selectedFull.analysis.game.homeTeam.abbreviation === selected.teamAbbreviation
        ? selectedFull.analysis.game.awayTeam.abbreviation
        : selectedFull.analysis.game.homeTeam.abbreviation,
    finalScore: selected.finalScore,
    hitProbability: selected.hitProbability,
    confidence: selected.confidence,
    recommendation: selected.recommendation,
    obviousStarPlayer: obviousStar?.playerName ?? null,
    whyHeStandsOut,
    whyNotTheStarPlayer,
    risks,
    shortExplanation:
      whyHeStandsOut[0] ??
      `${selected.playerName} brings the strongest overall hit-prop profile in this game.`,
    topAlternatives,
    comparisonTable,
    analystNarrative: narrative,
    dataWarnings: uniqueStrings([
      selectedAnalyst.dataQuality.missingFields.includes("odds")
        ? "Player-specific sportsbook prices were not available, so value uses an internal name-value proxy instead of live prop prices."
        : null,
      "Public popularity / ownership data was not available; the engine used an internal star-power proxy based on role and season production.",
    ]),
  };
}
