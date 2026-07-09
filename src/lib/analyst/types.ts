import {
  type AnalysisMarket,
  type ConfidenceLevel,
} from "../types.ts";
import { type ManualOddsAnalysis } from "../odds-math.ts";

export type AnalystMarket = AnalysisMarket | "total_bases" | "rbi" | "runs";
export type AnalystLean = "strong" | "moderate" | "risky" | "avoid";

export interface AnalystWeights {
  modelProbability: number;
  batterContext: number;
  pitcherMatchup: number;
  teamOffense: number;
  gameEnvironment: number;
  marketContext: number;
  feedbackCalibration: number;
}

export interface AnalystBallparkContext {
  venueName: string;
  hitFactor: number;
  homeRunFactor: number;
  leftyHomeRunFactor: number;
  rightyHomeRunFactor: number;
  altitudeFeet: number | null;
  notes: string[];
  source: "hardcoded" | "derived";
}

export interface AnalystWeatherContext {
  forecastTime: string | null;
  temperatureF: number | null;
  apparentTemperatureF: number | null;
  humidity: number | null;
  precipitationProbability: number | null;
  windSpeedMph: number | null;
  windDirectionDegrees: number | null;
  windImpact: "blowing_out" | "blowing_in" | "crosswind" | "neutral" | "unknown";
  windSummary: string;
  airDensityScore: number | null;
  source: "open-meteo" | "existing" | "unavailable";
}

export interface AnalystOddsContext {
  source: "the-odds-api" | "espn-fallback" | "unavailable";
  eventId?: string | null;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  homeImpliedProbability: number | null;
  awayImpliedProbability: number | null;
  noVigHomeProbability: number | null;
  noVigAwayProbability: number | null;
  totalRuns: number | null;
  runLine: number | null;
  bestBook?: string | null;
  bookmaker: string | null;
  lastUpdate?: string | null;
}

export type AnalystValueRating =
  | "positive value"
  | "neutral"
  | "overpriced"
  | "no odds available";

export interface AnalystPlayerPropOdds {
  eventId: string;
  playerName: string;
  market: "batter_hits" | "batter_home_runs";
  line: number | null;
  overOdds: number | null;
  underOdds: number | null;
  overImpliedProbability: number | null;
  underImpliedProbability: number | null;
  noVigOverProbability: number | null;
  noVigUnderProbability: number | null;
  bestBook: string | null;
  bookmaker: string | null;
  lastUpdate: string | null;
}

export interface AnalystRollingMetrics {
  sampleSize: number;
  plateAppearances: number;
  atBats: number;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  xba: number | null;
  xslg: number | null;
  woba: number | null;
  xwoba: number | null;
  hardHitRate: number | null;
  barrelRate: number | null;
  strikeoutRate: number | null;
  walkRate: number | null;
  contactRate: number | null;
  whiffRate: number | null;
  chaseRate: number | null;
  averageExitVelocity: number | null;
  averageLaunchAngle: number | null;
}

export interface AnalystStatcastContext {
  batter: {
    season: AnalystRollingMetrics;
    last7: AnalystRollingMetrics;
    last14: AnalystRollingMetrics;
    last30: AnalystRollingMetrics;
    vsHandedness: AnalystRollingMetrics;
    home: AnalystRollingMetrics | null;
    away: AnalystRollingMetrics | null;
  };
  pitcher: {
    season: AnalystRollingMetrics;
    last14: AnalystRollingMetrics;
    last30: AnalystRollingMetrics;
    vsHandedness: AnalystRollingMetrics;
  };
  warnings: string[];
}

export interface AnalystGameScriptContext {
  teamWinProbability: number;
  impliedRuns: number;
  opponentImpliedRuns: number;
  gameTotal: number | null;
  blowoutRisk: number;
  likelyWinningTeam: string | null;
  oneSidedRisk: boolean;
  summary: string;
  explanation: string;
}

export interface AnalystSupportingMarketEstimate {
  market: Exclude<AnalystMarket, "hit">;
  predictedProbability: number;
  lean: AnalystLean;
  summary: string;
}

export interface AnalystDataQuality {
  confidence: ConfidenceLevel;
  sourcesUsed: string[];
  missingFields: string[];
  warnings: string[];
}

