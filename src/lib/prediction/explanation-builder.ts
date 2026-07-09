import { type ManualOddsAnalysis } from "../odds-math.ts";
import { type AnalysisResult } from "../types.ts";
import { formatPercent } from "../utils.ts";

export interface PredictionExplanation {
  finalProbability: number;
  confidenceLabel: AnalysisResult["confidence"];
  topPositiveFactors: string[];
  topNegativeFactors: string[];
  vegasComparison: string | null;
  whyThisPick: string;
  whyNotJustTheStar: string;
  missingData: string[];
  safetyNote: string;
}

function factorText(factor: AnalysisResult["factors"][number]) {
  return `${factor.label}: ${factor.detail || factor.value}`;
}

function missingDataFor(result: AnalysisResult) {
  const missing: string[] = [];

  if (!result.hitter.season) missing.push("current hitter season stats");
  if (!result.hitter.expected) missing.push("hitter expected Statcast stats");
  if (!result.pitcher.player) missing.push("probable pitcher");
  if (!result.pitcher.season) missing.push("pitcher season stats");
  if (!result.pitcher.expected) missing.push("pitcher expected Statcast stats");
  if (result.pitcher.pitchMix.length === 0) missing.push("pitch mix");
  if (!result.weather) missing.push("weather");
  if (!result.defense) missing.push("opposing defense");
  if (!result.hitGameContext?.enabled && (result.market === "hit" || result.market === "hit_2_plus")) {
    missing.push("team win probability / implied run context");
  }

  return missing;
}

function buildVegasComparison(result: AnalysisResult, manualOdds: ManualOddsAnalysis | null) {
  if (!manualOdds) {
    return null;
  }

  const edge = result.probabilities.atLeastOne - manualOdds.impliedProbability;
  const direction =
    edge >= 0.03
      ? "disagrees positively with Vegas"
      : edge <= -0.03
        ? "is more cautious than Vegas"
        : "roughly agrees with Vegas";

  return `Model ${formatPercent(result.probabilities.atLeastOne, 1)} vs ${manualOdds.sportsbook ?? "sportsbook"} implied ${formatPercent(manualOdds.impliedProbability, 1)}; the model ${direction} with a ${edge >= 0 ? "+" : ""}${formatPercent(edge, 1)} edge.`;
}

export function buildPredictionExplanation(input: {
  result: AnalysisResult;
  manualOdds?: ManualOddsAnalysis | null;
  starContext?: string | null;
}): PredictionExplanation {
  const positive = input.result.factors
    .filter((factor) => factor.impact === "positive")
    .slice(0, 4)
    .map(factorText);
  const negative = input.result.factors
    .filter((factor) => factor.impact === "negative")
    .slice(0, 4)
    .map(factorText);
  const pitcher = input.result.pitcher.player?.fullName ?? "the listed opposing starter";
  const lineup =
    input.result.hitter.lineupSlot !== null
      ? `lineup slot ${input.result.hitter.lineupSlot}`
      : "an unconfirmed lineup slot";
  const whyThisPick = `${input.result.hitter.player.fullName} grades at ${formatPercent(input.result.probabilities.atLeastOne, 1)} for ${input.result.marketLabel.toLowerCase()} because the model blends recent form, season skill, ${lineup}, the matchup with ${pitcher}, environment, and team context.`;

  return {
    finalProbability: input.result.probabilities.atLeastOne,
    confidenceLabel: input.result.confidence,
    topPositiveFactors: positive.length > 0 ? positive : ["No major positive factor exceeded the model threshold."],
    topNegativeFactors: negative.length > 0 ? negative : ["No major negative factor exceeded the model threshold."],
    vegasComparison: buildVegasComparison(input.result, input.manualOdds ?? null),
    whyThisPick,
    whyNotJustTheStar:
      input.starContext ??
      "The ranking is context-first: it compares opportunity, recent process, pitcher fit, lineup volume, environment, and price instead of defaulting to the most famous hitter.",
    missingData: missingDataFor(input.result),
    safetyNote:
      "This is a probability estimate, not a lock or guarantee. Use it as one input alongside bankroll discipline and market price.",
  };
}
