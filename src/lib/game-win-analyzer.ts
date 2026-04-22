import { buildGameWinFeatureVector, type GameWinFeatureName } from "@/lib/game-win-features";
import { predictGameWinner, type GameWinModelPrediction } from "@/lib/game-win-predictor";
import { buildExternalContext } from "@/lib/enrichment/external-context";
import {
  getGameByPk,
  getGameLineupStatus,
  getPlayerPitchingStats,
  getPreviousSeriesGames,
  getTeamBullpenUsageSummary,
  getTeamFieldingStats,
  getTeamHittingStats,
  getTeamPitchingStats,
  getTeamRecentGameSummaries,
  getVenueById,
} from "@/lib/mlb";
import {
  getPitcherExpectedStats,
  getTeamDefenseExtras,
} from "@/lib/statcast";
import { getGameWeather } from "@/lib/weather";
import {
  type GameSummary,
  type GameWinConfidence,
  type GameWinFactorEdge,
  type GameWinFactor,
  type GameWinFeatureVector,
  type GameWinPredictionResult,
  type GameWinTeamSnapshot,
  type LineupCardPlayer,
  type TeamGameInfo,
} from "@/lib/types";
import { clamp, formatPercent } from "@/lib/utils";

async function safeSource<T>(
  label: string,
  promise: Promise<T>,
  fallback: T,
  warnings: string[],
): Promise<T> {
  try {
    return await promise;
  } catch {
    warnings.push(`${label} unavailable; using a neutral fallback for this prediction.`);
    return fallback;
  }
}

function currentSeason() {
  return new Date().getFullYear();
}

