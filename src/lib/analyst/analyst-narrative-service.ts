import {
  type AnalystNarrativeSummary,
  type HitterSelectionComparisonEntry,
} from "../types.ts";

function confidencePhrase(confidence: HitterSelectionComparisonEntry["confidence"]) {
  if (confidence === "high") {
    return "The confidence stays on the stronger side because multiple signals agree.";
  }
  if (confidence === "medium") {
    return "The confidence is solid, but not absolute, because a few variables still need to cooperate.";
  }

  return "The confidence is more cautious because the data picture is incomplete or volatile.";
}

export function buildAnalystNarrative(input: {
  selected: HitterSelectionComparisonEntry;
  obviousStar: HitterSelectionComparisonEntry | null;
  alternatives: HitterSelectionComparisonEntry[];
  risks: string[];
}): AnalystNarrativeSummary {
  const alternativeOne = input.alternatives[0] ?? null;
  const alternativeTwo = input.alternatives[1] ?? null;
  const whyThisPlayer = [
    `${input.selected.playerName} grades as the best value profile because his recent form score is ${input.selected.recentFormScore.toFixed(2)} and his at-bat quality score is ${input.selected.atBatQualityScore.toFixed(2)}.`,
    `The model prefers him because the matchup score (${input.selected.matchupScore.toFixed(2)}) and hit probability (${(input.selected.hitProbability * 100).toFixed(1)}%) both stay strong without the same risk load.`,
    input.selected.underTheRadarScore >= 0.55
      ? "He also gets an under-the-radar boost, meaning the profile looks better than a pure name-value read."
      : "This is still a merit-based pick driven more by matchup and contact quality than reputation.",
  ];
  const whyNotOthers = [
    input.obviousStar && input.obviousStar.playerId !== input.selected.playerId
      ? `${input.obviousStar.playerName} carries the bigger name profile, but his value score and risk score did not hold up as well in this matchup.`
      : input.obviousStar
        ? `${input.obviousStar.playerName} is the obvious star, and the model still chose him because the process metrics backed it up instead of just the name.`
        : null,
    alternativeOne
      ? `${alternativeOne.playerName} stayed in the mix, but the selected hitter offered the cleaner hit-prop case overall.`
      : null,
    alternativeTwo
      ? `${alternativeTwo.playerName} had some appeal too, though the model viewed him as a step behind on either process or risk.`
      : null,
  ].filter((value): value is string => Boolean(value));
  const keyStats = [
    `Final score ${input.selected.finalScore.toFixed(2)}`,
    `Hit probability ${(input.selected.hitProbability * 100).toFixed(1)}%`,
    `Matchup ${input.selected.matchupScore.toFixed(2)}`,
    `At-bat quality ${input.selected.atBatQualityScore.toFixed(2)}`,
  ];
  const riskSummary =
    input.risks.length > 0
      ? input.risks.slice(0, 2).join(" ")
      : "No major extra warning pushed the pick off its base case.";
  const analystParagraph = [
    "This is not just the biggest name in the lineup.",
    `${input.selected.playerName} came out as the strongest hit-prop case because the model liked the full profile: recent process, contact stability, matchup quality, and overall value relative to the rest of the lineup.`,
    input.obviousStar && input.obviousStar.playerId !== input.selected.playerId
      ? `${input.obviousStar.playerName} still carries the louder reputation, but he did not win the safer contact-and-edge comparison for this game.`
      : "The obvious star still ranked highly, but the model only kept him on top because the evidence agreed with the reputation.",
    riskSummary,
  ].join(" ");

  return {
    quickSummary: `${input.selected.playerName} owns the strongest hit-prop case in this game, not just the loudest name.`,
    whyThisPlayer,
    whyNotOthers,
    keyStats,
    riskSummary,
    confidenceExplanation: confidencePhrase(input.selected.confidence),
    analystParagraph,
  };
}
