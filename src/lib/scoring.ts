import {
  type AnalysisDiagnostics,
  type AnalysisFactor,
  type AnalysisMarket,
  type AnalysisModelInput,
  type AnalysisResult,
  type ConfidenceLevel,
  type PitchMixEntry,
  type Recommendation,
  type StatcastEventRow,
} from "@/lib/types";
import { predictHitWithMl } from "@/lib/ml-hit-predictor";
import { average, clamp, formatDecimal, formatPercent, minusDays } from "@/lib/utils";

const LEAGUE_HIT_RATE = 0.245;
const LEAGUE_HOME_RUN_RATE = 0.033;
const LEAGUE_HARD_HIT_RATE = 0.39;
const LEAGUE_BARREL_LIKE_RATE = 0.07;
const LEAGUE_POWER_ISO = 0.17;
const LEAGUE_SPRINT_SPEED = 27.0;
const LEAGUE_STRIKEOUT_RATE = 0.22;
const LEAGUE_TEAM_OBP = 0.318;

const HIT_PROBABILITY_MODEL_CONFIG = {
  version: "v2.0.0",
  leagueHitRate: LEAGUE_HIT_RATE,
  minPerOpportunity: 0.1,
  maxPerOpportunity: 0.45,
  shrinkage: {
    hitterSeasonAtBats: 260,
    expectedStatsPlateAppearances: 220,
    handSplitAtBats: 90,
    pitcherBattersFaced: 300,
    pitcherStatcastAtBats: 130,
    recentAtBats: 28,
  },
  baselineWeights: {
    seasonAverage: 0.32,
    expectedAverage: 0.34,
    obpSkill: 0.09,
    slugSkill: 0.07,
    statcastOutcome: 0.12,
    hardHit: 0.06,
  },
  adjustmentScales: {
    platoon: 0.34,
    pitcherAverage: 0.58,
    pitcherWhip: 0.018,
    pitcherStrikeout: -0.05,
    pitcherHardHit: 0.055,
    bullpenDefenseProxy: 0.75,
    recentForm: 0.1,
    recentConsistency: 0.025,
    teamObp: 0.12,
    homeField: 0.004,
  },
  caps: {
    platoon: 0.03,
    pitcher: 0.055,
    bullpen: 0.018,
    recent: 0.028,
    opportunityTeam: 0.18,
  },
  lineupPlateAppearances: {
    1: 4.72,
    2: 4.63,
    3: 4.54,
    4: 4.45,
    5: 4.34,
    6: 4.22,
    7: 4.1,
    8: 3.98,
    9: 3.86,
  } as Record<number, number>,
};

const MODEL_VERSION = HIT_PROBABILITY_MODEL_CONFIG.version;

const HIT_EVENTS = new Set(["single", "double", "triple", "home_run"]);
const HOME_RUN_EVENTS = new Set(["home_run"]);
const NON_AT_BAT_EVENTS = new Set([
  "walk",
  "intentional_walk",
  "hit_by_pitch",
  "sac_fly",
  "sac_bunt",
  "catcher_interf",
]);

function getMarketLabel(market: AnalysisMarket): string {
  return market === "home_run" ? "Home Run" : "Hit";
}

function finalPlateAppearanceRows(rows: StatcastEventRow[]): StatcastEventRow[] {
  return rows.filter((row) => row.events);
}

function isAtBatEvent(event: string | null): boolean {
  return Boolean(event) && !NON_AT_BAT_EVENTS.has(event ?? "");
}

function summarizeOutcomeRate(
  rows: StatcastEventRow[],
  desiredEvents: Set<string>,
): { rate: number | null; atBats: number } {
  const finalRows = finalPlateAppearanceRows(rows);
  const atBatRows = finalRows.filter((row) => isAtBatEvent(row.events));
  const matchingEvents = atBatRows.filter((row) => desiredEvents.has(row.events ?? "")).length;

  if (atBatRows.length === 0) {
    return { rate: null, atBats: 0 };
  }

  return {
    rate: matchingEvents / atBatRows.length,
    atBats: atBatRows.length,
  };
}

function computeBarrelLikeRate(rows: StatcastEventRow[]): number | null {
  const trackedRows = rows.filter(
    (row) => row.launchSpeed !== null && row.launchAngle !== null,
  );

  if (trackedRows.length === 0) {
    return null;
  }

  const barrelLikeCount = trackedRows.filter((row) => {
    const launchSpeed = row.launchSpeed ?? 0;
    const launchAngle = row.launchAngle ?? 0;

    return launchSpeed >= 98 && launchAngle >= 24 && launchAngle <= 32;
  }).length;

  return barrelLikeCount / trackedRows.length;
}

function summarizeBatterOutcomeForm(
  rows: StatcastEventRow[],
  pitcherHand: string | null,
  officialDate: string,
  desiredEvents: Set<string>,
): {
  overallRate: number | null;
  versusHandRate: number | null;
  recentRate: number | null;
  hardHitRate: number | null;
  barrelLikeRate: number | null;
  sampleSize: number;
  recentSampleSize: number;
} {
  const overall = summarizeOutcomeRate(rows, desiredEvents);
  const versusHandRows = pitcherHand
    ? rows.filter((row) => row.pitcherThrows === pitcherHand)
    : rows;
  const versusHand = summarizeOutcomeRate(versusHandRows, desiredEvents);
  const recentCutoff = minusDays(officialDate, 14);
  const recentRows = rows.filter((row) => row.gameDate >= recentCutoff);
  const recent = summarizeOutcomeRate(recentRows, desiredEvents);
  const trackedRows = rows.filter((row) => row.launchSpeed !== null);

  return {
    overallRate: overall.rate,
    versusHandRate: versusHand.rate,
    recentRate: recent.rate,
    hardHitRate:
      trackedRows.length > 0
        ? trackedRows.filter((row) => (row.launchSpeed ?? 0) >= 95).length /
          trackedRows.length
        : null,
    barrelLikeRate: computeBarrelLikeRate(rows),
    sampleSize: overall.atBats,
    recentSampleSize: recent.atBats,
  };
}