function rate(numerator: number | null | undefined, denominator: number | null | undefined) {
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

function summarizeRecent(
  games: Awaited<ReturnType<typeof getTeamRecentGameSummaries>>,
  referenceDate: string,
) {
  const completed = games.filter((game) => game.result !== "pending");
  const wins = completed.filter((game) => game.result === "win").length;
  const losses = completed.filter((game) => game.result === "loss").length;
  const runDiffs = completed.flatMap((game) =>
    game.teamScore !== null && game.opponentScore !== null
      ? [game.teamScore - game.opponentScore]
      : [],
  );
  const mostRecentDate = completed[0]?.date ?? null;
  const restDays = mostRecentDate
    ? Math.max(
        0,
        Math.round(
          (new Date(`${referenceDate}T12:00:00Z`).getTime() -
            new Date(`${mostRecentDate}T12:00:00Z`).getTime()) /
            (24 * 60 * 60 * 1000),
        ),
      )
    : null;

  return {
    games: completed.length,
    wins,
    losses,
    winPct: completed.length > 0 ? wins / completed.length : null,
    runDifferentialPerGame:
      runDiffs.length > 0
        ? runDiffs.reduce((sum, value) => sum + value, 0) / runDiffs.length
        : null,
    restDays,
  };
}

function teamLineupPlayers(
  game: GameSummary,
  side: "home" | "away",
  lineupStatus: Awaited<ReturnType<typeof getGameLineupStatus>>,
): LineupCardPlayer[] {
  const players = side === "home" ? lineupStatus.homePlayers : lineupStatus.awayPlayers;
  const teamId = side === "home" ? game.homeTeam.id : game.awayTeam.id;

  return players.filter((player) => {
    const matchingTeamPlayers =
      side === "home" ? game.lineupStatus?.homePlayers : game.lineupStatus?.awayPlayers;
    return matchingTeamPlayers?.some((entry) => entry.id === player.id) ?? Boolean(teamId);
  });
}

async function buildTeamSnapshot(input: {
  game: GameSummary;
  team: TeamGameInfo;
  side: "home" | "away";
  probablePitcher: GameSummary["homeProbablePitcher"];
  lineupStatus: Awaited<ReturnType<typeof getGameLineupStatus>>;
  season: number;
  sourceWarnings: string[];
}): Promise<GameWinTeamSnapshot> {
  const previousSeason = input.season - 1;
  const lineupPlayers = teamLineupPlayers(input.game, input.side, input.lineupStatus);
  const [
    starterSeason,
    starterPriorSeason,
    starterExpected,
    starterPriorExpected,
    offense,
    pitching,
    fielding,
    defense,
    recentGames,
    bullpen,
  ] = await Promise.all([
    input.probablePitcher
      ? safeSource(
          `${input.team.abbreviation} starter season stats`,
          getPlayerPitchingStats(input.probablePitcher.id, input.season),
          null,
          input.sourceWarnings,
        )
      : null,
    input.probablePitcher
      ? safeSource(
          `${input.team.abbreviation} starter prior-season stats`,
          getPlayerPitchingStats(input.probablePitcher.id, previousSeason),
          null,
          input.sourceWarnings,
        )
      : null,
    input.probablePitcher
      ? safeSource(
          `${input.team.abbreviation} starter Statcast expected stats`,
          getPitcherExpectedStats(input.probablePitcher.id, input.season),
          null,
          input.sourceWarnings,
        )
      : null,
    input.probablePitcher
      ? safeSource(
          `${input.team.abbreviation} starter prior Statcast expected stats`,
          getPitcherExpectedStats(input.probablePitcher.id, previousSeason),
          null,
          input.sourceWarnings,
        )
      : null,
    safeSource(
      `${input.team.abbreviation} team hitting stats`,
      getTeamHittingStats(input.team.id, input.season),
      null,
      input.sourceWarnings,
    ),
    safeSource(
      `${input.team.abbreviation} team pitching stats`,
      getTeamPitchingStats(input.team.id, input.season),
      null,
      input.sourceWarnings,
    ),
    safeSource(
      `${input.team.abbreviation} team fielding stats`,
      getTeamFieldingStats(input.team.id, input.season),
      null,
      input.sourceWarnings,
    ),
    safeSource(
      `${input.team.abbreviation} Statcast defense`,
      getTeamDefenseExtras(input.team.name, input.season),
      null,
      input.sourceWarnings,
    ),
    safeSource(
      `${input.team.abbreviation} recent game log`,
      getTeamRecentGameSummaries(input.team.id, input.game.officialDate, input.season, 10),
      [],
      input.sourceWarnings,
    ),
    safeSource(
      `${input.team.abbreviation} bullpen usage`,
      getTeamBullpenUsageSummary(input.team.id, input.game.officialDate, input.season),
      {
        recentInnings: null,
        backToBackRelievers: null,
        fatigueScore: null,
      },
      input.sourceWarnings,
    ),
  ]);

  return {
    team: input.team,
    probablePitcher: input.probablePitcher,
    starter: {
      season: starterSeason,
      expected: starterExpected,
      priorSeason: starterPriorSeason,
      priorExpected: starterPriorExpected,
    },
    offense,
    pitching,
    fielding,
    defense,
    lineupStatus: input.lineupStatus.status,
    lineupPlayers,
    recent: summarizeRecent(recentGames, input.game.officialDate),
    bullpen,
  };
}

function confidenceFromProbability(probability: number, missingCount: number): GameWinConfidence {
  const edge = Math.abs(probability - 0.5);

  if (missingCount >= 4 || edge < 0.055) {
    return "low";
  }
  if (missingCount <= 1 && edge >= 0.12) {
    return "high";
  }

  return "medium";
}

function featureLabel(feature: GameWinFeatureName) {
  const labels: Record<GameWinFeatureName, string> = {
    home_starter_quality: "Home starter baseline",
    away_starter_quality: "Away starter baseline",
    starter_quality_diff: "Starting pitcher edge",
    starter_workload_diff: "Starter workload",
    home_starter_missing: "Home starter uncertainty",
    away_starter_missing: "Away starter uncertainty",
    offense_ops_diff: "Team offense",
    offense_power_diff: "Power profile",
    offense_plate_discipline_diff: "Plate discipline",
    lineup_quality_diff: "Lineup matchup",
    lineup_confirmed: "Lineup confirmation",
    bullpen_quality_diff: "Bullpen quality",
    bullpen_fatigue_diff: "Bullpen freshness",
    defense_oaa_diff: "Defense range",
    fielding_pct_diff: "Fielding reliability",
    recent_win_pct_diff: "Recent form",
    recent_run_diff_per_game_diff: "Recent run differential",
    season_win_pct_diff: "Season team quality",
    rest_days_diff: "Rest advantage",
    home_field: "Home field",
    park_run_factor: "Park run environment",
    weather_run_environment: "Weather run environment",
    is_day_game: "Day-game context",
    is_night_game: "Night-game context",
    is_twilight_start: "Twilight start",
    first_pitch_minutes_from_sunset: "Sunset timing",
    day_length_minutes: "Daylight length",
    weather_severity_score: "Weather severity",
    weather_boost_for_hr: "Weather carry",
    weather_penalty_for_pitchers: "Pitching weather penalty",
    market_implied_home_win_prob: "Market home context",
    market_implied_away_win_prob: "Market away context",
    lineup_uncertainty_score: "Lineup uncertainty",
    injury_uncertainty_score: "Injury uncertainty",
    external_data_completeness_score: "External data completeness",
    critical_missing_count: "Data completeness",
  };

  return labels[feature];
}

function formatSigned(value: number, digits = 2) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function formatNumber(value: number | null | undefined, digits = 2) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "n/a"
    : value.toFixed(digits);
}

