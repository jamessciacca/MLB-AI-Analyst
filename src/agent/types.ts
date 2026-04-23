import { type ProcessOutcomeFeedbackResult } from "../outcomes/types.ts";

export type MemoryCategory =
  | "preference"
  | "instruction"
  | "project_fact"
  | "betting_style"
  | "prediction_feedback"
  | "workflow_note"
  | "explanation_preference";

export type ChatRole = "system" | "user" | "assistant";

export type FeedbackType =
  | "positive"
  | "negative"
  | "neutral"
  | "too_risky"
  | "preference"
  | "instruction";

export type ActualOutcome =
  | "hit"
  | "no_hit"
  | "home_run"
  | "no_home_run"
  | "win"
  | "loss"
  | "unknown";

export type PredictionMarket = "hit" | "home_run" | "game_win" | "unknown";

export type ChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: number;
  sessionId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
};

export type MemoryItemInput = {
  category: MemoryCategory;
  content: string;
  tags?: string[];
  importanceScore?: number;
  source?: string;
};

export type MemoryItem = Required<MemoryItemInput> & {
  id: number;
  createdAt: string;
  lastUsedAt: string | null;
};

export type UserPreference = {
  id: number;
  key: string;
  value: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
};

export type PredictionRecord = {
  id: number;
  predictionId: string;
  playerName: string | null;
  marketType: PredictionMarket;
  predictedProbability: number | null;
  predictionSummary: string;
  createdAt: string;
};

export type PredictionFeedback = {
  id: number;
  predictionId: string | null;
  feedbackType: FeedbackType;
  userMessage: string;
  actualOutcome: ActualOutcome;
  wasPredictionCorrect: boolean | null;
  createdAt: string;
};

export type ParsedFeedback = {
  isFeedback: boolean;
  feedbackType: FeedbackType;
  actualOutcome: ActualOutcome;
  wasPredictionCorrect: boolean | null;
  referencedPlayerName: string | null;
  referencedMarket: PredictionMarket;
  note: string;
  shouldCreateMemory: boolean;
};

export type AgentPrediction = {
  predictionId: string;
  playerName: string | null;
  marketType: PredictionMarket;
  predictedProbability: number | null;
  predictionSummary: string;
  createdAt: string;
};

export type PromptContext = {
  session: ChatSession;
  recentMessages: ChatMessage[];
  memories: MemoryItem[];
  preferences: UserPreference[];
  predictions: AgentPrediction[];
  relatedFeedback: PredictionFeedback[];
};

export type ChatAgentResponse = {
  sessionId: string;
  response: string;
  memoriesSaved: MemoryItem[];
  feedbackSaved: PredictionFeedback | null;
  matchedPrediction: AgentPrediction | null;
  outcomeFeedback?: ProcessOutcomeFeedbackResult | null;
};
