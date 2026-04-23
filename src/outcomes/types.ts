import { type PredictionMarket } from "../agent/types.ts";

export type PredictionStatus = "pending" | "resolved" | "void";

export type OutcomeFeedbackType =
  | "correct"
  | "incorrect"
  | "partial"
  | "too_risky"
  | "good_reasoning"
  | "bad_reasoning"
  | "outcome_only";

export type FeedbackSource = "user_chat" | "ui_button" | "system_import";

export type ResolutionMethod = "user_message" | "stats_api" | "manual_override";

export type OutcomePredictionRecord = {
  id?: number;
  predictionId: string;
  createdAt: string;
  updatedAt: string;
  gameDate: string | null;
  gameId: number | null;
  team: string | null;
  opponent: string | null;
  playerName: string | null;
  playerId: number | null;
  marketType: PredictionMarket | "rbi" | "run" | "total_bases" | "strikeouts" | "team_moneyline";
  marketLine: string | null;
  predictedProbability: number | null;
  modelScore: number | null;
  impliedProbability: number | null;
  reasoningSummary: string;
  reasoningFeaturesJson: string;
  status: PredictionStatus;
  sourceContextJson: string;
};

export type ParsedOutcomeFeedback = {
  kind: "prediction_feedback" | "not_feedback";
  playerName: string | null;
  marketType: OutcomePredictionRecord["marketType"] | "unknown";
  actualOutcome: boolean | null;
  actualValue: number | null;
  feedbackType: OutcomeFeedbackType;
  sentiment: "positive" | "negative" | "neutral";
  confidence: number;
  rawMessage: string;
  referencesRecentPick: boolean;
  reasoningOnly: boolean;
  notes: string[];
};

export type PredictionMatch = {
  prediction: OutcomePredictionRecord | null;
  confidence: number;
  reasons: string[];
  alternatives: OutcomePredictionRecord[];
};

export type OutcomeResolution = {
  predictionId: string;
  actualOutcome: boolean | null;
  actualValue: number | null;
  wasPredictionCorrect: boolean | null;
  resolutionMethod: ResolutionMethod;
  resolutionConfidence: number;
  rawResolutionContextJson: string;
};

export type LoggedOutcomeFeedback = {
  feedbackId: number | null;
  resolutionId: number | null;
  calibrationUpdated: boolean;
  trainingRowCreated: boolean;
};

export type ProcessOutcomeFeedbackResult = {
  parsed: ParsedOutcomeFeedback;
  match: PredictionMatch;
  resolution: OutcomeResolution | null;
  logged: LoggedOutcomeFeedback;
  message: string;
};

export type TrainingFeedbackRow = {
  predictionId: string;
  playerName: string | null;
  gameDate: string | null;
  gameId: number | null;
  marketType: string;
  marketLine: string | null;
  predictedProbability: number | null;
  impliedProbability: number | null;
  reasoningFeaturesJson: string;
  actualOutcome: boolean | null;
  actualValue: number | null;
  wasPredictionCorrect: boolean | null;
  createdAt: string;
};
