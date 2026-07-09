import { type OutcomeFeedbackEntry, type PredictionEntry } from "../feedback.ts";

export interface ProbabilityEvaluationSummary {
  sampleSize: number;
  accuracy: number | null;
  brierScore: number | null;
  averagePrediction: number | null;
  observedRate: number | null;
  calibrationBias: number | null;
  recentRecord: {
    wins: number;
    losses: number;
  };
}

function expectedOutcome(entry: OutcomeFeedbackEntry) {
  if (entry.market === "home_run") {
    return entry.actualHomeRuns > 0 ? 1 : 0;
  }
  if (entry.market === "hit_2_plus") {
    return entry.actualHits >= 2 ? 1 : 0;
  }

  return entry.actualHits > 0 ? 1 : 0;
}

export function evaluateResolvedPredictions(input: {
  predictions: PredictionEntry[];
  outcomes: OutcomeFeedbackEntry[];
}): ProbabilityEvaluationSummary {
  const predictionById = new Map(input.predictions.map((prediction) => [prediction.analysisId, prediction]));
  const resolved = input.outcomes
    .map((outcome) => {
      const prediction = predictionById.get(outcome.analysisId);
      return prediction ? { prediction, outcome, actual: expectedOutcome(outcome) } : null;
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  if (resolved.length === 0) {
    return {
      sampleSize: 0,
      accuracy: null,
      brierScore: null,
      averagePrediction: null,
      observedRate: null,
      calibrationBias: null,
      recentRecord: { wins: 0, losses: 0 },
    };
  }

  const correct = resolved.filter((entry) => entry.outcome.outcomeSuccess).length;
  const brier =
    resolved.reduce(
      (total, entry) => total + (entry.prediction.probability - entry.actual) ** 2,
      0,
    ) / resolved.length;
  const averagePrediction =
    resolved.reduce((total, entry) => total + entry.prediction.probability, 0) /
    resolved.length;
  const observedRate =
    resolved.reduce((total, entry) => total + entry.actual, 0) / resolved.length;
  const recent = resolved.slice(-20);

  return {
    sampleSize: resolved.length,
    accuracy: correct / resolved.length,
    brierScore: brier,
    averagePrediction,
    observedRate,
    calibrationBias: averagePrediction - observedRate,
    recentRecord: {
      wins: recent.filter((entry) => entry.outcome.outcomeSuccess).length,
      losses: recent.filter((entry) => !entry.outcome.outcomeSuccess).length,
    },
  };
}
