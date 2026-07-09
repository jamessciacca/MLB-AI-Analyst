import { type AnalysisResult, type GameSummary, type HitterSelectionResult } from "../types.ts";
import { type FeedbackCalibration } from "../feedback.ts";
import { type ManualOddsAnalysis } from "../odds-math.ts";

import { type AnalystPredictionResult } from "./types.ts";

export interface DailyTopHitPick {
  rank: number;
  playerId: number;
  playerName: string;
  team: string | null;
  opponent: string;
  gamePk: number;
  gameLabel: string;
  venueName: string;
  lineupSlot: number | null;
  hitProbability: number;
  fairOdds: number | null;
  edgeIfAvailable: number | null;
  confidence: AnalysisResult["confidence"];
  recommendation: AnalysisResult["recommendation"];
  dailyScore: number;
  matchupScore: number;
  lineupOpportunityScore: number;
  recentHistoryScore: number;
  previousGameSummary: string;
  matchupSummary: string;
  comparisonSummary: string;
  whyTopFour: string[];
  riskNotes: string[];
}

export interface DailyTopHitPickComparison {
  summary: string;
  differentiators: string[];
  picks: DailyTopHitPick[];
}

export interface PlayerHitAnalysisResponse {
  generatedAt: string;
  game: GameSummary;
  analysis: AnalysisResult;
  analystEngine: AnalystPredictionResult;
  requestResolution: {
    matchedPlayerId: number;
    matchedPlayerName: string;
    matchedGamePk: number;
    warnings: string[];
  };
  manualOdds: ManualOddsAnalysis | null;
  warnings: string[];
  sourcesUsed: string[];
}

export interface GameHitBoardEntry {
  game: GameSummary;
  available: boolean;
  topPick: AnalysisResult | null;
  selectedAnalyst: AnalystPredictionResult | null;
  selection: HitterSelectionResult | null;
  players: Array<{
    playerId: number;
    playerName: string;
    team: string | null;
    lineupSlot: number | null;
    hitProbability: number;
    confidence: AnalysisResult["confidence"];
    recommendation: AnalysisResult["recommendation"];
  }>;
  skippedPlayers: string[];
  warnings: string[];
}

export interface BestHittersBoardResponse {
  officialDate: string;
  generatedAt: string;
  market: "hit";
  games: GameHitBoardEntry[];
  dailyTopPicks: DailyTopHitPick[];
  dailyTopPicksComparison: DailyTopHitPickComparison | null;
  warnings: string[];
  sourcesUsed: string[];
}

export interface ModelPerformanceSummaryResponse {
  generatedAt: string;
  feedbackCalibration: {
    totalEntries: number;
    savedPredictions: number;
    manualEntries: number;
    autoOutcomeEntries: number;
    markets: {
      hit: FeedbackCalibration;
      hit_2_plus: FeedbackCalibration;
      home_run: FeedbackCalibration;
    };
  };
  artifactCalibration: Record<string, unknown> | null;
  trainingSummary: Record<string, unknown> | null;
  notes: string[];
}