function summarizePitcherOutcomeSuppression(
  rows: StatcastEventRow[],
  batterStand: string | null,
  desiredEvents: Set<string>,
): {
  outcomeRateAllowed: number | null;
  hardHitRateAllowed: number | null;
  barrelLikeRateAllowed: number | null;
  strikeoutRate: number | null;
  sampleSize: number;
} {
  const relevantRows = batterStand
    ? rows.filter((row) => row.batterStand === batterStand)
    : rows;
  const outcomeSummary = summarizeOutcomeRate(relevantRows, desiredEvents);
  const finalRows = finalPlateAppearanceRows(relevantRows);
  const strikeouts = finalRows.filter((row) => row.events === "strikeout").length;
  const trackedRows = relevantRows.filter((row) => row.launchSpeed !== null);

  return {
    outcomeRateAllowed: outcomeSummary.rate,
    hardHitRateAllowed:
      trackedRows.length > 0
        ? trackedRows.filter((row) => (row.launchSpeed ?? 0) >= 95).length /
          trackedRows.length
        : null,
    barrelLikeRateAllowed: computeBarrelLikeRate(relevantRows),
    strikeoutRate: finalRows.length > 0 ? strikeouts / finalRows.length : null,
    sampleSize: outcomeSummary.atBats,
  };
}

function summarizeRecentGameLog(input: AnalysisModelInput["hitter"]["recentGames"]) {
  const atBats = input.reduce((total, game) => total + game.atBats, 0);
  const hits = input.reduce((total, game) => total + game.hits, 0);
  const homeRuns = input.reduce((total, game) => total + game.homeRuns, 0);
  const hitGames = input.filter((game) => game.hits > 0).length;
  const runProduction = input.reduce((total, game) => total + game.runs + game.rbi, 0);

  return {
    atBats,
    hits,
    homeRuns,
    hitGames,
    runProduction,
    hitRate: atBats > 0 ? hits / atBats : null,
    homeRunRate: atBats > 0 ? homeRuns / atBats : null,
  };
}

function computeRecentGameAdjustment(
  recentGames: ReturnType<typeof summarizeRecentGameLog>,
  market: AnalysisMarket,
) {
  if (recentGames.atBats < 8) {
    return 0;
  }

  if (market === "home_run") {
    const rateEdge = ((recentGames.homeRunRate ?? LEAGUE_HOME_RUN_RATE) - LEAGUE_HOME_RUN_RATE) * 0.28;
    const productionEdge = clamp((recentGames.runProduction - 4) * 0.002, -0.006, 0.008);

    return clamp(rateEdge + productionEdge, -0.012, 0.018);
  }

  const hitRateEdge = ((recentGames.hitRate ?? LEAGUE_HIT_RATE) - LEAGUE_HIT_RATE) * 0.12;
  const consistencyEdge = ((recentGames.hitGames / 5) - 0.55) * 0.035;

  return clamp(hitRateEdge + consistencyEdge, -0.028, 0.035);
}

function computePitchMixEdge(
  batterRows: StatcastEventRow[],
  pitchMix: PitchMixEntry[],
  desiredEvents: Set<string>,
  overallRate: number,
  scale: number,
  min: number,
  max: number,
): { adjustment: number; coverage: number } {
  if (pitchMix.length === 0) {
    return { adjustment: 0, coverage: 0 };
  }

  const finalRows = finalPlateAppearanceRows(batterRows);
  let weightedRate = 0;
  let totalUsage = 0;
  let coveredUsage = 0;

  for (const pitch of pitchMix) {
    const pitchRows = finalRows.filter((row) => row.pitchType === pitch.code);
    const summary = summarizeOutcomeRate(pitchRows, desiredEvents);
    const pitchRate = summary.atBats >= 5 ? summary.rate ?? overallRate : overallRate;

    if (summary.atBats >= 5) {
      coveredUsage += pitch.usage;
    }

    weightedRate += pitchRate * pitch.usage;
    totalUsage += pitch.usage;
  }

  if (totalUsage === 0) {
    return { adjustment: 0, coverage: 0 };
  }

  const weightedAverage = weightedRate / totalUsage;

  return {
    adjustment: clamp((weightedAverage - overallRate) * scale, min, max),
    coverage: coveredUsage / totalUsage,
  };
}

function computeParkAdjustment(
  venue: AnalysisModelInput["venue"],
  market: AnalysisMarket,
): number {
  if (!venue) {
    return 0;
  }

  if (market === "hit") {
    const averageDistance =
      average([
        venue.dimensions.leftLine,
        venue.dimensions.leftCenter,
        venue.dimensions.center,
        venue.dimensions.rightCenter,
        venue.dimensions.rightLine,
      ]) ?? 378;

    let adjustment = clamp(((averageDistance - 378) / 120) * 0.018, -0.02, 0.02);

    if (venue.turfType && !venue.turfType.toLowerCase().includes("grass")) {
      adjustment += 0.003;
    }

    return clamp(adjustment, -0.02, 0.02);
  }

  const powerDistance =
    average([
      venue.dimensions.leftLine,
      venue.dimensions.leftCenter,
      venue.dimensions.rightCenter,
      venue.dimensions.rightLine,
    ]) ?? 365;
  const elevationBoost = clamp(((venue.elevationFeet ?? 500) - 500) / 6000, -0.01, 0.01);

  return clamp(((365 - powerDistance) / 55) * 0.02 + elevationBoost, -0.022, 0.024);
}

function computeWeatherAdjustment(
  input: AnalysisModelInput["weather"],
  roofType: string | null,
  market: AnalysisMarket,
): number {
  if (!input || roofType?.toLowerCase().includes("closed")) {
    return 0;
  }

  const temperature = input.apparentTemperatureF ?? input.temperatureF ?? 70;
  const precipitationProbability = input.precipitationProbability ?? 0;
  const wind = input.windSpeedMph ?? 0;

  if (market === "hit") {
    const tempEffect = clamp(((temperature - 70) / 25) * 0.01, -0.012, 0.012);
    const precipEffect =
      precipitationProbability > 25
        ? -clamp(((precipitationProbability - 25) / 60) * 0.012, 0, 0.012)
        : 0;
    const windEffect = wind > 20 ? -0.003 : wind >= 8 && wind <= 14 ? 0.001 : 0;

    return clamp(tempEffect + precipEffect + windEffect, -0.015, 0.015);
  }

  const tempEffect = clamp(((temperature - 72) / 18) * 0.012, -0.015, 0.015);
  const precipEffect =
    precipitationProbability > 20
      ? -clamp(((precipitationProbability - 20) / 60) * 0.01, 0, 0.01)
      : 0;
  const windEffect = wind > 22 ? 0.002 : 0;

  return clamp(tempEffect + precipEffect + windEffect, -0.016, 0.018);
}

function computeDefenseAdjustment(
  defense: AnalysisModelInput["defense"],
  market: AnalysisMarket,
): number {
  if (!defense || market === "home_run") {
    return 0;
  }

  const fieldingPct = defense.fieldingPct ?? 0.985;
  const oaa = defense.oaa ?? 0;
  const arm = defense.armOverall ?? 84;

  const fieldingEffect = clamp((0.985 - fieldingPct) * 0.8, -0.01, 0.01);
  const oaaEffect = clamp((-oaa / 25) * 0.015, -0.018, 0.018);
  const armEffect = clamp(((84 - arm) / 12) * 0.004, -0.004, 0.004);

  return clamp(fieldingEffect + oaaEffect + armEffect, -0.03, 0.03);
}