export interface AnalystLast10GameEntry {
  gamePk: number | null;
  date: string;
  opponent: string | null;
  pitcherFacedList: string[];
  battingOrderSpot: number | null;
  atBats: number;
  hits: number;
  walks: number;
  strikeouts: number;
  ballsInPlay: number;
  hardHitBalls: number;
  barrels: number;
  lineDrives: number;
  groundBalls: number;
  flyBalls: number;
  popups: number;
  expectedHits: number;
  xbaAverage: number | null;
  averageExitVelocity: number | null;
  maxExitVelocity: number | null;
  contactRate: number | null;
  whiffRate: number | null;
  chaseRate: number | null;
  qualityOfContactScore: number;
  atBatQualityScore: number;
  unluckyOuts: number;
  badOuts: number;
  notes: string[];
}

export interface AnalystLast10Summary {
  gamesAnalyzed: number;
  averageHitsPerGame: number | null;
  hitGames: number;
  hitlessGames: number;
  hardHitRate: number | null;
  expectedHitsPerGame: number | null;
  qualityTrend: "rising" | "steady" | "falling";
  summary: string;
  games: AnalystLast10GameEntry[];
}

export interface AnalystAtBatQualitySummary {
  last3: number | null;
  last5: number | null;
  last10: number | null;
  trend: "rising" | "steady" | "falling";
  summary: string;
}

export interface AnalystPatternDetection {
  patternLabel:
    | "bounce_back_candidate"
    | "fake_hot_streak"
    | "real_hot_streak"
    | "cold_but_improving"
    | "avoid"
    | "consistent_contact"
    | "boom_bust"
    | "steady_profile";
  patternScore: number;
  confidence: ConfidenceLevel;
  explanation: string;
  supportingGames: string[];
}

export interface AnalystSimulationSummary {
  simulations: number;
  seed: number;
  projectedPlateAppearances: number;
  simulatedHitProbability: number;
  noHitProbability: number;
  averageSimulatedHits: number;
  confidenceInterval: [number, number];
  mostImportantFactors: string[];
  summary: string;
}

export interface AnalystHitProjectionBreakdown {
  seasonBaseline: number;
  last10Results: number;
  last10AtBatQuality: number;
  recentTrendLast5: number;
  pitcherMatchup: number;
  simulationResult: number;
  environment: number;
  feedbackCalibration: number;
}

export interface AnalystPredictionResult {
  playerName: string;
  playerId: number;
  gamePk: number;
  market: AnalystMarket;
  marketLabel: string;
  predictedProbability: number;
  confidence: ConfidenceLevel;
  recommendation: AnalystLean;
  fairOdds: number | null;
  sportsbookOdds: number | null;
  sportsbookImpliedProbability: number | null;
  noVigMarketProbability: number | null;
  valueRating: AnalystValueRating;
  sportsbookOddsIfAvailable: number | null;
  edgeIfAvailable: number | null;
  expectedValuePercent: number | null;
  summary: string;
  topReasonsFor: string[];
  topReasonsAgainst: string[];
  gameScript: AnalystGameScriptContext;
  matchup: {
    pitcher: string;
    pitcherHand: string | null;
    batterVsHand: string;
    pitchMixNotes: string[];
    batterVsPitcherHistory: string;
  };
  environment: {
    ballpark: AnalystBallparkContext;
    weather: AnalystWeatherContext | null;
    windImpact: string;
    summary: string;
  };
  vegas: AnalystOddsContext | null;
  playerPropOdds: AnalystPlayerPropOdds | null;
  manualOdds: ManualOddsAnalysis | null;
  dataQuality: AnalystDataQuality;
  last10Summary: AnalystLast10Summary | null;
  atBatQualitySummary: AnalystAtBatQualitySummary | null;
  detectedPattern: AnalystPatternDetection | null;
  simulationSummary: AnalystSimulationSummary | null;
  supportingMarkets: AnalystSupportingMarketEstimate[];
  components: {
    modelProbability: number;
    batterContextScore: number;
    pitcherMatchupScore: number;
    teamOffenseScore: number;
    gameEnvironmentScore: number;
    marketProbability: number;
    feedbackCalibrationScore: number;
    appliedFeedbackAdjustment: number;
    weights: AnalystWeights;
    hitProjectionBreakdown?: AnalystHitProjectionBreakdown | null;
  };
}
