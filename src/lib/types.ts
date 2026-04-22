import { type ExternalContext } from "@/lib/providers/provider-types";

export type ImpactLabel = "positive" | "negative" | "neutral";
export type ConfidenceLevel = "low" | "medium" | "high";
export type Recommendation = "good play" | "neutral" | "avoid";
export type AnalysisMarket = "hit" | "home_run";
export type WeatherCondition = "sunny" | "cloudy" | "rainy" | "unknown";
export type LineupStatus = "released" | "partial" | "pending";

export interface TeamDirectoryEntry {
  id: number;
  name: string;
  abbreviation: string;
}

export interface PlayerSearchResult {
  id: number;
  fullName: string;
  firstName: string;
  lastName: string;
  currentAge: number | null;
  active: boolean;
  currentTeamId: number | null;
  currentTeamName: string | null;
  currentTeamAbbreviation: string | null;
  primaryPosition: string | null;
  batSide: string | null;
  pitchHand: string | null;
}

export interface TeamGameInfo {
  id: number;
  name: string;
  abbreviation: string;
}

export interface GameSummary {
  gamePk: number;
  officialDate: string;
  gameDate: string;
  status: string;
  dayNight: string | null;
  venue: {
    id: number;
    name: string;
  };
  homeTeam: TeamGameInfo;
  awayTeam: TeamGameInfo;
  homeScore: number | null;
  awayScore: number | null;
  homeProbablePitcher: {
    id: number;
    fullName: string;
    pitchHand: string | null;
  } | null;
  awayProbablePitcher: {
    id: number;
    fullName: string;
    pitchHand: string | null;
  } | null;
  lineupStatus?: {
    status: LineupStatus;
    homeCount: number;
    awayCount: number;
    totalCount: number;
    homePlayers: LineupCardPlayer[];
    awayPlayers: LineupCardPlayer[];
  };
  weather?: WeatherSnapshot | null;
}

export interface LineupCardPlayer {
  id: number;
  fullName: string;
  lineupSlot: number | null;
  primaryPosition: string | null;
  batSide: string | null;
}

export interface HittingStatLine {
  gamesPlayed: number | null;
  atBats: number | null;
  runs?: number | null;
  hits: number | null;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  homeRuns: number | null;
  doubles?: number | null;
  triples?: number | null;
  plateAppearances: number | null;
  strikeOuts: number | null;
  baseOnBalls: number | null;
  babip: number | null;
}

export interface BatterRecentGameLine {
  gamePk: number | null;
  date: string;
  opponent: string | null;
  atBats: number;
  runs: number;
  hits: number;
  rbi: number;
  homeRuns: number;
}

export interface PitchingStatLine {
  gamesPlayed: number | null;
  inningsPitched: number | null;
  era: number | null;
  avg: number | null;
  whip: number | null;
  strikeOuts: number | null;
  baseOnBalls: number | null;
  hits: number | null;
  homeRuns?: number | null;
  runs?: number | null;
  earnedRuns?: number | null;
  battersFaced: number | null;
}

export interface FieldingStatLine {
  gamesPlayed: number | null;
  assists: number | null;
  putOuts: number | null;
  errors: number | null;
  chances: number | null;
  fielding: number | null;
}

export interface ExpectedStatsLine {
  playerId: number;
  playerName: string;
  plateAppearances: number | null;
  ballsInPlay: number | null;
  battingAverage: number | null;
  expectedBattingAverage: number | null;
  slugging: number | null;
  expectedSlugging: number | null;
  woba: number | null;
  expectedWoba: number | null;
  era: number | null;
  expectedEra: number | null;
}

export interface SprintSpeedLine {
  playerId: number;
  sprintSpeed: number | null;
  competitiveRuns: number | null;
  homeToFirst: number | null;
}

export interface PitchMixEntry {
  code: string;
  label: string;
  usage: number;
}

export interface StatcastEventRow {
  gameDate: string;
  batterId: number | null;
  pitcherId: number | null;
  pitchType: string | null;
  pitchName: string | null;
  playerName: string | null;
  events: string | null;
  description: string | null;
  batterStand: string | null;
  pitcherThrows: string | null;
  launchSpeed: number | null;
  launchAngle: number | null;
  estimatedBattingAverage: number | null;
  estimatedWoba: number | null;
  gameType: string | null;
}

export interface TeamDefenseSnapshot {
  teamName: string;
  fieldingPct: number | null;
  errors: number | null;
  chances: number | null;
  oaa: number | null;
  fieldingRunsPrevented: number | null;
  armOverall: number | null;
}