function formatNullablePercent(value: number | null | undefined, digits = 0) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "n/a"
    : formatPercent(value, digits);
}

function pitcherKMinusBb(team: GameWinTeamSnapshot) {
  const strikeoutRate = rate(team.starter.season?.strikeOuts, team.starter.season?.battersFaced);
  const walkRate = rate(team.starter.season?.baseOnBalls, team.starter.season?.battersFaced);

  if (strikeoutRate === null || walkRate === null) {
    return null;
  }

  return strikeoutRate - walkRate;
}

function getTeamSide(team: TeamGameInfo, home: GameWinTeamSnapshot, away: GameWinTeamSnapshot) {
  return team.id === home.team.id ? home : away;
}

function buildAnalysisSummary(input: {
  predictedWinner: TeamGameInfo;
  homeWinProbability: number;
  awayWinProbability: number;
  home: GameWinTeamSnapshot;
  away: GameWinTeamSnapshot;
  confidence: GameWinConfidence;
  features: GameWinFeatureVector;
}) {
  const winner = getTeamSide(input.predictedWinner, input.home, input.away);
  const opponent = winner.team.id === input.home.team.id ? input.away : input.home;
  const winnerProbability =
    winner.team.id === input.home.team.id
      ? input.homeWinProbability
      : input.awayWinProbability;
  const starterName = winner.probablePitcher?.fullName ?? "TBD starter";
  const opponentStarterName = opponent.probablePitcher?.fullName ?? "TBD starter";
  const starterEra = winner.starter.expected?.expectedEra ?? winner.starter.season?.era;
  const opponentStarterEra = opponent.starter.expected?.expectedEra ?? opponent.starter.season?.era;
  const starterWhip = winner.starter.season?.whip;
  const opponentStarterWhip = opponent.starter.season?.whip;
  const starterKbb = pitcherKMinusBb(winner);
  const opponentStarterKbb = pitcherKMinusBb(opponent);
  const offenseOps = winner.offense?.ops;
  const opponentOps = opponent.offense?.ops;
  const recentRunDiff = winner.recent.runDifferentialPerGame;
  const opponentRecentRunDiff = opponent.recent.runDifferentialPerGame;
  const bullpenInnings = winner.bullpen.recentInnings;
  const opponentBullpenInnings = opponent.bullpen.recentInnings;
  const lineupText =
    winner.lineupStatus === "released" && opponent.lineupStatus === "released"
      ? "Both lineups are posted, so this is using the actual batting orders."
      : "Lineups are not fully posted yet, so the model leans more on team-level offense.";

  return [
    `The lean is ${input.predictedWinner.abbreviation} at ${formatPercent(
      winnerProbability,
    )} with ${input.confidence} confidence. The edge is not huge by itself, but the main baseball signals point slightly more toward ${
      winner.team.abbreviation
    }.`,
    `The starter matchup helps explain it: ${starterName} is being compared with ${opponentStarterName}. Their ERA/xERA is ${formatNumber(
      starterEra,
    )} vs ${formatNumber(opponentStarterEra)}, WHIP ${formatNumber(
      starterWhip,
    )} vs ${formatNumber(opponentStarterWhip)}, and K-BB% is ${formatNullablePercent(
      starterKbb,
    )} vs ${formatNullablePercent(opponentStarterKbb)}.`,
    `The offense check is ${winner.team.abbreviation} OPS ${formatNumber(
      offenseOps,
      3,
    )} compared with ${opponent.team.abbreviation} OPS ${formatNumber(opponentOps, 3)}. Recent form is ${
      winner.team.abbreviation
    } ${formatSigned(recentRunDiff ?? 0, 2)} runs per game versus ${
      opponent.team.abbreviation
    } ${formatSigned(opponentRecentRunDiff ?? 0, 2)}.`,
    `Bullpen workload also matters: ${winner.team.abbreviation} relievers have thrown ${formatNumber(
      bullpenInnings,
      1,
    )} recent innings versus ${formatNumber(
      opponentBullpenInnings,
      1,
    )} for ${opponent.team.abbreviation}. ${lineupText}`,
  ].join(" ");
}