function impactLabel(value: number): AnalysisFactor["impact"] {
  if (value > 0.003) {
    return "positive";
  }
  if (value < -0.003) {
    return "negative";
  }
  return "neutral";
}

function recommendationForProbability(
  probability: number,
  market: AnalysisMarket,
): Recommendation {
  if (market === "hit") {
    if (probability >= 0.64) {
      return "good play";
    }
    if (probability >= 0.5) {
      return "neutral";
    }
    return "avoid";
  }

  if (probability >= 0.26) {
    return "good play";
  }
  if (probability >= 0.15) {
    return "neutral";
  }
  return "avoid";
}

function confidenceForInput(
  probablePitcher: boolean,
  diagnostics: AnalysisDiagnostics,
  hasWeather: boolean,
  hasDefense: boolean,
): ConfidenceLevel {
  let score = 0;

  if (probablePitcher) {
    score += 2;
  }
  if (diagnostics.hitterSampleSize >= 35) {
    score += 1;
  }
  if (diagnostics.pitcherSampleSize >= 35) {
    score += 1;
  }
  if (diagnostics.hitterRecentSampleSize >= 10) {
    score += 1;
  }
  if (hasWeather) {
    score += 1;
  }
  if (hasDefense) {
    score += 1;
  }

  if (score >= 5) {
    return "high";
  }
  if (score >= 3) {
    return "medium";
  }
  return "low";
}

function safeRate(numerator: number | null | undefined, denominator: number | null | undefined) {
  if (
    numerator === null ||
    numerator === undefined ||
    denominator === null ||
    denominator === undefined ||
    denominator <= 0
  ) {
    return null;
  }

  return numerator / denominator;
}

function shrinkRate(
  observed: number | null | undefined,
  sampleSize: number | null | undefined,
  prior: number,
  stabilizationPoint: number,
) {
  if (observed === null || observed === undefined || !Number.isFinite(observed)) {
    return prior;
  }

  const sample = Math.max(sampleSize ?? 0, 0);
  const weight = sample / (sample + stabilizationPoint);

  return observed * weight + prior * (1 - weight);
}

function poissonBinomialAtLeastTwo(probability: number, opportunities: number) {
  const noHits = (1 - probability) ** opportunities;
  const exactlyOne = opportunities * probability * (1 - probability) ** Math.max(opportunities - 1, 0);

  return clamp(1 - noHits - exactlyOne, 0, 1);
}

function estimateTeamObp(input: AnalysisModelInput) {
  const hitterObp = input.hitter.season?.obp ?? input.hitter.priorSeason?.obp;

  return shrinkRate(
    hitterObp,
    input.hitter.season?.plateAppearances ?? input.hitter.priorSeason?.plateAppearances,
    LEAGUE_TEAM_OBP,
    220,
  );
}

function getGameWinEdge(input: AnalysisModelInput) {
  return clamp((input.gameWinContext?.hitterTeamWinProbability ?? 0.5) - 0.5, -0.32, 0.32);
}

function getGameWinPerAtBatAdjustment(input: AnalysisModelInput, market: AnalysisMarket) {
  const edge = getGameWinEdge(input);
  const confidenceWeight =
    input.gameWinContext?.confidence === "high"
      ? 1
      : input.gameWinContext?.confidence === "medium"
        ? 0.75
        : 0.5;

  return clamp(edge * confidenceWeight * (market === "home_run" ? 0.035 : 0.055), -0.012, 0.014);
}

function getGameWinOpportunityAdjustment(input: AnalysisModelInput) {
  const edge = getGameWinEdge(input);
  const confidenceWeight =
    input.gameWinContext?.confidence === "high"
      ? 1
      : input.gameWinContext?.confidence === "medium"
        ? 0.75
        : 0.5;

  return clamp(edge * confidenceWeight * 0.32, -0.1, 0.12);
}

function adjustProbabilityForGameWin(
  probability: number,
  input: AnalysisModelInput,
  market: AnalysisMarket,
) {
  if (!input.gameWinContext) {
    return probability;
  }

  const edge = getGameWinEdge(input);
  const confidenceWeight =
    input.gameWinContext.confidence === "high"
      ? 1
      : input.gameWinContext.confidence === "medium"
        ? 0.75
        : 0.5;
  const logit = Math.log(clamp(probability, 0.001, 0.999) / (1 - clamp(probability, 0.001, 0.999)));
  const adjustment = edge * confidenceWeight * (market === "home_run" ? 0.22 : 0.32);

  return clamp(1 / (1 + Math.exp(-(logit + adjustment))), 0.001, 0.999);
}

function gameWinExpectedHitsMultiplier(input: AnalysisModelInput) {
  if (!input.gameWinContext) {
    return 1;
  }

  const edge = getGameWinEdge(input);
  const confidenceWeight =
    input.gameWinContext.confidence === "high"
      ? 1
      : input.gameWinContext.confidence === "medium"
        ? 0.75
        : 0.5;

  return clamp(1 + edge * confidenceWeight * 0.18, 0.94, 1.07);
}

export function estimateProjectedOpportunities(input: AnalysisModelInput) {
  const config = HIT_PROBABILITY_MODEL_CONFIG;
  const seasonAtBatsPerGame =
    safeRate(input.hitter.season?.atBats, input.hitter.season?.gamesPlayed) ??
    safeRate(input.hitter.priorSeason?.atBats, input.hitter.priorSeason?.gamesPlayed) ??
    3.9;
  const lineupPlateAppearances =
    input.hitter.lineupSlot ? config.lineupPlateAppearances[input.hitter.lineupSlot] : null;
  const teamObp = estimateTeamObp(input);
  const teamContextAdjustment = clamp(
    (teamObp - LEAGUE_TEAM_OBP) * config.adjustmentScales.teamObp,
    -config.caps.opportunityTeam,
    config.caps.opportunityTeam,
  );
  const homeAdjustment =
    input.hitter.player.currentTeamId === input.game.homeTeam.id ? -0.06 : 0.04;
  const gameWinOpportunityAdjustment = getGameWinOpportunityAdjustment(input);
  const projectedPlateAppearances = clamp(
    (lineupPlateAppearances ?? seasonAtBatsPerGame + 0.55) +
      teamContextAdjustment +
      homeAdjustment +
      gameWinOpportunityAdjustment,
    3.2,
    5.15,
  );
  const atBatShare = clamp(
    safeRate(input.hitter.season?.atBats, input.hitter.season?.plateAppearances) ??
      safeRate(input.hitter.priorSeason?.atBats, input.hitter.priorSeason?.plateAppearances) ??
      0.88,
    0.76,
    0.94,
  );

  return {
    projectedPlateAppearances,
    projectedAtBats: clamp(projectedPlateAppearances * atBatShare, 3.05, 5.05),
    teamContextAdjustment,
    homeAdjustment,
    gameWinOpportunityAdjustment,
  };
}