export interface VenueSnapshot {
  venueId: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
  elevationFeet: number | null;
  azimuthAngle: number | null;
  roofType: string | null;
  turfType: string | null;
  dimensions: {
    leftLine: number | null;
    left: number | null;
    leftCenter: number | null;
    center: number | null;
    rightCenter: number | null;
    rightLine: number | null;
  };
}

export interface WeatherSnapshot {
  forecastTime: string;
  condition: WeatherCondition;
  cloudCover: number | null;
  temperatureF: number | null;
  apparentTemperatureF: number | null;
  precipitationProbability: number | null;
  windSpeedMph: number | null;
  humidity: number | null;
}

export interface AnalysisFactor {
  label: string;
  value: string;
  impact: ImpactLabel;
  detail: string;
}

export interface AnalysisDiagnostics {
  hitterSampleSize: number;
  hitterRecentSampleSize: number;
  pitcherSampleSize: number;
  pitchMixCoverage: number;
}

export interface AnalysisResult {
  analysisId: string;
  generatedAt: string;
  modelVersion: string;
  market: AnalysisMarket;
  marketLabel: string;
  recommendation: Recommendation;
  confidence: ConfidenceLevel;
  probabilities: {
    perAtBat: number;
    atLeastOne: number;
    atLeastTwo: number | null;
    expectedHits: number | null;
    expectedAtBats: number;
  };
  hitter: {
    player: PlayerSearchResult;
    season: HittingStatLine | null;
    priorSeason: HittingStatLine | null;
    expected: ExpectedStatsLine | null;
    priorExpected: ExpectedStatsLine | null;
    sprint: SprintSpeedLine | null;
    lineupSlot: number | null;
    recentGames: BatterRecentGameLine[];
  };
  pitcher: {
    player: PlayerSearchResult | null;
    season: PitchingStatLine | null;
    priorSeason: PitchingStatLine | null;
    expected: ExpectedStatsLine | null;
    priorExpected: ExpectedStatsLine | null;
    pitchMix: PitchMixEntry[];
    probable: boolean;
  };
  game: GameSummary;
  venue: VenueSnapshot | null;
  weather: WeatherSnapshot | null;
  defense: TeamDefenseSnapshot | null;
  factors: AnalysisFactor[];
  notes: string[];
  diagnostics: AnalysisDiagnostics;
  summary: string;
  aiSummary: string | null;
  previousModelResult?: PreviousModelResult | null;
  batterVsPitcher: BatterVsPitcherSummary | null;
  externalContext?: ExternalContext | null;
}

export interface BatterVsPitcherSummary {
  batterId: number;
  pitcherId: number;
  pitcherName: string;
  plateAppearances: number;
  atBats: number;
  hits: number;
  homeRuns: number;
  strikeouts: number;
  walks: number;
  battingAverage: number | null;
  lastFacedDate: string | null;
  summary: string;
}

export interface PreviousModelResult {
  date: string;
  market: AnalysisMarket;
  marketLabel: string;
  game: GameSummary | null;
  probability: number | null;
  recommendation: Recommendation | null;
  rating: "correct" | "too_high" | "too_low" | "pending" | "no_game" | "no_boxscore";
  actualHits: number | null;
  actualHomeRuns: number | null;
  actualAtBats: number | null;
  outcomeSuccess: boolean | null;
  message: string;
}

export interface StartingLineupPlayer {
  player: PlayerSearchResult;
  team: TeamGameInfo;
  lineupSlot: number | null;
}

export interface LineupComparisonResult {
  generatedAt: string;
  market: AnalysisMarket;
  marketLabel: string;
  game: GameSummary;
  topPick: AnalysisResult | null;
  players: AnalysisResult[];
  skippedPlayers: string[];
}

export interface AnalysisModelInput {
  hitter: {
    player: PlayerSearchResult;
    season: HittingStatLine | null;
    priorSeason: HittingStatLine | null;
    expected: ExpectedStatsLine | null;
    priorExpected: ExpectedStatsLine | null;
    sprint: SprintSpeedLine | null;
    lineupSlot: number | null;
    events: StatcastEventRow[];
    recentGames: BatterRecentGameLine[];
  };
  pitcher: {
    player: PlayerSearchResult | null;
    season: PitchingStatLine | null;
    priorSeason: PitchingStatLine | null;
    expected: ExpectedStatsLine | null;
    priorExpected: ExpectedStatsLine | null;
    pitchMix: PitchMixEntry[];
    events: StatcastEventRow[];
    probable: boolean;
  };
  game: GameSummary;
  venue: VenueSnapshot | null;
  weather: WeatherSnapshot | null;
  defense: TeamDefenseSnapshot | null;
  externalContext?: ExternalContext | null;
  gameWinContext?: {
    hitterTeamWinProbability: number;
    opponentWinProbability: number;
    predictedWinnerTeamId: number;
    confidence: GameWinConfidence;
    modelVersion: string;
  } | null;
}

