export type ImpactLabel = "positive" | "negative" | "neutral";
export type ConfidenceLevel = "low" | "medium" | "high";
export type Recommendation = "good play" | "neutral" | "avoid";
export type AnalysisMarket = "hit" | "home_run";

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
  homeProbablePitcher: {
    id: number;
    fullName: string;
  } | null;
  awayProbablePitcher: {
    id: number;
    fullName: string;
  } | null;
}

export interface HittingStatLine {
  gamesPlayed: number | null;
  atBats: number | null;
  hits: number | null;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  homeRuns: number | null;
  plateAppearances: number | null;
  strikeOuts: number | null;
  baseOnBalls: number | null;
  babip: number | null;
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
}