function extractExpectedIso(input: AnalysisModelInput["hitter"] | AnalysisModelInput["pitcher"]): number | null {
  const xSlugging = input.expected?.expectedSlugging ?? input.expected?.slugging;
  const xAverage = input.expected?.expectedBattingAverage ?? input.expected?.battingAverage;

  if (xSlugging !== null && xSlugging !== undefined && xAverage !== null && xAverage !== undefined) {
    return xSlugging - xAverage;
  }

  const seasonLine = input.season as { slg?: number | null; avg?: number | null } | null;
  const seasonSlugging = seasonLine?.slg ?? null;
  const seasonAverage = seasonLine?.avg ?? null;

  if (seasonSlugging !== null && seasonSlugging !== undefined && seasonAverage !== null && seasonAverage !== undefined) {
    return seasonSlugging - seasonAverage;
  }

  return null;
}

function extractPriorExpectedIso(input: AnalysisModelInput["hitter"] | AnalysisModelInput["pitcher"]): number | null {
  const xSlugging = input.priorExpected?.expectedSlugging ?? input.priorExpected?.slugging;
  const xAverage =
    input.priorExpected?.expectedBattingAverage ?? input.priorExpected?.battingAverage;

  if (xSlugging !== null && xSlugging !== undefined && xAverage !== null && xAverage !== undefined) {
    return xSlugging - xAverage;
  }

  const priorSeasonLine = input.priorSeason as { slg?: number | null; avg?: number | null } | null;
  const seasonSlugging = priorSeasonLine?.slg ?? null;
  const seasonAverage = priorSeasonLine?.avg ?? null;

  if (seasonSlugging !== null && seasonSlugging !== undefined && seasonAverage !== null && seasonAverage !== undefined) {
    return seasonSlugging - seasonAverage;
  }

  return null;
}

function isoToHomeRunRate(iso: number | null | undefined): number | null {
  if (iso === null || iso === undefined) {
    return null;
  }

  return clamp(iso / 5, 0.01, 0.09);
}

function estimateHitPerOpportunity(
  input: AnalysisModelInput,
  batterForm: ReturnType<typeof summarizeBatterOutcomeForm>,
  pitcherOutcome: ReturnType<typeof summarizePitcherOutcomeSuppression>,
  pitcherExpectedHitRate: number,
  pitcherStrikeoutRate: number,
  recentGameLog: ReturnType<typeof summarizeRecentGameLog>,
  feedbackCalibration: number,
) {
  const config = HIT_PROBABILITY_MODEL_CONFIG;
  const seasonAverage = shrinkRate(
    input.hitter.season?.avg,
    input.hitter.season?.atBats,
    config.leagueHitRate,
    config.shrinkage.hitterSeasonAtBats,
  );
  const expectedAverage = shrinkRate(
    input.hitter.expected?.expectedBattingAverage ?? input.hitter.expected?.battingAverage,
    input.hitter.expected?.plateAppearances,
    seasonAverage,
    config.shrinkage.expectedStatsPlateAppearances,
  );
  const obpSkill =
    shrinkRate(
      input.hitter.season?.obp,
      input.hitter.season?.plateAppearances,
      LEAGUE_TEAM_OBP,
      config.shrinkage.hitterSeasonAtBats,
    ) - LEAGUE_TEAM_OBP;
  const slugSkill =
    shrinkRate(
      input.hitter.season?.slg,
      input.hitter.season?.atBats,
      LEAGUE_HIT_RATE + LEAGUE_POWER_ISO,
      config.shrinkage.hitterSeasonAtBats,
    ) -
    (LEAGUE_HIT_RATE + LEAGUE_POWER_ISO);
  const statcastOutcome = shrinkRate(
    batterForm.overallRate,
    batterForm.sampleSize,
    seasonAverage,
    config.shrinkage.hitterSeasonAtBats,
  );
  const hardHitEdge = (batterForm.hardHitRate ?? LEAGUE_HARD_HIT_RATE) - LEAGUE_HARD_HIT_RATE;

  const baseline = clamp(
    seasonAverage * config.baselineWeights.seasonAverage +
      expectedAverage * config.baselineWeights.expectedAverage +
      statcastOutcome * config.baselineWeights.statcastOutcome +
      config.leagueHitRate *
        (1 -
          config.baselineWeights.seasonAverage -
          config.baselineWeights.expectedAverage -
          config.baselineWeights.statcastOutcome) +
      obpSkill * config.baselineWeights.obpSkill +
      slugSkill * config.baselineWeights.slugSkill +
      hardHitEdge * config.baselineWeights.hardHit,
    0.14,
    0.38,
  );
  const platoonRate = shrinkRate(
    batterForm.versusHandRate,
    batterForm.sampleSize,
    baseline,
    config.shrinkage.handSplitAtBats,
  );
  const platoonAdjustment = clamp(
    (platoonRate - baseline) * config.adjustmentScales.platoon,
    -config.caps.platoon,
    config.caps.platoon,
  );
  const pitcherAverageAdjustment = (pitcherExpectedHitRate - config.leagueHitRate) * config.adjustmentScales.pitcherAverage;
  const pitcherWhipAdjustment =
    ((input.pitcher.season?.whip ?? input.pitcher.priorSeason?.whip ?? 1.28) - 1.28) *
    config.adjustmentScales.pitcherWhip;
  const pitcherContactAdjustment =
    ((pitcherOutcome.hardHitRateAllowed ?? LEAGUE_HARD_HIT_RATE) - LEAGUE_HARD_HIT_RATE) *
    config.adjustmentScales.pitcherHardHit;
  const pitcherKAdjustment =
    (pitcherStrikeoutRate - LEAGUE_STRIKEOUT_RATE) * config.adjustmentScales.pitcherStrikeout;
  const pitcherAdjustment = clamp(
    pitcherAverageAdjustment + pitcherWhipAdjustment + pitcherContactAdjustment + pitcherKAdjustment,
    -config.caps.pitcher,
    config.caps.pitcher,
  );
  const bullpenAdjustment = clamp(
    computeDefenseAdjustment(input.defense, "hit") * config.adjustmentScales.bullpenDefenseProxy,
    -config.caps.bullpen,
    config.caps.bullpen,
  );
  const recentHitRate = shrinkRate(
    recentGameLog.hitRate,
    recentGameLog.atBats,
    baseline,
    config.shrinkage.recentAtBats,
  );
  const recentAdjustment = clamp(
    (recentHitRate - baseline) * config.adjustmentScales.recentForm +
      ((recentGameLog.hitGames / Math.max(input.hitter.recentGames.length, 1)) - 0.55) *
        config.adjustmentScales.recentConsistency,
    -config.caps.recent,
    config.caps.recent,
  );
  const parkAdjustment = computeParkAdjustment(input.venue, "hit");
  const weatherAdjustment = computeWeatherAdjustment(
    input.weather,
    input.venue?.roofType ?? null,
    "hit",
  );
  const pitchMix = computePitchMixEdge(
    input.hitter.events,
    input.pitcher.pitchMix,
    HIT_EVENTS,
    baseline,
    0.28,
    -0.015,
    0.015,
  );
  const perOpportunity = clamp(
    baseline +
      platoonAdjustment +
      pitcherAdjustment +
      pitchMix.adjustment +
      bullpenAdjustment +
      parkAdjustment +
      weatherAdjustment +
      recentAdjustment +
      feedbackCalibration,
    config.minPerOpportunity,
    config.maxPerOpportunity,
  );

  return {
    baseline,
    seasonAverage,
    expectedAverage,
    statcastOutcome,
    hardHitEdge,
    platoonAdjustment,
    pitcherAdjustment,
    pitchMixAdjustment: pitchMix.adjustment,
    pitchMixCoverage: pitchMix.coverage,
    bullpenAdjustment,
    parkAdjustment,
    weatherAdjustment,
    recentAdjustment,
    perOpportunity,
  };
}