export type GameWinConfidence = "low" | "medium" | "high";
export type GameWinFactorEdge = "home" | "away" | "neutral";

export interface GameWinFactor {
  factor: string;
  edge: GameWinFactorEdge;
  impact: number;
  detail: string;
}

export interface GameWinFeatureVector {
  home_starter_quality: number;
  away_starter_quality: number;
  starter_quality_diff: number;
  starter_workload_diff: number;
  home_starter_missing: number;
  away_starter_missing: number;
  offense_ops_diff: number;
  offense_power_diff: number;
  offense_plate_discipline_diff: number;
  lineup_quality_diff: number;
  lineup_confirmed: number;
  bullpen_quality_diff: number;
  bullpen_fatigue_diff: number;
  defense_oaa_diff: number;
  fielding_pct_diff: number;
  recent_win_pct_diff: number;
  recent_run_diff_per_game_diff: number;
  season_win_pct_diff: number;
  rest_days_diff: number;
  home_field: number;
  park_run_factor: number;
  weather_run_environment: number;
  is_day_game: number;
  is_night_game: number;
  is_twilight_start: number;
  first_pitch_minutes_from_sunset: number;
  day_length_minutes: number;
  weather_severity_score: number;
  weather_boost_for_hr: number;
  weather_penalty_for_pitchers: number;
  market_implied_home_win_prob: number;
  market_implied_away_win_prob: number;
  lineup_uncertainty_score: number;
  injury_uncertainty_score: number;
  external_data_completeness_score: number;
  critical_missing_count: number;
}

export interface GameWinTeamSnapshot {
  team: TeamGameInfo;
  probablePitcher: GameSummary["homeProbablePitcher"];
  starter: {
    season: PitchingStatLine | null;
    expected: ExpectedStatsLine | null;
    priorSeason: PitchingStatLine | null;
    priorExpected: ExpectedStatsLine | null;
  };
  offense: HittingStatLine | null;
  pitching: PitchingStatLine | null;
  fielding: FieldingStatLine | null;
  defense: Pick<TeamDefenseSnapshot, "oaa" | "fieldingRunsPrevented" | "armOverall"> | null;
  lineupStatus: LineupStatus;
  lineupPlayers: LineupCardPlayer[];
  recent: {
    games: number;
    wins: number;
    losses: number;
    winPct: number | null;
    runDifferentialPerGame: number | null;
    restDays: number | null;
  };
  bullpen: {
    recentInnings: number | null;
    backToBackRelievers: number | null;
    fatigueScore: number | null;
  };
}

export interface PreviousSeriesGame {
  gamePk: number;
  officialDate: string;
  status: string;
  homeTeam: TeamGameInfo;
  awayTeam: TeamGameInfo;
  homeScore: number | null;
  awayScore: number | null;
  winner: "home" | "away" | null;
}

export interface GameWinPredictionResult {
  predictionId: string;
  generatedAt: string;
  modelVersion: string;
  modelType: "trained" | "fallback";
  methodology: {
    dataSources: string[];
  };
  dataFreshness: {
    generatedAt: string;
    gameStatus: string;
    lineupStatus: LineupStatus;
    weatherForecastTime: string | null;
  };
  game: GameSummary;
  homeTeam: GameWinTeamSnapshot;
  awayTeam: GameWinTeamSnapshot;
  homeWinProbability: number;
  awayWinProbability: number;
  predictedWinner: TeamGameInfo;
  confidence: GameWinConfidence;
  analysisSummary: string;
  summarySections: Array<{
    title: string;
    edge: GameWinFactorEdge;
    stats: Array<{
      label: string;
      away: string;
      home: string;
    }>;
    note: string;
  }>;
  topFactors: GameWinFactor[];
  warnings: string[];
  features: GameWinFeatureVector;
  previousSeriesGames: PreviousSeriesGame[];
  externalContext: ExternalContext | null;
}