function edgeFromSigned(value: number | null | undefined): GameWinFactorEdge {
  if (value === null || value === undefined || Math.abs(value) < 0.01) {
    return "neutral";
  }

  return value > 0 ? "home" : "away";
}

function buildSummarySections(input: {
  home: GameWinTeamSnapshot;
  away: GameWinTeamSnapshot;
  features: GameWinFeatureVector;
}) {
  const homeStarterEra = input.home.starter.expected?.expectedEra ?? input.home.starter.season?.era;
  const awayStarterEra = input.away.starter.expected?.expectedEra ?? input.away.starter.season?.era;
  const homeKbb = pitcherKMinusBb(input.home);
  const awayKbb = pitcherKMinusBb(input.away);
  const lineupNote =
    input.home.lineupStatus === "released" && input.away.lineupStatus === "released"
      ? "Lineup edge is based on posted batting orders, handedness mix, and team offense."
      : "Lineup edge is blended with team offense because at least one batting order is not fully posted.";

  return [
    {
      title: "Starting Pitching",
      edge: edgeFromSigned(input.features.starter_quality_diff),
      stats: [
        {
          label: "Starter",
          away: input.away.probablePitcher?.fullName ?? "TBD",
          home: input.home.probablePitcher?.fullName ?? "TBD",
        },
        {
          label: "ERA/xERA",
          away: formatNumber(awayStarterEra),
          home: formatNumber(homeStarterEra),
        },
        {
          label: "WHIP",
          away: formatNumber(input.away.starter.season?.whip),
          home: formatNumber(input.home.starter.season?.whip),
        },
        {
          label: "K-BB%",
          away: formatNullablePercent(awayKbb),
          home: formatNullablePercent(homeKbb),
        },
      ],
      note:
        "Lower ERA/xERA and WHIP are better. Higher K-BB% usually means the starter controls at-bats better.",
    },
    {
      title: "Lineup And Offense",
      edge: edgeFromSigned(input.features.lineup_quality_diff || input.features.offense_ops_diff),
      stats: [
        {
          label: "Lineup",
          away: input.away.lineupStatus,
          home: input.home.lineupStatus,
        },
        {
          label: "Team OPS",
          away: formatNumber(input.away.offense?.ops, 3),
          home: formatNumber(input.home.offense?.ops, 3),
        },
        {
          label: "ISO",
          away: formatNumber(
            input.away.offense?.slg !== null &&
              input.away.offense?.slg !== undefined &&
              input.away.offense?.avg !== null &&
              input.away.offense?.avg !== undefined
              ? input.away.offense.slg - input.away.offense.avg
              : null,
            3,
          ),
          home: formatNumber(
            input.home.offense?.slg !== null &&
              input.home.offense?.slg !== undefined &&
              input.home.offense?.avg !== null &&
              input.home.offense?.avg !== undefined
              ? input.home.offense.slg - input.home.offense.avg
              : null,
            3,
          ),
        },
        {
          label: "Posted bats",
          away: `${input.away.lineupPlayers.length}/9`,
          home: `${input.home.lineupPlayers.length}/9`,
        },
      ],
      note: lineupNote,
    },
    {
      title: "Bullpen And Recent Form",
      edge: edgeFromSigned(
        input.features.bullpen_fatigue_diff + input.features.recent_run_diff_per_game_diff,
      ),
      stats: [
        {
          label: "Recent relief IP",
          away: formatNumber(input.away.bullpen.recentInnings, 1),
          home: formatNumber(input.home.bullpen.recentInnings, 1),
        },
        {
          label: "Back-to-back relievers",
          away: formatNumber(input.away.bullpen.backToBackRelievers, 0),
          home: formatNumber(input.home.bullpen.backToBackRelievers, 0),
        },
        {
          label: "Recent run diff/game",
          away: formatSigned(input.away.recent.runDifferentialPerGame ?? 0, 2),
          home: formatSigned(input.home.recent.runDifferentialPerGame ?? 0, 2),
        },
        {
          label: "Recent record",
          away: `${input.away.recent.wins}-${input.away.recent.losses}`,
          home: `${input.home.recent.wins}-${input.home.recent.losses}`,
        },
      ],
      note:
        "Lower recent bullpen workload helps. Recent form is included, but it is weighted lightly so small samples do not dominate.",
    },
  ];
}