export function scoreOutcomeChance(
  input: AnalysisModelInput,
  market: AnalysisMarket,
  feedbackCalibration = 0,
): Omit<AnalysisResult, "analysisId" | "generatedAt" | "aiSummary"> {
  const outcomeEvents = market === "home_run" ? HOME_RUN_EVENTS : HIT_EVENTS;
  const marketLabel = getMarketLabel(market);

  const hitterCurrentPlateAppearances =
    input.hitter.season?.plateAppearances ?? input.hitter.expected?.plateAppearances ?? 0;
  const hitterCurrentWeight = clamp(hitterCurrentPlateAppearances / 150, 0.35, 0.85);
  const hitterSeasonHitRateRaw = input.hitter.season?.avg ?? LEAGUE_HIT_RATE;
  const hitterSeasonHitRate =
    input.hitter.priorSeason?.avg !== null && input.hitter.priorSeason?.avg !== undefined
      ? hitterCurrentWeight * hitterSeasonHitRateRaw +
        (1 - hitterCurrentWeight) * input.hitter.priorSeason.avg
      : hitterSeasonHitRateRaw;
  const hitterExpectedHitRateRaw =
    input.hitter.expected?.expectedBattingAverage ?? input.hitter.expected?.battingAverage;
  const hitterPriorExpectedHitRate =
    input.hitter.priorExpected?.expectedBattingAverage ??
    input.hitter.priorExpected?.battingAverage;
  const hitterExpectedHitRate =
    hitterExpectedHitRateRaw !== null &&
    hitterExpectedHitRateRaw !== undefined &&
    hitterPriorExpectedHitRate !== null &&
    hitterPriorExpectedHitRate !== undefined
      ? hitterCurrentWeight * hitterExpectedHitRateRaw +
        (1 - hitterCurrentWeight) * hitterPriorExpectedHitRate
      : hitterExpectedHitRateRaw;
  const hitterSeasonHomeRunRateRaw =
    safeRate(input.hitter.season?.homeRuns, input.hitter.season?.atBats) ??
    LEAGUE_HOME_RUN_RATE;
  const hitterSeasonHomeRunRate =
    input.hitter.priorSeason
      ? hitterCurrentWeight * hitterSeasonHomeRunRateRaw +
        (1 - hitterCurrentWeight) *
          (safeRate(input.hitter.priorSeason.homeRuns, input.hitter.priorSeason.atBats) ??
            hitterSeasonHomeRunRateRaw)
      : hitterSeasonHomeRunRateRaw;

  const hitterExpectedIsoRaw = extractExpectedIso(input.hitter);
  const hitterPriorExpectedIso = extractPriorExpectedIso(input.hitter);
  const hitterExpectedIso =
    hitterExpectedIsoRaw !== null &&
    hitterExpectedIsoRaw !== undefined &&
    hitterPriorExpectedIso !== null &&
    hitterPriorExpectedIso !== undefined
      ? hitterCurrentWeight * hitterExpectedIsoRaw +
        (1 - hitterCurrentWeight) * hitterPriorExpectedIso
      : hitterExpectedIsoRaw ?? hitterPriorExpectedIso ?? LEAGUE_POWER_ISO;

  const batterForm = summarizeBatterOutcomeForm(
    input.hitter.events,
    input.pitcher.player?.pitchHand ?? null,
    input.game.officialDate,
    outcomeEvents,
  );
  const recentGameLog = summarizeRecentGameLog(input.hitter.recentGames);
  const recentGameAdjustment = computeRecentGameAdjustment(recentGameLog, market);

  const pitcherCurrentSample =
    input.pitcher.season?.battersFaced ?? input.pitcher.expected?.plateAppearances ?? 0;
  const pitcherCurrentWeight = clamp(pitcherCurrentSample / 180, 0.35, 0.85);
  const pitcherOutcome = summarizePitcherOutcomeSuppression(
    input.pitcher.events,
    input.hitter.player.batSide,
    outcomeEvents,
  );

  const pitcherExpectedHitRateRaw =
    input.pitcher.expected?.expectedBattingAverage ??
    input.pitcher.expected?.battingAverage ??
    pitcherOutcome.outcomeRateAllowed ??
    input.pitcher.season?.avg ??
    LEAGUE_HIT_RATE;
  const pitcherPriorHitRate =
    input.pitcher.priorExpected?.expectedBattingAverage ??
    input.pitcher.priorExpected?.battingAverage ??
    input.pitcher.priorSeason?.avg;
  const pitcherExpectedHitRate =
    pitcherPriorHitRate !== null && pitcherPriorHitRate !== undefined
      ? pitcherCurrentWeight * pitcherExpectedHitRateRaw +
        (1 - pitcherCurrentWeight) * pitcherPriorHitRate
      : pitcherExpectedHitRateRaw;

  const pitcherExpectedIsoRaw = extractExpectedIso(input.pitcher);
  const pitcherPriorExpectedIso = extractPriorExpectedIso(input.pitcher);
  const pitcherExpectedIso =
    pitcherExpectedIsoRaw !== null &&
    pitcherExpectedIsoRaw !== undefined &&
    pitcherPriorExpectedIso !== null &&
    pitcherPriorExpectedIso !== undefined
      ? pitcherCurrentWeight * pitcherExpectedIsoRaw +
        (1 - pitcherCurrentWeight) * pitcherPriorExpectedIso
      : pitcherExpectedIsoRaw ?? pitcherPriorExpectedIso ?? LEAGUE_POWER_ISO;
  const pitcherHomeRunRateRaw =
    pitcherOutcome.outcomeRateAllowed ?? isoToHomeRunRate(pitcherExpectedIsoRaw) ?? LEAGUE_HOME_RUN_RATE;
  const pitcherPriorHomeRunRate =
    isoToHomeRunRate(pitcherPriorExpectedIso) ?? LEAGUE_HOME_RUN_RATE;
  const pitcherHomeRunRate =
    pitcherCurrentWeight * pitcherHomeRunRateRaw +
    (1 - pitcherCurrentWeight) * pitcherPriorHomeRunRate;

  const pitcherHardHitRate = pitcherOutcome.hardHitRateAllowed ?? LEAGUE_HARD_HIT_RATE;
  const pitcherBarrelLikeRate =
    pitcherOutcome.barrelLikeRateAllowed ?? LEAGUE_BARREL_LIKE_RATE;
  const pitcherStrikeoutRate =
    input.pitcher.season?.battersFaced && input.pitcher.season.strikeOuts
      ? input.pitcher.season.strikeOuts / input.pitcher.season.battersFaced
      : (pitcherOutcome.strikeoutRate ?? LEAGUE_STRIKEOUT_RATE);

  let baseline = LEAGUE_HIT_RATE;
  let pitcherAdjustment = 0;
  let pitchMixAdjustment = 0;
  let pitchMixCoverage = 0;
  let bullpenAdjustment = 0;
  let hitModel:
    | ReturnType<typeof estimateHitPerOpportunity>
    | null = null;

  if (market === "hit") {
    hitModel = estimateHitPerOpportunity(
      input,
      batterForm,
      pitcherOutcome,
      pitcherExpectedHitRate,
      pitcherStrikeoutRate,
      recentGameLog,
      feedbackCalibration,
    );
    baseline = hitModel.baseline;
    pitcherAdjustment = hitModel.pitcherAdjustment;
    pitchMixAdjustment = hitModel.pitchMixAdjustment;
    pitchMixCoverage = hitModel.pitchMixCoverage;
    bullpenAdjustment = hitModel.bullpenAdjustment;
  } else {
    baseline = clamp(
      hitterSeasonHomeRunRate * 0.44 +
        (batterForm.versusHandRate ?? hitterSeasonHomeRunRate) * 0.18 +
        (batterForm.recentRate ?? hitterSeasonHomeRunRate) * 0.14 +
        clamp((hitterExpectedIso - LEAGUE_POWER_ISO) * 0.16, -0.018, 0.028) +
        ((batterForm.hardHitRate ?? LEAGUE_HARD_HIT_RATE) - LEAGUE_HARD_HIT_RATE) * 0.06 +
        ((batterForm.barrelLikeRate ?? LEAGUE_BARREL_LIKE_RATE) -
          LEAGUE_BARREL_LIKE_RATE) *
          0.12,
      0.008,
      0.16,
    );

    pitcherAdjustment = clamp(
      (pitcherHomeRunRate - LEAGUE_HOME_RUN_RATE) * 1.1 +
        (pitcherExpectedIso - LEAGUE_POWER_ISO) * 0.18 +
        (pitcherHardHitRate - LEAGUE_HARD_HIT_RATE) * 0.06 +
        (pitcherBarrelLikeRate - LEAGUE_BARREL_LIKE_RATE) * 0.12 -
        (pitcherStrikeoutRate - LEAGUE_STRIKEOUT_RATE) * 0.06,
      -0.045,
      0.05,
    );

    const pitchMix = computePitchMixEdge(
      input.hitter.events,
      input.pitcher.pitchMix,
      HOME_RUN_EVENTS,
      hitterSeasonHomeRunRate,
      0.55,
      -0.015,
      0.02,
    );
    pitchMixAdjustment = pitchMix.adjustment;
    pitchMixCoverage = pitchMix.coverage;
  }
  const defenseAdjustment = computeDefenseAdjustment(input.defense, market);
  const parkAdjustment = computeParkAdjustment(input.venue, market);
  const weatherAdjustment = computeWeatherAdjustment(
    input.weather,
    input.venue?.roofType ?? null,
    market,
  );
  const externalAdjustment =
    market === "home_run"
      ? input.externalContext?.features.weatherBoostForHR ?? 0
      : -(input.externalContext?.features.weatherSeverityScore ?? 0) * 0.015;
  const gameWinPerAtBatAdjustment = getGameWinPerAtBatAdjustment(input, market);

  const contextPerAtBat =
    market === "hit" && hitModel
      ? clamp(hitModel.perOpportunity + externalAdjustment, 0.02, 0.72)
      : clamp(
          baseline +
            pitcherAdjustment +
            pitchMixAdjustment +
            recentGameAdjustment +
            defenseAdjustment +
            parkAdjustment +
            weatherAdjustment +
            externalAdjustment +
            gameWinPerAtBatAdjustment +
            feedbackCalibration,
          0.005,
          0.2,
        );

  const opportunityProjection = estimateProjectedOpportunities(input);
  const expectedAtBats =
    market === "hit"
      ? opportunityProjection.projectedAtBats
      : opportunityProjection.projectedAtBats;

  const mlPrediction = market === "hit" ? predictHitWithMl(input) : null;
  const perAtBat = clamp(
    (mlPrediction?.inferredPerAtBat ?? contextPerAtBat) + gameWinPerAtBatAdjustment,
    market === "home_run" ? 0.005 : 0.02,
    market === "home_run" ? 0.2 : 0.72,
  );
  const atLeastOne = 1 - (1 - perAtBat) ** expectedAtBats;
  const finalAtLeastOne = adjustProbabilityForGameWin(
    mlPrediction?.probability1PlusHit ?? atLeastOne,
    input,
    market,
  );
  const expectedHits =
    market === "hit"
      ? (mlPrediction?.expectedHits ?? expectedAtBats * perAtBat) *
        gameWinExpectedHitsMultiplier(input)
      : null;
  const atLeastTwo =
    market === "hit"
      ? mlPrediction?.probability2PlusHits ?? poissonBinomialAtLeastTwo(perAtBat, expectedAtBats)
      : null;
  const recommendation = recommendationForProbability(finalAtLeastOne, market);

  const diagnostics: AnalysisDiagnostics = {
    hitterSampleSize: batterForm.sampleSize,
    hitterRecentSampleSize: batterForm.recentSampleSize,
    pitcherSampleSize: pitcherOutcome.sampleSize,
    pitchMixCoverage,
  };

  const confidence = confidenceForInput(
    input.pitcher.probable,
    diagnostics,
    Boolean(input.weather),
    Boolean(input.defense),
  );

  const factors: AnalysisFactor[] = [
    {
      label: market === "home_run" ? "Power baseline" : "Hitter baseline",
      value: `${formatDecimal(baseline)} per AB`,
      impact: impactLabel(
        baseline - (market === "home_run" ? LEAGUE_HOME_RUN_RATE : LEAGUE_HIT_RATE),
      ),
      detail:
        market === "home_run"
          ? `Blended HR rate ${formatDecimal(hitterSeasonHomeRunRate)} with stabilized xISO ${formatDecimal(
              hitterExpectedIso,
            )}. Recent HR form ${formatDecimal(
              batterForm.recentRate ?? hitterSeasonHomeRunRate,
            )}.`
          : `Weighted season AVG ${formatDecimal(
              hitModel?.seasonAverage ?? hitterSeasonHitRate,
            )}, xBA/contact estimate ${formatDecimal(
              hitModel?.expectedAverage ?? hitterExpectedHitRate ?? hitterSeasonHitRate,
            )}, Statcast outcome rate ${formatDecimal(
              hitModel?.statcastOutcome ?? batterForm.overallRate ?? hitterSeasonHitRate,
            )}, and hard-hit edge ${formatDecimal(hitModel?.hardHitEdge ?? 0)}.`,
    },
    {
      label: "Handedness split",
      value: `${(hitModel?.platoonAdjustment ?? 0) >= 0 ? "+" : ""}${formatDecimal(
        hitModel?.platoonAdjustment ?? 0,
      )}`,
      impact: impactLabel(hitModel?.platoonAdjustment ?? 0),
      detail:
        market === "hit"
          ? input.pitcher.player?.pitchHand
            ? `Batter results against ${input.pitcher.player.pitchHand}-handed pitching were shrunk toward the hitter baseline before adjusting the projection.`
            : "No probable pitcher handedness was available, so platoon stayed neutral."
          : "Home-run mode keeps handedness inside the power baseline and pitch-mix factors.",
    },
    {
      label: market === "home_run" ? "Pitcher power matchup" : "Pitcher matchup",
      value: `${pitcherAdjustment >= 0 ? "+" : ""}${formatDecimal(pitcherAdjustment)}`,
      impact: impactLabel(pitcherAdjustment),
      detail: input.pitcher.player
        ? market === "home_run"
          ? `${input.pitcher.player.fullName} projects around ${formatDecimal(
              pitcherHomeRunRate,
            )} HR probability per AB with a stabilized power-allowed profile of ${formatDecimal(
              pitcherExpectedIso,
            )} ISO.`
          : `${input.pitcher.player.fullName} projects to allow ${formatDecimal(
              pitcherExpectedHitRate,
            )} AVG with a ${formatPercent(pitcherStrikeoutRate)} strikeout rate.`
        : "No confirmed probable pitcher, so the pitcher component was muted.",
    },
    {
      label: "Pitch mix fit",
      value: `${pitchMixAdjustment >= 0 ? "+" : ""}${formatDecimal(pitchMixAdjustment)}`,
      impact: impactLabel(pitchMixAdjustment),
      detail:
        input.pitcher.pitchMix.length > 0
          ? `The hitter's ${market === "home_run" ? "power" : "results"} were compared against the opposing mix, with ${formatPercent(
              pitchMixCoverage,
            )} of usage backed by direct hitter sample.`
          : "No reliable pitch-mix sample was available, so this factor stayed neutral.",
    },
    {
      label: "Last 5 games",
      value: `${(hitModel?.recentAdjustment ?? recentGameAdjustment) >= 0 ? "+" : ""}${formatDecimal(
        hitModel?.recentAdjustment ?? recentGameAdjustment,
      )}`,
      impact: impactLabel(hitModel?.recentAdjustment ?? recentGameAdjustment),
      detail:
        recentGameLog.atBats > 0
          ? market === "home_run"
            ? `${input.hitter.player.fullName} has ${recentGameLog.hits} hits, ${recentGameLog.homeRuns} HR, and ${recentGameLog.runProduction} runs plus RBI over ${recentGameLog.atBats} AB in the last 5 games.`
            : `${input.hitter.player.fullName} has ${recentGameLog.hits} hits in ${recentGameLog.atBats} AB and recorded a hit in ${recentGameLog.hitGames} of the last 5 games.`
          : "No recent game-log sample was available, so this factor stayed neutral.",
    },
    {
      label: market === "home_run" ? "Defense impact" : "Bullpen/defense proxy",
      value: `${(market === "hit" ? bullpenAdjustment : defenseAdjustment) >= 0 ? "+" : ""}${formatDecimal(
        market === "hit" ? bullpenAdjustment : defenseAdjustment,
      )}`,
      impact: impactLabel(market === "hit" ? bullpenAdjustment : defenseAdjustment),
      detail:
        market === "home_run"
          ? "Defense matters much less once the ball clears the wall, so this factor stays close to neutral."
          : input.defense
            ? `${input.defense.teamName} carries fielding ${formatDecimal(
                input.defense.fieldingPct ?? 0.985,
              )}, OAA ${input.defense.oaa ?? 0}, and arm strength ${formatDecimal(
                input.defense.armOverall ?? 84,
                1,
              )}.`
            : "Defense data was limited, so the model treated this as neutral.",
    },
    {
      label: market === "home_run" ? "Park carry" : "Park context",
      value: `${parkAdjustment >= 0 ? "+" : ""}${formatDecimal(parkAdjustment)}`,
      impact: impactLabel(parkAdjustment),
      detail: input.venue
        ? market === "home_run"
          ? `${input.venue.name} has lines at ${input.venue.dimensions.leftLine ?? "?"} and ${
              input.venue.dimensions.rightLine ?? "?"
            } feet, which helps shape home-run carry.`
          : `${input.venue.name} uses ${input.venue.turfType ?? "unknown"} and ${
              input.venue.roofType ?? "unknown"
            } conditions, with center field at ${input.venue.dimensions.center ?? "?"} feet.`
        : "Venue geometry was not available, so this factor stayed neutral.",
    },
    {
      label: "Weather",
      value: `${weatherAdjustment + externalAdjustment >= 0 ? "+" : ""}${formatDecimal(weatherAdjustment + externalAdjustment)}`,
      impact: impactLabel(weatherAdjustment + externalAdjustment),
      detail: input.weather
        ? `${Math.round(input.weather.temperatureF ?? 70)}F, ${
            input.weather.precipitationProbability ?? 0
          }% precip chance, and ${Math.round(input.weather.windSpeedMph ?? 0)} mph wind.`
        : "No usable forecast was available, so weather did not move the model.",
    },
    {
      label: "Projected chances",
      value: `${expectedAtBats.toFixed(1)} AB`,
      impact: "neutral",
      detail: `Lineup slot ${
        input.hitter.lineupSlot ?? "unknown"
      }, home/away context, and offensive environment project ${opportunityProjection.projectedPlateAppearances.toFixed(
        1,
      )} plate appearances and ${expectedAtBats.toFixed(1)} at-bats.`,
    },
  ];

  if (input.gameWinContext) {
    const edge = getGameWinEdge(input);

    factors.push({
      label: "Team win context",
      value: `${formatPercent(input.gameWinContext.hitterTeamWinProbability)} win`,
      impact: impactLabel(edge),
      detail:
        edge > 0
          ? `The game winner model favors ${input.hitter.player.currentTeamAbbreviation ?? "this team"}, so the hitter gets a small boost for stronger projected offense and run environment.`
          : edge < 0
            ? `The game winner model leans toward the opponent, so the hitter gets a small drag for weaker projected team context.`
            : "The game winner model sees this matchup as close, so team-win context stays neutral.",
    });
  }

  if (feedbackCalibration !== 0) {
    factors.push({
      label: "Feedback calibration",
      value: `${feedbackCalibration >= 0 ? "+" : ""}${formatDecimal(feedbackCalibration)}`,
      impact: impactLabel(feedbackCalibration),
      detail:
        "Recent saved feedback adjusted this market slightly. This includes slips or notes marked as right, too optimistic, or too pessimistic.",
    });
  }

  if (mlPrediction) {
    factors.unshift({
      label: "ML model",
      value: formatPercent(mlPrediction.probability1PlusHit),
      impact: "neutral",
      detail: `Regularized logistic regression artifact ${mlPrediction.modelVersion} produced the final 1+ hit probability. Top drivers: ${mlPrediction.topContributors
        .map(
          (entry) =>
            `${entry.feature} ${entry.contribution >= 0 ? "+" : ""}${formatDecimal(
              entry.contribution,
              3,
            )}`,
        )
        .join(", ")}.`,
    });
  }

  const notes: string[] = [];

  if (!mlPrediction && market === "hit") {
    notes.push("No trained ML artifact was found, so the app used the context-aware fallback model.");
  }

  if (!input.pitcher.probable) {
    notes.push("Probable pitcher was not confirmed for this game, so confidence is lower.");
  }
  if (input.venue?.roofType?.toLowerCase().includes("closed")) {
    notes.push("A closed roof muted the weather adjustment.");
  }
  if (batterForm.sampleSize < 20) {
    notes.push(
      `The hitter has a small current-season Statcast sample for ${market === "home_run" ? "power" : "contact"}, so recent-form inputs are noisy.`,
    );
  }
  if (pitcherOutcome.sampleSize < 20 && input.pitcher.player) {
    notes.push(
      `The pitcher's current ${market === "home_run" ? "power-allowed" : "contact-allowed"} sample is still small.`,
    );
  }
  if (hitterCurrentWeight < 0.6 && input.hitter.priorSeason) {
    notes.push("2025 hitter data was blended in to stabilize an early 2026 sample.");
  }
  if (pitcherCurrentWeight < 0.6 && input.pitcher.priorSeason) {
    notes.push("2025 pitcher data was blended in to stabilize an early 2026 sample.");
  }
  if (input.hitter.lineupSlot) {
    notes.push(`Expected at-bats were adjusted using the live lineup slot (${input.hitter.lineupSlot}).`);
  }
  if (input.hitter.recentGames.length > 0) {
    notes.push("Last-5 game-log form was included as a short-term adjustment.");
  }
  if (input.gameWinContext) {
    notes.push(
      `The ${input.gameWinContext.modelVersion} game winner projection was used as a small team-context adjustment.`,
    );
  }
  if (feedbackCalibration !== 0) {
    notes.push("Saved feedback has started calibrating this market.");
  }

  return {
    market,
    marketLabel,
    modelVersion: mlPrediction ? `${MODEL_VERSION}+${mlPrediction.modelVersion}` : MODEL_VERSION,
    recommendation,
    confidence,
    probabilities: {
      perAtBat,
      atLeastOne: finalAtLeastOne,
      atLeastTwo,
      expectedHits,
      expectedAtBats,
    },
    hitter: {
      player: input.hitter.player,
      season: input.hitter.season,
      priorSeason: input.hitter.priorSeason,
      expected: input.hitter.expected,
      priorExpected: input.hitter.priorExpected,
      sprint: input.hitter.sprint,
      lineupSlot: input.hitter.lineupSlot,
      recentGames: input.hitter.recentGames,
    },
    pitcher: {
      player: input.pitcher.player,
      season: input.pitcher.season,
      priorSeason: input.pitcher.priorSeason,
      expected: input.pitcher.expected,
      priorExpected: input.pitcher.priorExpected,
      pitchMix: input.pitcher.pitchMix,
      probable: input.pitcher.probable,
    },
    game: input.game,
    venue: input.venue,
    weather: input.weather,
    defense: input.defense,
    factors,
    notes,
    diagnostics,
    batterVsPitcher: null,
    summary: `${input.hitter.player.fullName} projects for a ${formatPercent(
      finalAtLeastOne,
    )} chance of at least one ${market === "home_run" ? "home run" : "hit"}, built from a ${formatPercent(
      perAtBat,
    )} per-at-bat ${market === "home_run" ? "home-run" : "hit"} rate over roughly ${expectedAtBats.toFixed(
      1,
    )} expected at-bats${
      market === "hit" && expectedHits !== null && atLeastTwo !== null
        ? `, ${expectedHits.toFixed(2)} expected hits, and a ${formatPercent(
            atLeastTwo,
          )} chance of 2+ hits`
        : ""
    }.`,
  };
}

export function scoreHitChance(input: AnalysisModelInput) {
  return scoreOutcomeChance(input, "hit");
}