function factorDetail(feature: GameWinFeatureName, value: number, home: GameWinTeamSnapshot, away: GameWinTeamSnapshot) {
  switch (feature) {
    case "starter_quality_diff":
      return `${home.team.abbreviation} starter indicators grade ${formatSigned(value)} better after ERA/WHIP/K-BB/xERA blend.`;
    case "bullpen_fatigue_diff":
      return value >= 0
        ? `${away.team.abbreviation} bullpen projects more taxed recently, giving ${home.team.abbreviation} a freshness edge.`
        : `${home.team.abbreviation} bullpen projects more taxed recently, giving ${away.team.abbreviation} a freshness edge.`;
    case "lineup_quality_diff":
      return value >= 0
        ? `${home.team.abbreviation} has the better lineup/platoon setup from posted bats or team fallback.`
        : `${away.team.abbreviation} has the better lineup/platoon setup from posted bats or team fallback.`;
    case "offense_ops_diff":
      return `${home.team.abbreviation} team OPS minus ${away.team.abbreviation} team OPS is ${formatSigned(value, 3)}.`;
    case "defense_oaa_diff":
      return `${home.team.abbreviation} Statcast defense OAA minus ${away.team.abbreviation} is ${formatSigned(value, 1)}.`;
    case "recent_run_diff_per_game_diff":
      return `Recent run differential gap is ${formatSigned(value, 2)} runs per game.`;
    case "critical_missing_count":
      return `${value.toFixed(0)} critical inputs are missing or unconfirmed, which lowers confidence.`;
    default:
      return `${featureLabel(feature)} moved the home win logit by ${formatSigned(value, 2)} before probability conversion.`;
  }
}

function buildFactors(
  prediction: GameWinModelPrediction,
  home: GameWinTeamSnapshot,
  away: GameWinTeamSnapshot,
): GameWinFactor[] {
  return prediction.topContributors
    .filter((entry) => Math.abs(entry.contribution) > 0.01)
    .slice(0, 6)
    .map((entry) => ({
      factor: featureLabel(entry.feature),
      edge:
        entry.contribution > 0.015
          ? "home"
          : entry.contribution < -0.015
            ? "away"
            : "neutral",
      impact: entry.contribution,
      detail: factorDetail(entry.feature, entry.value, home, away),
    }));
}

function buildWarnings(input: {
  game: GameSummary;
  home: GameWinTeamSnapshot;
  away: GameWinTeamSnapshot;
  venueMissing: boolean;
  weatherMissing: boolean;
  modelType: "trained" | "fallback";
  sourceWarnings: string[];
}) {
  const warnings: string[] = [...input.sourceWarnings];

  if (!input.home.probablePitcher) {
    warnings.push("Home probable starter is not confirmed; starter edge uses neutral fallback.");
  }
  if (!input.away.probablePitcher) {
    warnings.push("Away probable starter is not confirmed; starter edge uses neutral fallback.");
  }
  if (input.home.lineupStatus !== "released" || input.away.lineupStatus !== "released") {
    warnings.push("Lineups are not fully confirmed; lineup matchup uses team-level fallback where needed.");
  }
  if (input.home.bullpen.fatigueScore === null || input.away.bullpen.fatigueScore === null) {
    warnings.push("Recent bullpen usage was unavailable for at least one team.");
  }
  if (input.venueMissing) {
    warnings.push("Venue geometry was unavailable; park factor was neutralized.");
  }
  if (input.weatherMissing) {
    warnings.push("Weather feed unavailable; weather factor was omitted.");
  }
  if (input.modelType === "fallback") {
    warnings.push("No trained game-win artifact found; using transparent fallback model.");
  }

  return warnings;
}

export async function buildGameWinPrediction(
  gamePk: number,
): Promise<GameWinPredictionResult> {
  const season = currentSeason();
  const sourceWarnings: string[] = [];
  const game = await getGameByPk(gamePk, season);

  if (!game) {
    throw new Error("Game not found.");
  }

  const [lineupStatus, venue] = await Promise.all([
    safeSource(
      "MLB live lineup feed",
      getGameLineupStatus(gamePk),
      {
        status: "pending" as const,
        homeCount: 0,
        awayCount: 0,
        totalCount: 0,
        homePlayers: [],
        awayPlayers: [],
      },
      sourceWarnings,
    ),
    safeSource(
      "MLB venue metadata",
      getVenueById(game.venue.id, season),
      null,
      sourceWarnings,
    ),
  ]);
  const weather = venue
    ? await safeSource("Open-Meteo weather", getGameWeather(venue, game.gameDate), null, sourceWarnings)
    : null;
  const externalContext = await safeSource(
    "External enrichment providers",
    buildExternalContext({
      game,
      venue,
      lineupStatus: lineupStatus.status,
    }),
    null,
    sourceWarnings,
  );
  if (externalContext && externalContext.features.externalDataCompletenessScore < 0.65) {
    sourceWarnings.push("External enrichment was incomplete; prediction confidence is reduced.");
  }
  const previousSeriesGames = await safeSource(
    "Previous games in this series",
    getPreviousSeriesGames({
      homeTeamId: game.homeTeam.id,
      awayTeamId: game.awayTeam.id,
      beforeDate: game.officialDate,
      season,
    }),
    [],
    sourceWarnings,
  );
  const gameWithContext = {
    ...game,
    lineupStatus,
    weather,
  };
  const [home, away] = await Promise.all([
    buildTeamSnapshot({
      game: gameWithContext,
      team: game.homeTeam,
      side: "home",
      probablePitcher: game.homeProbablePitcher,
      lineupStatus,
      season,
      sourceWarnings,
    }),
    buildTeamSnapshot({
      game: gameWithContext,
      team: game.awayTeam,
      side: "away",
      probablePitcher: game.awayProbablePitcher,
      lineupStatus,
      season,
      sourceWarnings,
    }),
  ]);
  const features: GameWinFeatureVector = buildGameWinFeatureVector({
    game: gameWithContext,
    home,
    away,
    venue,
    weather,
    externalContext,
  });
  const prediction = predictGameWinner(features);
  const homeWinProbability = prediction.homeWinProbability;
  const awayWinProbability = 1 - homeWinProbability;
  const predictedWinner = homeWinProbability >= 0.5 ? game.homeTeam : game.awayTeam;
  const confidence = confidenceFromProbability(
    homeWinProbability,
    features.critical_missing_count,
  );
  const analysisSummary = buildAnalysisSummary({
    predictedWinner,
    homeWinProbability,
    awayWinProbability,
    home,
    away,
    confidence,
    features,
  });
  const summarySections = buildSummarySections({
    home,
    away,
    features,
  });

  return {
    predictionId: `${gamePk}-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    modelVersion: prediction.modelVersion,
    modelType: prediction.modelType,
    methodology: {
      dataSources: [
        "MLB StatsAPI schedule, probable pitchers, team season stats, lineups, recent results, and bullpen usage",
        "Baseball Savant expected pitcher stats and team defense metrics",
        "Venue geometry and Open-Meteo game-time weather",
        "Optional ESPN Site/Core, Nominatim, Open-Meteo historical/forecast, and Sunrise-Sunset enrichment",
        "Local trained artifact when available, otherwise transparent deterministic fallback weights",
      ],
    },
    dataFreshness: {
      generatedAt: new Date().toISOString(),
      gameStatus: game.status,
      lineupStatus: lineupStatus.status,
      weatherForecastTime: weather?.forecastTime ?? null,
    },
    game: gameWithContext,
    homeTeam: home,
    awayTeam: away,
    homeWinProbability: clamp(homeWinProbability, 0.03, 0.97),
    awayWinProbability: clamp(awayWinProbability, 0.03, 0.97),
    predictedWinner,
    confidence,
    analysisSummary,
    summarySections,
    topFactors: buildFactors(prediction, home, away),
    warnings: buildWarnings({
      game,
      home,
      away,
      venueMissing: !venue,
      weatherMissing: !weather,
      modelType: prediction.modelType,
      sourceWarnings,
    }),
    features,
    previousSeriesGames,
    externalContext,
  };
}
