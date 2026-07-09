"use client";

import Image from "next/image";
import Link from "next/link";
import {
  type KeyboardEvent,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  type AnalysisMarket,
  type AnalysisResult,
  type GameSummary,
  type GameWinPredictionResult,
  type LineupComparisonResult,
  type PlayerSearchResult,
} from "@/lib/types";
import { type AnalystPredictionResult } from "@/lib/analyst/types";
import { normalizeAmericanOddsInput } from "@/lib/odds-math";
import { type PredictionExplanation } from "@/lib/prediction/explanation-builder";

type SearchResponse = {
  players: PlayerSearchResult[];
  error?: string;
};

type GamesResponse = {
  games: GameSummary[];
  error?: string;
};

type GameWinPredictionResponse = GameWinPredictionResult & { error?: string };
type AnalysisResponse = AnalysisResult & {
  analystEngine?: AnalystPredictionResult | null;
  explainability?: PredictionExplanation | null;
};

type FeedbackRating = "correct" | "too_high" | "too_low";
type ColorTheme = "light" | "dark";

type ParlayLeg = {
  id: string;
  name: string;
  batSide: string | null;
  team: string | null;
  label: string;
  probability: number | null;
};

const THEME_STORAGE_KEY = "mlb-analyst-theme";
const THEME_CHANGE_EVENT = "mlb-analyst-theme-change";
const PARLAY_FLOATING_BREAKPOINT_QUERY = "(max-width: 1600px)";
const SCHEDULE_REFRESH_MS = 2 * 60 * 1000;
const DRAFTKINGS_TOOLTIP_TEXT =
  "Optional. DraftKings only. If you enter a line here, it will be used automatically in the analysis.";

function getInitialParlayCollapsed() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.matchMedia(PARLAY_FLOATING_BREAKPOINT_QUERY).matches;
}

function getStoredTheme(): ColorTheme {
  if (typeof window === "undefined") {
    return "dark";
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === "dark" || storedTheme === "light" ? storedTheme : "dark";
}

function subscribeToThemeChanges(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(THEME_CHANGE_EVENT, callback);

  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(THEME_CHANGE_EVENT, callback);
  };
}

function setStoredTheme(theme: ColorTheme) {
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

function formatPercent(value: number, digits = 0) {
  return `${(value * 100).toFixed(digits)}%`;
}

function formatAmericanOdds(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "n/a";
  }

  return value > 0 ? `+${value}` : String(value);
}

function formatSignedPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined) {
    return "n/a";
  }

  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function displayedMarketProbability(analyst: AnalystPredictionResult | null | undefined) {
  return analyst?.noVigMarketProbability ?? analyst?.sportsbookImpliedProbability ?? null;
}

function valueToneClass(valueRating: string | null | undefined) {
  if (valueRating === "strong positive value" || valueRating === "positive value") {
    return "positive";
  }
  if (valueRating === "overpriced" || valueRating === "bad value") {
    return "negative";
  }
  if (valueRating === "no odds available") {
    return "unavailable";
  }
  if (valueRating === "fair/no clear edge") {
    return "neutral";
  }

  return "neutral";
}

function formatPercentMaybe(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined) {
    return "n/a";
  }

  return formatPercent(value, digits);
}

function oddsSummaryText(analyst: AnalystPredictionResult) {
  if (analyst.manualOdds) {
    return `The model projects this hitter at ${formatPercent(analyst.predictedProbability, 1)}. The manually entered ${analyst.manualOdds.sportsbook ?? "sportsbook"} line of ${formatAmericanOdds(analyst.manualOdds.normalizedOdds)} implies ${formatPercent(analyst.manualOdds.impliedProbability, 1)}, leaving an estimated ${formatSignedPercent(analyst.manualOdds.edge, 1)} edge.`;
  }

  if (analyst.sportsbookOdds === null || analyst.sportsbookOdds === undefined) {
    return "No sportsbook odds entered. Add odds manually to calculate edge and value against the model.";
  }

  return `Model: ${formatPercent(analyst.predictedProbability, 1)} | Market: ${formatPercent(displayedMarketProbability(analyst) ?? analyst.sportsbookImpliedProbability ?? 0, 1)} | Fair odds: ${formatAmericanOdds(analyst.fairOdds)} | Sportsbook: ${formatAmericanOdds(analyst.sportsbookOdds)} | Edge: ${formatSignedPercent(analyst.edgeIfAvailable, 1)}`;
}

function formatOptionalNumber(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined) {
    return "n/a";
  }

  return value.toFixed(digits);
}

function formatOptionalTemperature(value: number | null | undefined) {
  return value === null || value === undefined ? "Weather n/a" : `${value.toFixed(0)}F`;
}

function getExternalBadges(
  externalContext: GameWinPredictionResult["externalContext"] | AnalysisResult["externalContext"],
) {
  if (!externalContext) {
    return ["External context unavailable"];
  }

  return [
    externalContext.weather
      ? `${formatOptionalTemperature(externalContext.weather.temperatureF)} weather`
      : "Weather n/a",
    externalContext.daylight?.isTwilightStart
      ? "Twilight start"
      : externalContext.daylight?.isDayGame
        ? "Day start"
        : externalContext.daylight?.isNightGame
          ? "Night start"
          : "Daylight n/a",
    externalContext.odds?.marketImpliedHomeWinProb
      ? `Market home ${formatPercent(externalContext.odds.marketImpliedHomeWinProb)}`
      : "Market n/a",
    `Enrichment ${(externalContext.features.externalDataCompletenessScore * 100).toFixed(0)}%`,
  ];
}

function formatShortDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(parsed);
}

function getMarketLabel(market: AnalysisMarket) {
  if (market === "home_run") {
    return "Home Run";
  }
  if (market === "hit_2_plus") {
    return "2+ Hits";
  }
  return "Hit";
}


function getPitchHandLabel(hand: string | null | undefined) {
  if (hand === "L") {
    return "Left-handed";
  }

  if (hand === "R") {
    return "Right-handed";
  }

  return "Unknown";
}

function formatBatSideNotation(hand: string | null | undefined) {
  if (hand === "L" || hand === "R" || hand === "S") {
    return `(${hand})`;
  }

  return "";
}

function formatPlayerNameWithBatSide(player: Pick<PlayerSearchResult, "fullName" | "batSide">) {
  const notation = formatBatSideNotation(player.batSide);

  return notation ? `${player.fullName} ${notation}` : player.fullName;
}

function buildGameLabel(game: GameSummary) {
  const awayPitcher = formatPitcherDisplay(game.awayProbablePitcher);
  const homePitcher = formatPitcherDisplay(game.homeProbablePitcher);

  return `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation} | ${awayPitcher} vs ${homePitcher}`;
}

function formatPitcherName(name: string | null | undefined) {
  return name?.trim() || "TBD";
}

function formatPitcherDisplay(
  pitcher: GameSummary["awayProbablePitcher"] | GameSummary["homeProbablePitcher"],
) {
  const name = formatPitcherName(pitcher?.fullName);
  const hand = pitcher?.pitchHand;

  if (hand === "L" || hand === "R") {
    return `${name} (${hand})`;
  }

  return name;
}

function formatGameType(dayNight: string | null) {
  if (!dayNight) {
    return "Game Type TBD";
  }

  return `${dayNight.charAt(0).toUpperCase()}${dayNight.slice(1).toLowerCase()} Game`;
}

function getScheduleWeatherLabel(game: GameSummary) {
  const condition = game.weather?.condition ?? "unknown";
  const temperature =
    game.weather?.temperatureF !== null && game.weather?.temperatureF !== undefined
      ? `${game.weather.temperatureF.toFixed(0)}F`
      : null;

  const conditionLabel =
    condition === "sunny"
      ? "Sunny"
      : condition === "cloudy"
        ? "Cloudy"
        : condition === "rainy"
          ? "Rainy"
          : "Weather TBD";

  return temperature ? `${conditionLabel} · ${temperature}` : conditionLabel;
}

function getScheduleWeatherClass(game: GameSummary) {
  return `weather-${game.weather?.condition ?? "unknown"}`;
}

function getLineupStatusLabel(game: GameSummary) {
  const status = game.lineupStatus?.status ?? "pending";

  if (status === "released") {
    return "Lineup Released";
  }

  if (status === "partial") {
    return `Partial Lineup ${game.lineupStatus?.totalCount ?? 0}/18`;
  }

  return "Lineup Pending";
}

function canShowLineup(game: GameSummary) {
  return (game.lineupStatus?.totalCount ?? 0) > 0;
}

function isInProgressGame(game: GameSummary) {
  const status = game.status.toLowerCase();

  return (
    status.includes("progress") ||
    status.includes("live") ||
    status.includes("warmup") ||
    status.includes("delayed") ||
    status.includes("suspended") ||
    status.includes("top ") ||
    status.includes("bottom ") ||
    status.includes("middle ") ||
    status.includes("end ")
  );
}

function hasGameScore(game: GameSummary) {
  return (
    game.homeScore !== null &&
    game.homeScore !== undefined &&
    game.awayScore !== null &&
    game.awayScore !== undefined
  );
}

function getGameWinner(game: GameSummary) {
  if (
    game.homeScore === null ||
    game.homeScore === undefined ||
    game.awayScore === null ||
    game.awayScore === undefined ||
    game.homeScore === game.awayScore
  ) {
    return null;
  }

  return game.homeScore > game.awayScore ? "home" : "away";
}

function buildTeamLogoUrl(teamId: number) {
  return `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
}

function buildPlayerHeadshotUrl(playerId: number) {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/w_220,h_220,c_pad,b_auto,q_auto:best/v1/people/${playerId}/headshot/67/current`;
}

function getAnalysisTone(result: Pick<AnalysisResult, "recommendation">) {
  return result.recommendation === "good play"
    ? "positive"
    : result.recommendation === "avoid"
      ? "negative"
      : "neutral";
}

function buildPlayerCardReason(result: AnalysisResult) {
  const pitcherName = result.pitcher.player?.fullName ?? "the listed probable pitcher";
  const chanceText =
    result.recommendation === "good play"
      ? "The model sees this as one of the better bats on the board."
      : result.recommendation === "avoid"
        ? "The model is cautious here and does not see enough support for the play."
        : "The model sees a playable but not standout setup.";
  const lineupText = result.hitter.lineupSlot
    ? `He is projected to hit from the ${result.hitter.lineupSlot} spot, which shapes how many chances he should get.`
    : "The lineup spot is not fully confirmed, so the model is less aggressive.";
  const pitcherText = result.pitcher.player
    ? `It compares his bat profile against ${pitcherName}'s handedness, contact allowed, and pitch mix.`
    : "The opposing starter is not fully confirmed, so the pitcher part of the read is more conservative.";
  const recentFactor = result.factors.find((factor) => factor.label === "Last 5 games");
  const recentText =
    recentFactor?.impact === "positive"
      ? "Recent form is helping the projection."
      : recentFactor?.impact === "negative"
        ? "Recent form is holding the projection down a bit."
        : "Recent form is treated as mostly neutral.";

  return `${chanceText} ${lineupText} ${pitcherText} ${recentText}`;
}

function getPlainFactorDetail(factor: AnalysisResult["factors"][number]) {
  if (factor.label === "ML model") {
    return "The trained model blended the matchup signals and produced the final probability.";
  }
  if (factor.label === "Hitter baseline" || factor.label === "Power baseline") {
    return factor.impact === "positive"
      ? "The hitter's usual profile is stronger than an average player for this outcome."
      : factor.impact === "negative"
        ? "The hitter's usual profile is weaker than an average player for this outcome."
        : "The hitter's baseline looks close to league average.";
  }
  if (factor.label.includes("Pitcher")) {
    return factor.impact === "positive"
      ? "The opposing pitcher gives this hitter a matchup boost."
      : factor.impact === "negative"
        ? "The opposing pitcher makes this matchup tougher."
        : "The pitcher matchup is close to neutral.";
  }
  if (factor.label === "Pitch mix fit") {
    return factor.impact === "positive"
      ? "The hitter matches up well with the pitches he is likely to see."
      : factor.impact === "negative"
        ? "The pitch mix creates some risk for this hitter."
        : "The pitch mix does not strongly move the projection.";
  }
  if (factor.label === "Last 5 games") {
    return factor.impact === "positive"
      ? "Recent games are helping the read."
      : factor.impact === "negative"
        ? "Recent games are dragging the read down."
        : "Recent games are not changing the read much.";
  }
  if (factor.label === "Projected chances") {
    return "Lineup spot and game context estimate how many times he should come to the plate.";
  }

  return factor.impact === "positive"
    ? "This part of the matchup helps the projection."
    : factor.impact === "negative"
      ? "This part of the matchup hurts the projection."
      : "This part of the matchup is mostly neutral.";
}

function formatConfidenceLabel(confidence: string) {
  return `${confidence.charAt(0).toUpperCase()}${confidence.slice(1)} Confidence`;
}

function ConfidenceLabel({ confidence }: { confidence: string }) {
  return (
    <span
      className="confidence-label"
      tabIndex={0}
      title="This is the model's confidence in the reliability of its projection, not certainty that the player will get a hit, hit a home run, or that the team will win."
      aria-label={`${formatConfidenceLabel(confidence)}. This is the model's confidence in the reliability of its projection, not certainty that the outcome will happen.`}
    >
      {formatConfidenceLabel(confidence)}
    </span>
  );
}

function formatGameTime(gameDate: string) {
  const date = new Date(gameDate);

  if (Number.isNaN(date.getTime())) {
    return "TBD";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function formatScheduleDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(parsed);
}

function shiftIsoDate(date: string, offsetDays: number) {
  const parsed = new Date(`${date}T12:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  parsed.setDate(parsed.getDate() + offsetDays);
  return parsed.toISOString().slice(0, 10);
}

function formatScheduleOptionDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(parsed);
}

function formatRefreshTime(value: string | null) {
  if (!value) {
    return "not refreshed yet";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function getPreviousResultLabel(
  rating: NonNullable<AnalysisResult["previousModelResult"]>["rating"],
) {
  if (rating === "correct") {
    return "Correct";
  }

  if (rating === "too_high") {
    return "Too optimistic";
  }

  if (rating === "too_low") {
    return "Too pessimistic";
  }

  if (rating === "pending") {
    return "Awaiting final boxscore";
  }

  return "No previous result";
}

function getPreviousResultMarker(
  rating: NonNullable<AnalysisResult["previousModelResult"]>["rating"],
) {
  if (rating === "correct") {
    return "✅";
  }

  if (rating === "too_high" || rating === "too_low") {
    return "❌";
  }

  return null;
}

export function MlbAnalystApp({ defaultDate }: { defaultDate: string }) {
  const resultsRef = useRef<HTMLElement | null>(null);
  const analysisDetailRef = useRef<HTMLDivElement | null>(null);
  const skipNextResultsScrollRef = useRef(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [players, setPlayers] = useState<PlayerSearchResult[]>([]);
  const [activePlayerIndex, setActivePlayerIndex] = useState(-1);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerSearchResult | null>(null);
  const [selectedDate, setSelectedDate] = useState(defaultDate);
  const [selectedMarket, setSelectedMarket] = useState<AnalysisMarket>("hit");
  const [games, setGames] = useState<GameSummary[]>([]);
  const [scheduleUpdatedAt, setScheduleUpdatedAt] = useState<string | null>(null);
  const [selectedGamePk, setSelectedGamePk] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [lineupDetailAnalysis, setLineupDetailAnalysis] =
    useState<AnalysisResponse | null>(null);
  const [lineupComparison, setLineupComparison] = useState<LineupComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isComparingLineup, setIsComparingLineup] = useState(false);
  const [gameWinnerLoadingPk, setGameWinnerLoadingPk] = useState<number | null>(null);
  const [gameWinPredictions, setGameWinPredictions] = useState<
    Record<number, GameWinPredictionResult>
  >({});
  const [selectedGameWinPrediction, setSelectedGameWinPrediction] =
    useState<GameWinPredictionResult | null>(null);
  const [detailLoadingPlayerId, setDetailLoadingPlayerId] = useState<number | null>(null);
  const [pendingDetailScrollId, setPendingDetailScrollId] = useState<string | null>(null);
  const [isAuditingOutcomes, setIsAuditingOutcomes] = useState(false);
  const [showModelDetails, setShowModelDetails] = useState(false);
  const [manualOddsInput, setManualOddsInput] = useState("");
  const [showScheduleMenu, setShowScheduleMenu] = useState(false);
  const [showScheduleOverlay, setShowScheduleOverlay] = useState(false);
  const [showScheduleDateMenu, setShowScheduleDateMenu] = useState(false);
  const [expandedLineupGamePk, setExpandedLineupGamePk] = useState<number | null>(null);
  const colorTheme = useSyncExternalStore(
    subscribeToThemeChanges,
    getStoredTheme,
    () => "light",
  );
  const [lineupComparisonMarket, setLineupComparisonMarket] =
    useState<AnalysisMarket | null>(null);
  const [parlayPlayers, setParlayPlayers] = useState<ParlayLeg[]>([]);
  const [isParlayCollapsed, setIsParlayCollapsed] = useState(getInitialParlayCollapsed);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackImage, setFeedbackImage] = useState<File | null>(null);
  const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null);
  const analysisId = analysis?.analysisId ?? null;
  const lineupComparisonId = lineupComparison?.generatedAt ?? null;
  const hasResults = Boolean(analysisId || lineupComparison?.topPick || selectedGameWinPrediction);

  useEffect(() => {
    document.documentElement.dataset.theme = colorTheme;
  }, [colorTheme]);

  useEffect(() => {
    const floatingParlayQuery = window.matchMedia(PARLAY_FLOATING_BREAKPOINT_QUERY);

    function syncParlayLayout(event: MediaQueryListEvent) {
      setIsParlayCollapsed(event.matches);
    }

    floatingParlayQuery.addEventListener("change", syncParlayLayout);
    return () => floatingParlayQuery.removeEventListener("change", syncParlayLayout);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPlayers() {
      if (
        selectedPlayer &&
        deferredQuery.trim().toLowerCase() === selectedPlayer.fullName.toLowerCase()
      ) {
        setPlayers([]);
        setActivePlayerIndex(-1);
        setIsSearching(false);
        return;
      }

      if (deferredQuery.trim().length < 2) {
        setPlayers([]);
        setActivePlayerIndex(-1);
        return;
      }

      setIsSearching(true);

      try {
        const response = await fetch(
          `/api/players/search?q=${encodeURIComponent(deferredQuery.trim())}`,
          {
            signal: controller.signal,
          },
        );
        const data = (await response.json()) as SearchResponse;

        if (!response.ok) {
          throw new Error(data.error ?? "Unable to load players.");
        }

        setPlayers(data.players);
        setActivePlayerIndex(data.players.length > 0 ? 0 : -1);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error ? loadError.message : "Unable to load players.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }

    void loadPlayers();
    return () => controller.abort();
  }, [deferredQuery, selectedPlayer]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadGames(options: { silent?: boolean } = {}) {
      try {
        const response = await fetch(
          `/api/games?date=${encodeURIComponent(selectedDate)}`,
          {
            signal: controller.signal,
          },
        );
        const data = (await response.json()) as GamesResponse;

        if (!response.ok) {
          throw new Error(data.error ?? "Unable to load games.");
        }

        setGames(data.games);
        setScheduleUpdatedAt(new Date().toISOString());
        setSelectedGamePk((current) => {
          const currentStillExists = data.games.some((game) => game.gamePk === current);
          if (currentStillExists) {
            return current;
          }

          if (selectedPlayer?.currentTeamId) {
            const matchingGame = data.games.find(
              (game) =>
                game.homeTeam.id === selectedPlayer.currentTeamId ||
                game.awayTeam.id === selectedPlayer.currentTeamId,
            );

            if (matchingGame) {
              return matchingGame.gamePk;
            }
          }

          return null;
        });
      } catch (loadError) {
        if (!controller.signal.aborted && !options.silent) {
          setError(
            loadError instanceof Error ? loadError.message : "Unable to load games.",
          );
        }
      }
    }

    void loadGames();
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") {
        void loadGames({ silent: true });
      }
    }, SCHEDULE_REFRESH_MS);

    return () => {
      window.clearInterval(refreshTimer);
      controller.abort();
    };
  }, [selectedDate, selectedPlayer]);

  useEffect(() => {
    if (isAnalyzing || isComparingLineup || pendingDetailScrollId) {
      return;
    }

    if (!hasResults) {
      return;
    }

    if (skipNextResultsScrollRef.current) {
      skipNextResultsScrollRef.current = false;
      return;
    }

    const scrollTimer = window.setTimeout(() => {
      resultsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 140);

    return () => window.clearTimeout(scrollTimer);
  }, [
    analysisId,
    hasResults,
    isAnalyzing,
    isComparingLineup,
    lineupComparisonId,
    pendingDetailScrollId,
  ]);

  useEffect(() => {
    if (!showScheduleOverlay && !lineupDetailAnalysis) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [lineupDetailAnalysis, showScheduleOverlay]);

  useEffect(() => {
    if (
      !pendingDetailScrollId ||
      analysisId !== pendingDetailScrollId ||
      detailLoadingPlayerId !== null
    ) {
      return;
    }

    const scrollTimer = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        const detailSection = analysisDetailRef.current;

        if (detailSection) {
          const topOffset = 18;
          const targetTop =
            detailSection.getBoundingClientRect().top + window.scrollY - topOffset;

          window.scrollTo({
            top: Math.max(0, targetTop),
            behavior: "smooth",
          });
        }

        skipNextResultsScrollRef.current = true;
        setPendingDetailScrollId(null);
      });
    }, 120);

    return () => window.clearTimeout(scrollTimer);
  }, [analysisId, detailLoadingPlayerId, pendingDetailScrollId]);

  useEffect(() => {
    if (!analysis) {
      return;
    }

    const currentInput = manualOddsInput.trim();
    const appliedInput = analysis.analystEngine?.manualOdds?.originalInput?.trim() ?? "";

    if (currentInput === appliedInput) {
      return;
    }

    if (!currentInput && !analysis.analystEngine?.manualOdds) {
      return;
    }

    const parsedManualOdds = currentInput ? normalizeAmericanOddsInput(currentInput) : null;

    if (
      parsedManualOdds &&
      (!parsedManualOdds.ok || (parsedManualOdds.value.sportsbook && parsedManualOdds.value.sportsbook !== "DraftKings"))
    ) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch("/api/analyze", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              playerId: analysis.hitter.player.id,
              gamePk: analysis.game.gamePk,
              market: analysis.market,
              ...(parsedManualOdds?.ok
                ? {
                    manualOdds: parsedManualOdds.value.originalInput,
                    sportsbookOdds: parsedManualOdds.value.normalizedOdds,
                    sportsbook: "DraftKings",
                  }
                : {}),
            }),
          });

          const data = (await response.json()) as AnalysisResult & { error?: string };

          if (!response.ok) {
            throw new Error(data.error ?? "Unable to refresh analysis.");
          }

          if (!cancelled) {
            setAnalysis(data);
          }
        } catch (refreshError) {
          if (!cancelled) {
            setError(
              refreshError instanceof Error
                ? refreshError.message
                : "Unable to refresh analysis.",
            );
          }
        }
      })();
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [analysis, manualOddsInput]);

  function selectPlayer(player: PlayerSearchResult) {
    setSelectedPlayer(player);
    setQuery(player.fullName);
    setPlayers([]);
    setActivePlayerIndex(-1);
    clearActiveResults();
  }

  function resolveManualOddsPayload() {
    const rawInput = manualOddsInput.trim();

    if (!rawInput) {
      return {
        ok: true as const,
        value: null,
      };
    }

    const parsed = normalizeAmericanOddsInput(rawInput);

    if (!parsed.ok) {
      return parsed;
    }

    if (parsed.value.sportsbook && parsed.value.sportsbook !== "DraftKings") {
      return {
        ok: false as const,
        error: "Only DraftKings manual odds are supported right now.",
        originalInput: parsed.value.originalInput,
      };
    }

    return {
      ok: true as const,
      value: {
        manualOdds: parsed.value.originalInput,
        sportsbookOdds: parsed.value.normalizedOdds,
        sportsbook: "DraftKings",
      },
    };
  }

  function clearActiveResults() {
    setAnalysis(null);
    setLineupDetailAnalysis(null);
    setLineupComparison(null);
    setSelectedGameWinPrediction(null);
  }

  function addLegToParlay(player: ParlayLeg) {
    setParlayPlayers((current) => {
      if (current.some((entry) => entry.id === player.id)) {
        return current;
      }

      return [...current, player];
    });
  }

  function removePlayerFromParlay(playerId: string) {
    setParlayPlayers((current) => current.filter((player) => player.id !== playerId));
  }

  function addAnalysisToParlay(result: AnalysisResult) {
    addLegToParlay({
      id: `player:${result.hitter.player.id}:${result.game.gamePk}:${result.market}`,
      name: result.hitter.player.fullName,
      batSide: result.hitter.player.batSide,
      team: result.hitter.player.currentTeamAbbreviation,
      label: getMarketLabel(result.market),
      probability: result.probabilities.atLeastOne,
    });
  }

  function addGameWinnerToParlay(result: GameWinPredictionResult, side: "away" | "home") {
    const team = side === "home" ? result.homeTeam.team : result.awayTeam.team;
    const probability =
      side === "home" ? result.homeWinProbability : result.awayWinProbability;

    addLegToParlay({
      id: `team-win:${result.game.gamePk}:${side}`,
      name: `${team.abbreviation} Win`,
      batSide: null,
      team: team.name,
      label: "Win",
      probability,
    });
  }

  async function showLineupPlayerDetails(result: AnalysisResult) {
    setDetailLoadingPlayerId(result.hitter.player.id);
    setFeedbackStatus(null);
    setError(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          playerId: result.hitter.player.id,
          gamePk: result.game.gamePk,
          market: result.market,
        }),
      });

      const data = (await response.json()) as AnalysisResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to build player details.");
      }

      setLineupDetailAnalysis(data);
    } catch (detailError) {
      setError(
        detailError instanceof Error
          ? detailError.message
          : "Unable to build player details.",
      );
    } finally {
      setDetailLoadingPlayerId(null);
    }
  }

  function handlePlayerSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (players.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActivePlayerIndex((current) => (current + 1) % players.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActivePlayerIndex((current) =>
        current <= 0 ? players.length - 1 : current - 1,
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      selectPlayer(players[Math.max(0, activePlayerIndex)]);
      return;
    }

    if (event.key === "Escape") {
      setPlayers([]);
      setActivePlayerIndex(-1);
    }
  }

  async function runAnalysisRequest({
    playerId,
    gamePk,
    market,
    clearExisting = false,
    showLoadingState = false,
  }: {
    playerId: number;
    gamePk: number;
    market: AnalysisMarket;
    clearExisting?: boolean;
    showLoadingState?: boolean;
  }) {
    const manualOddsPayload = resolveManualOddsPayload();

    if (!manualOddsPayload.ok) {
      if (showLoadingState) {
        setError(manualOddsPayload.error);
      }
      return;
    }

    if (clearExisting) {
      clearActiveResults();
    }

    if (showLoadingState) {
      setIsAnalyzing(true);
    }

    setError(null);
    setFeedbackStatus(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          playerId,
          gamePk,
          market,
          ...(manualOddsPayload.value ?? {}),
        }),
      });

      const data = (await response.json()) as AnalysisResult & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to build analysis.");
      }

      setAnalysis(data);
      setLineupComparison(null);
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "Unable to build analysis.",
      );
    } finally {
      if (showLoadingState) {
        setIsAnalyzing(false);
      }
    }
  }

  async function analyze() {
    if (!selectedPlayer || !selectedGamePk) {
      return;
    }

    await runAnalysisRequest({
      playerId: selectedPlayer.id,
      gamePk: selectedGamePk,
      market: selectedMarket,
      clearExisting: true,
      showLoadingState: true,
    });
  }

  async function compareLineup(market: AnalysisMarket) {
    if (!selectedGamePk) {
      return;
    }

    const gamePk = selectedGamePk;

    clearActiveResults();
    setIsComparingLineup(true);
    setLineupComparisonMarket(market);
    setError(null);
    setFeedbackStatus(null);

    try {
      const response = await fetch("/api/analyze-lineup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gamePk,
          market,
        }),
      });

      const data = (await response.json()) as LineupComparisonResult & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to compare lineup.");
      }

      setLineupComparison(data);
      setAnalysis(data.topPick);
    } catch (comparisonError) {
      setError(
        comparisonError instanceof Error
          ? comparisonError.message
          : "Unable to compare lineup.",
      );
    } finally {
      setIsComparingLineup(false);
      setLineupComparisonMarket(null);
    }
  }

  async function analyzeGameWinner(gamePk = selectedGamePk) {
    if (!gamePk) {
      return;
    }

    clearActiveResults();
    setGameWinnerLoadingPk(gamePk);
    setError(null);
    setFeedbackStatus(null);

    try {
      const response = await fetch("/api/game-win-prediction", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gamePk,
        }),
      });
      const data = (await response.json()) as GameWinPredictionResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to build winner prediction.");
      }

      setGameWinPredictions((current) => ({
        ...current,
        [gamePk]: data,
      }));
      setSelectedGameWinPrediction(data);
      setSelectedGamePk(gamePk);
      setShowScheduleMenu(false);
    } catch (winnerError) {
      setError(
        winnerError instanceof Error
          ? winnerError.message
          : "Unable to build winner prediction.",
      );
    } finally {
      setGameWinnerLoadingPk(null);
    }
  }

  async function saveFeedback(rating: FeedbackRating) {
    if (!analysis) {
      return;
    }

    try {
      const feedbackPayload = {
        analysisId: analysis.analysisId,
        playerId: String(analysis.hitter.player.id),
        gamePk: String(analysis.game.gamePk),
        market: analysis.market,
        probability: String(analysis.probabilities.atLeastOne),
        recommendation: analysis.recommendation,
        rating,
        notes: feedbackNote,
      };
      const body =
        feedbackImage !== null
          ? (() => {
              const form = new FormData();

              Object.entries(feedbackPayload).forEach(([key, value]) => {
                form.append(key, value);
              });
              form.append("proofImage", feedbackImage);

              return form;
            })()
          : JSON.stringify(feedbackPayload);
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers:
          feedbackImage === null
            ? {
                "Content-Type": "application/json",
              }
            : undefined,
        body,
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Unable to save feedback.");
      }

      setFeedbackStatus(
        feedbackImage
          ? "Feedback and parlay proof saved for future tuning."
          : "Feedback saved for future tuning.",
      );
      setFeedbackNote("");
      setFeedbackImage(null);
    } catch (feedbackError) {
      setFeedbackStatus(
        feedbackError instanceof Error
          ? feedbackError.message
          : "Unable to save feedback.",
      );
    }
  }

  async function auditFinishedGames() {
    setIsAuditingOutcomes(true);
    setFeedbackStatus(null);

    try {
      const response = await fetch("/api/feedback/audit", {
        method: "POST",
      });
      const data = (await response.json()) as {
        added?: number;
        checked?: number;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to check finished games.");
      }

      setFeedbackStatus(
        `Checked ${data.checked ?? 0} saved predictions and added ${
          data.added ?? 0
        } verified outcomes for future tuning.`,
      );
    } catch (auditError) {
      setFeedbackStatus(
        auditError instanceof Error
          ? auditError.message
          : "Unable to check finished games.",
      );
    } finally {
      setIsAuditingOutcomes(false);
    }
  }

  const selectedGame = games.find((game) => game.gamePk === selectedGamePk) ?? null;
  const selectedMarketLabel = getMarketLabel(selectedMarket);
  const recommendationTone = analysis ? getAnalysisTone(analysis) : "neutral";
  const lineupDetailTone = lineupDetailAnalysis
    ? getAnalysisTone(lineupDetailAnalysis)
    : "neutral";
  const isDetailLoading = detailLoadingPlayerId !== null;
  const isGameWinnerLoading = gameWinnerLoadingPk !== null;
  const isModelLoading = isAnalyzing || isComparingLineup || isDetailLoading || isGameWinnerLoading;
  const loadingTitle = isDetailLoading
    ? "Loading Batter Details"
    : isGameWinnerLoading
      ? "Predicting Game Winner"
    : isComparingLineup
      ? "Comparing The Lineup"
      : "Running Matchup Model";
  const loadingMessage = isDetailLoading
    ? "Opening the full matchup view, recent form, and model factors for this player."
    : isGameWinnerLoading
      ? "Blending starters, bullpen freshness, lineups, recent team form, weather, and park context."
    : isComparingLineup
      ? "Ranking the published starters, matchup context, and weather signal."
      : "Checking hitter form, pitcher profile, weather, prior results, and matchup history.";
  const scheduleDateOptions = [-3, -2, -1, 0, 1, 2, 3].map((offset) =>
    shiftIsoDate(selectedDate, offset),
  );

  function changeScheduleDate(date: string) {
    setSelectedDate(date);
    setSelectedGamePk(null);
    setExpandedLineupGamePk(null);
    setShowScheduleDateMenu(false);
    setShowScheduleOverlay(false);
    clearActiveResults();
    setError(null);
  }

  function renderScheduleBoard({ expanded = false }: { expanded?: boolean } = {}) {
    return (
      <>
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Daily Board</p>
            <div className="schedule-title-row">
              <h2>Schedule For {formatScheduleDate(selectedDate)}</h2>
              <div className="schedule-date-picker">
                <button
                  type="button"
                  className="schedule-date-trigger"
                  aria-expanded={showScheduleDateMenu}
                  aria-haspopup="listbox"
                  onClick={(event) => {
                    event.stopPropagation();
                    setShowScheduleDateMenu((current) => !current);
                  }}
                >
                  <span>{formatScheduleOptionDate(selectedDate)}</span>
                  <span aria-hidden="true">v</span>
                </button>
                {showScheduleDateMenu ? (
                  <div className="schedule-date-menu" role="listbox">
                    {scheduleDateOptions.map((date) => (
                      <button
                        key={date}
                        type="button"
                        className={`schedule-date-option${
                          date === selectedDate ? " selected" : ""
                        }`}
                        role="option"
                        aria-selected={date === selectedDate}
                        onClick={(event) => {
                          event.stopPropagation();
                          changeScheduleDate(date);
                        }}
                      >
                        {formatScheduleOptionDate(date)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {!expanded ? (
                <div className="schedule-board-actions">
                  <button
                    type="button"
                    className="schedule-count"
                    onClick={(event) => {
                      event.stopPropagation();
                      setShowScheduleDateMenu(false);
                      setShowScheduleOverlay(true);
                    }}
                    aria-label="Open full schedule board"
                  >
                    <span className="live-dot" aria-hidden="true" />
                    {games.length === 1 ? "1 game" : `${games.length} games`} · live
                    updates · {formatRefreshTime(scheduleUpdatedAt)}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          {expanded ? (
            <div className="schedule-board-actions schedule-overlay-actions">
              <button
                type="button"
                className="schedule-minimize-button"
                onClick={() => setShowScheduleOverlay(false)}
              >
                Minimize
              </button>
            </div>
          ) : null}
        </div>

        {games.length > 0 ? (
          <div className={`schedule-grid${expanded ? " schedule-grid-expanded" : ""}`}>
            {games.map((game) => {
              const isSelected = selectedGamePk === game.gamePk;
              const isLineupExpanded = expandedLineupGamePk === game.gamePk;
              const hasLineup = canShowLineup(game);
              const winPrediction = gameWinPredictions[game.gamePk];
              const isWinPredictionLoading = gameWinnerLoadingPk === game.gamePk;

              return (
                <div
                  key={game.gamePk}
                  className={`schedule-card ${getScheduleWeatherClass(game)}${
                    isSelected ? " selected" : ""
                  }`}
                  onClick={() => {
                    setSelectedGamePk(game.gamePk);
                    clearActiveResults();
                    setError(null);
                    setShowScheduleMenu(false);
                    if (expanded) {
                      setShowScheduleOverlay(false);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedGamePk(game.gamePk);
                      clearActiveResults();
                      setError(null);
                      setShowScheduleMenu(false);
                      if (expanded) {
                        setShowScheduleOverlay(false);
                      }
                    }
                  }}
                  aria-pressed={isSelected}
                >
                  <div className="schedule-card-top">
                    <span className="game-time">{formatGameTime(game.gameDate)}</span>
                    <span className="game-status">{game.status}</span>
                  </div>

                  <div className="matchup-row">
                    <div className="team-lockup">
                      <Image
                        src={buildTeamLogoUrl(game.awayTeam.id)}
                        alt={`${game.awayTeam.name} logo`}
                        width={70}
                        height={70}
                        className="team-logo"
                      />
                      <div>
                        <strong>{game.awayTeam.abbreviation}</strong>
                        <span>{game.awayTeam.name}</span>
                      </div>
                    </div>

                    <span className="versus">@</span>

                    <div className="team-lockup home">
                      <Image
                        src={buildTeamLogoUrl(game.homeTeam.id)}
                        alt={`${game.homeTeam.name} logo`}
                        width={70}
                        height={70}
                        className="team-logo"
                      />
                      <div>
                        <strong>{game.homeTeam.abbreviation}</strong>
                        <span>{game.homeTeam.name}</span>
                      </div>
                    </div>
                  </div>

                  <div className="schedule-meta">
                    <span>{game.venue.name}</span>
                    <span>{formatGameType(game.dayNight)}</span>
                  </div>

                  {hasGameScore(game) ? (
                    <div
                      className={`final-score-strip${isInProgressGame(game) ? " live-score-strip" : ""}`}
                    >
                      <span
                        className={
                          getGameWinner(game) === "away"
                            ? "winner"
                            : getGameWinner(game) === "home"
                              ? "loser"
                              : ""
                        }
                      >
                        {game.awayTeam.abbreviation} {game.awayScore}
                      </span>
                      <span
                        className={
                          getGameWinner(game) === "home"
                            ? "winner"
                            : getGameWinner(game) === "away"
                              ? "loser"
                              : ""
                        }
                      >
                        {game.homeTeam.abbreviation} {game.homeScore}
                      </span>
                    </div>
                  ) : null}

                  <div className="schedule-weather-row">
                    <span className="weather-chip">{getScheduleWeatherLabel(game)}</span>
                    {game.weather?.precipitationProbability !== null &&
                    game.weather?.precipitationProbability !== undefined ? (
                      <span>
                        Rain chance {game.weather.precipitationProbability.toFixed(0)}%
                      </span>
                    ) : null}
                  </div>

                  <div className="probables-row">
                    <span>
                      <strong>Away Starter</strong>
                      {formatPitcherDisplay(game.awayProbablePitcher)}
                    </span>
                    <span>
                      <strong>Home Starter</strong>
                      {formatPitcherDisplay(game.homeProbablePitcher)}
                    </span>
                  </div>

                  <div className="winner-prediction-strip">
                    {winPrediction ? (
                      <div>
                        <span>
                          {winPrediction.awayTeam.team.abbreviation}{" "}
                          {formatPercent(winPrediction.awayWinProbability)}
                        </span>
                        <strong>
                          {winPrediction.predictedWinner.abbreviation}{" "}
                          {formatPercent(
                            Math.max(
                              winPrediction.homeWinProbability,
                              winPrediction.awayWinProbability,
                            ),
                          )}
                        </strong>
                        <span>
                          {winPrediction.homeTeam.team.abbreviation}{" "}
                          {formatPercent(winPrediction.homeWinProbability)}
                        </span>
                      </div>
                    ) : (
                      <span className="muted">Winner probability not loaded</span>
                    )}
                    <button
                      type="button"
                      className="lineup-strip winner-preview-button"
                      disabled={isWinPredictionLoading}
                      onClick={(event) => {
                        event.stopPropagation();
                        void analyzeGameWinner(game.gamePk);
                      }}
                    >
                      {isWinPredictionLoading
                        ? "Loading Win %..."
                        : winPrediction
                          ? "Refresh Win %"
                          : "Show Win %"}
                    </button>
                  </div>

                  <button
                    type="button"
                    className={`lineup-strip lineup-chip-${
                      game.lineupStatus?.status ?? "pending"
                    }`}
                    disabled={!hasLineup}
                    aria-expanded={isLineupExpanded}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!hasLineup) {
                        return;
                      }
                      setExpandedLineupGamePk((current) =>
                        current === game.gamePk ? null : game.gamePk,
                      );
                    }}
                  >
                    {hasLineup
                      ? isLineupExpanded
                        ? "Hide Lineups"
                        : getLineupStatusLabel(game)
                      : getLineupStatusLabel(game)}
                  </button>

                  {isLineupExpanded ? (
                    <div className="lineup-preview" onClick={(event) => event.stopPropagation()}>
                      <div>
                        <strong>{game.awayTeam.abbreviation}</strong>
                        <ol>
                          {(game.lineupStatus?.awayPlayers ?? []).map((player) => (
                            <li key={player.id}>
                              <span>{player.lineupSlot ?? "-"}</span>
                              <span>{formatPlayerNameWithBatSide(player)}</span>
                              <span>{player.primaryPosition ?? ""}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                      <div>
                        <strong>{game.homeTeam.abbreviation}</strong>
                        <ol>
                          {(game.lineupStatus?.homePlayers ?? []).map((player) => (
                            <li key={player.id}>
                              <span>{player.lineupSlot ?? "-"}</span>
                              <span>{formatPlayerNameWithBatSide(player)}</span>
                              <span>{player.primaryPosition ?? ""}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="panel empty-state compact-empty-state">
            <h2>No Games Found</h2>
            <p className="muted">
              Change the game date above to load the schedule for another day.
            </p>
          </div>
        )}
      </>
    );
  }

  return (
    <main className={`shell${isParlayCollapsed ? " parlay-collapsed" : ""}`}>
      <aside
        className={`parlay-builder${isParlayCollapsed ? " collapsed" : ""}`}
        aria-label="Parlay builder"
      >
        <div className="parlay-builder-header">
          <div>
            <span className="field-label">Parlay Builder</span>
            <strong>
              {parlayPlayers.length} leg{parlayPlayers.length === 1 ? "" : "s"}
            </strong>
          </div>
          <div className="parlay-builder-actions">
            <button
              type="button"
              className="parlay-toggle-button"
              aria-label={isParlayCollapsed ? "Open parlay builder" : "Minimize parlay builder"}
              aria-expanded={!isParlayCollapsed}
              onClick={() => setIsParlayCollapsed((current) => !current)}
            >
              {isParlayCollapsed ? parlayPlayers.length || "+" : "Minimize"}
            </button>
            {parlayPlayers.length > 0 ? (
              <button
                type="button"
                className="parlay-clear-button"
                onClick={() => setParlayPlayers([])}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>

        <div className="parlay-builder-body">
          {parlayPlayers.length > 0 ? (
            <>
              <ul className="parlay-list">
                {parlayPlayers.map((player) => (
                  <li key={player.id}>
                    <div>
                      <strong>
                        {formatPlayerNameWithBatSide({
                          fullName: player.name,
                          batSide: player.batSide,
                        })}
                      </strong>
                      <span>
                        {player.team ?? "MLB"}
                        {` · ${player.label} ${
                          player.probability !== null ? formatPercent(player.probability) : ""
                        }`}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${player.name} from parlay builder`}
                      onClick={() => removePlayerFromParlay(player.id)}
                    >
                      x
                    </button>
                  </li>
                ))}
              </ul>

            </>
          ) : (
          <p className="parlay-empty">Add players or team winners to build a shortlist.</p>
          )}
        </div>
      </aside>

      {isModelLoading ? (
        <div className="loading-overlay" role="status" aria-live="polite">
          <div className="loading-card">
            <div className="loading-orbit" aria-hidden="true">
              <span />
            </div>
            <div>
              <p className="eyebrow">{loadingTitle}</p>
              <h2>Building the call</h2>
              <p>{loadingMessage}</p>
            </div>
          </div>
        </div>
      ) : null}

      {showScheduleOverlay ? (
        <div
          className="schedule-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Full schedule board"
        >
          <div className="schedule-overlay-panel">
            {renderScheduleBoard({ expanded: true })}
          </div>
        </div>
      ) : null}

      {lineupDetailAnalysis ? (
        <div
          className="player-detail-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`${lineupDetailAnalysis.hitter.player.fullName} player details`}
        >
          <div className="player-detail-modal">
            <div className="player-detail-modal-header">
              <div>
                <p className="eyebrow">Player Detail</p>
                <h2>{formatPlayerNameWithBatSide(lineupDetailAnalysis.hitter.player)}</h2>
                <span>
                  {lineupDetailAnalysis.marketLabel} ·{" "}
                  {formatPercent(lineupDetailAnalysis.probabilities.atLeastOne)}
                </span>
              </div>
              <button
                type="button"
                className="player-detail-close"
                aria-label="Close player details"
                onClick={() => setLineupDetailAnalysis(null)}
              >
                X
              </button>
            </div>

            <div className="player-detail-modal-body">
              <div className="grid secondary-grid">
                <div className={`panel summary-card summary-lead ${lineupDetailTone}`}>
                  <div className="player-media-stack">
                    <Image
                      src={buildPlayerHeadshotUrl(lineupDetailAnalysis.hitter.player.id)}
                      alt={`${lineupDetailAnalysis.hitter.player.fullName} headshot`}
                      width={132}
                      height={132}
                      className="player-headshot"
                    />
                    <button
                      type="button"
                      className="parlay-add-button"
                      onClick={() => addAnalysisToParlay(lineupDetailAnalysis)}
                      disabled={parlayPlayers.some(
                        (player) =>
                          player.id ===
                          `player:${lineupDetailAnalysis.hitter.player.id}:${lineupDetailAnalysis.game.gamePk}:${lineupDetailAnalysis.market}`,
                      )}
                    >
                      {parlayPlayers.some(
                        (player) =>
                          player.id ===
                          `player:${lineupDetailAnalysis.hitter.player.id}:${lineupDetailAnalysis.game.gamePk}:${lineupDetailAnalysis.market}`,
                      )
                        ? "Added"
                        : "Add To Parlay"}
                    </button>
                  </div>
                  <p className="eyebrow">{lineupDetailAnalysis.recommendation}</p>
                  <div className="player-result-heading">
                    <div>
                      <h2>
                        {formatPlayerNameWithBatSide(lineupDetailAnalysis.hitter.player)}
                      </h2>
                      <span>
                        {lineupDetailAnalysis.hitter.player.currentTeamName ?? "MLB"}
                      </span>
                    </div>
                  </div>
                  <div className="probability">
                    {formatPercent(lineupDetailAnalysis.probabilities.atLeastOne)}
                  </div>
                  <p className="muted">{buildPlayerCardReason(lineupDetailAnalysis)}</p>
                </div>

                <div className="panel summary-card summary-notes">
                  <h2>Previous Model Result</h2>
                  <div className="previous-result-box">
                    {lineupDetailAnalysis.previousModelResult ? (
                      <>
                        <strong>
                          {lineupDetailAnalysis.previousModelResult.date}:{" "}
                          {lineupDetailAnalysis.previousModelResult.probability !== null
                            ? `${lineupDetailAnalysis.previousModelResult.marketLabel} ${formatPercent(
                                lineupDetailAnalysis.previousModelResult.probability,
                              )}`
                            : lineupDetailAnalysis.previousModelResult.marketLabel}
                        </strong>
                        <span>
                          {getPreviousResultLabel(
                            lineupDetailAnalysis.previousModelResult.rating,
                          )}
                          {lineupDetailAnalysis.previousModelResult.actualHits !== null
                            ? ` - ${lineupDetailAnalysis.previousModelResult.actualHits} H, ${lineupDetailAnalysis.previousModelResult.actualHomeRuns} HR, ${lineupDetailAnalysis.previousModelResult.actualAtBats} AB`
                            : ""}
                        </span>
                        <span>
                          {lineupDetailAnalysis.previousModelResult.game
                            ? `${lineupDetailAnalysis.previousModelResult.game.awayTeam.abbreviation} @ ${lineupDetailAnalysis.previousModelResult.game.homeTeam.abbreviation}`
                            : lineupDetailAnalysis.previousModelResult.message}
                        </span>
                      </>
                    ) : (
                      <>
                        <strong>Previous-day result unavailable.</strong>
                        <span>The model kept previous outcome context neutral.</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="panel summary-card matchup-history-card top-matchup-history">
                  <h2>Batter Vs Pitcher</h2>
                  <p className="muted">
                    {lineupDetailAnalysis.batterVsPitcher?.summary ??
                      `${lineupDetailAnalysis.hitter.player.fullName} has not previously faced ${
                        lineupDetailAnalysis.pitcher.player?.fullName ??
                        "the probable pitcher"
                      } in the Statcast sample.`}
                  </p>
                  <ul className="matchup-history-list">
                    <li>
                      <span>Matchup</span>
                      <strong>
                        {lineupDetailAnalysis.hitter.player.fullName} vs{" "}
                        {lineupDetailAnalysis.batterVsPitcher?.pitcherName ??
                          lineupDetailAnalysis.pitcher.player?.fullName ??
                          "TBD"}
                      </strong>
                    </li>
                    <li>
                      <span>Line</span>
                      <strong>
                        {lineupDetailAnalysis.batterVsPitcher
                          ? `${lineupDetailAnalysis.batterVsPitcher.hits} H / ${lineupDetailAnalysis.batterVsPitcher.atBats} AB`
                          : "0 H / 0 AB"}
                      </strong>
                    </li>
                    <li>
                      <span>AVG</span>
                      <strong>
                        {formatOptionalNumber(
                          lineupDetailAnalysis.batterVsPitcher?.battingAverage,
                          3,
                        )}
                      </strong>
                    </li>
                    <li>
                      <span>HR</span>
                      <strong>{lineupDetailAnalysis.batterVsPitcher?.homeRuns ?? 0}</strong>
                    </li>
                  </ul>
                </div>

                <div className="panel summary-card recent-form-card">
                  <h2>Last 5 Games</h2>
                  {lineupDetailAnalysis.hitter.recentGames.length > 0 ? (
                    <div className="recent-game-table">
                      <div className="recent-game-row recent-game-header">
                        <span>Date</span>
                        <span>Opp</span>
                        <span>AB</span>
                        <span>H</span>
                        <span>R</span>
                        <span>RBI</span>
                        <span>HR</span>
                      </div>
                      {lineupDetailAnalysis.hitter.recentGames.map((game) => (
                        <div
                          key={`${game.gamePk ?? game.date}-${game.opponent ?? "opp"}`}
                          className="recent-game-row"
                        >
                          <span>{formatShortDate(game.date)}</span>
                          <span>{game.opponent ?? "MLB"}</span>
                          <strong>{game.atBats}</strong>
                          <strong>{game.hits}</strong>
                          <strong>{game.runs}</strong>
                          <strong>{game.rbi}</strong>
                          <strong>{game.homeRuns}</strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="recent-game-empty">
                      <strong>No recent game log available.</strong>
                      <span>The model kept the last-5 game adjustment neutral.</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="factor-grid">
                {lineupDetailAnalysis.factors.map((factor) => (
                  <div
                    key={factor.label}
                    className={`panel factor-card factor-impact-${factor.impact}`}
                  >
                    <h3>{factor.label}</h3>
                    <div className="factor-value">
                      {factor.impact === "positive"
                        ? "Helps"
                        : factor.impact === "negative"
                          ? "Hurts"
                          : "Neutral"}
                    </div>
                    <p className="factor-detail">{getPlainFactorDetail(factor)}</p>
                  </div>
                ))}
              </div>

              <div className="snapshot-grid">
                <div className="panel snapshot-card">
                  <h3>Hitter Snapshot</h3>
                  <ul className="snapshot-list">
                    <li>
                      2026 AVG: {formatOptionalNumber(lineupDetailAnalysis.hitter.season?.avg, 3)}
                    </li>
                    <li>
                      2026 OPS: {formatOptionalNumber(lineupDetailAnalysis.hitter.season?.ops, 3)}
                    </li>
                    <li>2026 HR: {lineupDetailAnalysis.hitter.season?.homeRuns ?? "n/a"}</li>
                    <li>
                      Lineup slot: {lineupDetailAnalysis.hitter.lineupSlot ?? "not posted"}
                    </li>
                  </ul>
                </div>

                <div className="panel snapshot-card">
                  <h3>Pitcher Snapshot</h3>
                  <ul className="snapshot-list">
                    <li>
                      Pitcher: {lineupDetailAnalysis.pitcher.player?.fullName ?? "TBD"}
                    </li>
                    <li>
                      Throws: {getPitchHandLabel(lineupDetailAnalysis.pitcher.player?.pitchHand)}
                    </li>
                    <li>
                      2026 ERA: {formatOptionalNumber(lineupDetailAnalysis.pitcher.season?.era, 2)}
                    </li>
                    <li>
                      Pitch mix:{" "}
                      {lineupDetailAnalysis.pitcher.pitchMix.length > 0
                        ? lineupDetailAnalysis.pitcher.pitchMix
                            .slice(0, 3)
                            .map((pitch) => `${pitch.label} ${pitch.usage.toFixed(1)}%`)
                            .join(", ")
                        : "not available"}
                    </li>
                  </ul>
                </div>

                <div className="panel snapshot-card">
                  <h3>Venue And Weather</h3>
                  <ul className="snapshot-list">
                    <li>
                      Venue: {lineupDetailAnalysis.venue?.name ?? lineupDetailAnalysis.game.venue.name}
                    </li>
                    <li>
                      Weather: {formatOptionalNumber(lineupDetailAnalysis.weather?.temperatureF, 0)}F
                    </li>
                    <li>
                      Wind: {formatOptionalNumber(lineupDetailAnalysis.weather?.windSpeedMph, 0)} mph
                    </li>
                  </ul>
                </div>

                <div className="panel snapshot-card">
                  <h3>Diagnostics</h3>
                  <ul className="snapshot-list">
                    <li>
                      Hitter sample: {lineupDetailAnalysis.diagnostics.hitterSampleSize} ABs
                    </li>
                    <li>
                      Pitch-mix coverage:{" "}
                      {formatPercent(lineupDetailAnalysis.diagnostics.pitchMixCoverage)}
                    </li>
                    <li>
                      Confidence:{" "}
                      <ConfidenceLabel confidence={lineupDetailAnalysis.confidence} />
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <section className="hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <div className="hero-topline">
              <p className="eyebrow">2026 Live Data + 2025 Stabilization</p>
            </div>
            <h1>MLB Analyst AI</h1>
            <p>
              Type a hitter, choose the game, then choose whether you want a {` `}
              <strong>hit</strong> or <strong>home run</strong> probability. The app pulls
              current 2026 MLB, Statcast, weather, defense, pitch-mix, and lineup
              context, then steadies thin 2026 samples with 2025 carry-over.
            </p>

            <div className="hero-badges">
              <span className="hero-pill">Live MLB + Statcast</span>
              <span className="hero-pill">Hit + HR Markets</span>
              <span className="hero-pill">Weather + Park Context</span>
            </div>
          </div>

          <div className="hero-showcase">
            <div className="hero-card hero-card-primary">
              <span className="hero-card-label">Smart Decision Layer</span>
              <strong>Search a hitter, pick a market, and get a fast matchup call.</strong>
              <p>
                The scoring engine blends current-season signal, previous-game Statcast,
                opponent context, and prior-season stabilization.
              </p>
            </div>

            <div className="hero-card-grid">
              <div className="hero-mini-card">
                <span className="hero-card-label">Data Blend</span>
                <strong>2026 + 2025</strong>
              </div>
              <div className="hero-mini-card">
                <span className="hero-card-label">Outcomes</span>
                <strong>Hit or Homer</strong>
              </div>
              <div className="hero-mini-card">
                <span className="hero-card-label">Inputs</span>
                <strong>Pitcher, weather, park</strong>
              </div>
            </div>

            <div className="hero-action-row hero-showcase-action-row">
              <Link href="/hit-analyst" className="theme-toggle theme-toggle-link">
                MLB Hit Analyst
              </Link>
              <Link href="/keepsakes" className="theme-toggle theme-toggle-link">
                Slip Keepsakes
              </Link>
              <button
                type="button"
                className="theme-toggle"
                aria-pressed={colorTheme === "dark"}
                onClick={() => setStoredTheme(colorTheme === "dark" ? "light" : "dark")}
              >
                {colorTheme === "dark" ? "Day Mode" : "Night Mode"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="analysis-column">
          <div className="panel controls-main panel-command">
          <div className="panel-heading-row">
            <div>
              <h2>Search and Analyze</h2>
              <p className="muted">
                Search a hitter, set the matchup, and run either a player projection or a game-wide tool.
              </p>
            </div>
            <div className="panel-actions">
              <button
                type="button"
                className="ghost-button schedule-toggle"
                aria-expanded={showScheduleMenu}
                onClick={() => setShowScheduleMenu((current) => !current)}
              >
                {showScheduleMenu ? "Hide Schedule" : "Schedule"}
              </button>
              <button
                type="button"
                className="ghost-button"
                aria-expanded={showModelDetails}
                onClick={() => setShowModelDetails((current) => !current)}
              >
                {showModelDetails ? "Hide Details" : "Model Details"}
              </button>
            </div>
          </div>

          {showScheduleMenu ? (
            <div className="schedule-mobile-menu">{renderScheduleBoard()}</div>
          ) : null}

          {showModelDetails ? (
            <div className="model-details-panel">
              <div>
                <h3>Data Sources</h3>
                <ul className="compact-list">
                  <li>MLB StatsAPI schedules, players, probable pitchers, and season stats</li>
                  <li>Baseball Savant expected stats, pitch mix, contact quality, and defense</li>
                  <li>Open-Meteo game-time weather plus venue geometry and park context</li>
                </ul>
              </div>

              <div>
                <h3>Model Logic</h3>
                <ul className="compact-list">
                  <li>Blends live 2026 signal with 2025 prior-season stabilization</li>
                  <li>Weights hitter, pitcher, lineup slot, weather, venue, and defense context</li>
                  <li>Runs market-specific scoring for hit probability and home run probability</li>
                </ul>
              </div>

              {games.length > 0 ? (
                <div className="upcoming-games-strip">
                  {games.slice(0, 3).map((game) => (
                    <div key={game.gamePk} className="game-option compact-game-option">
                      <strong>
                        {game.awayTeam.abbreviation} @ {game.homeTeam.abbreviation}
                      </strong>
                      <div className="muted">{buildGameLabel(game)}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="input-group">
            <label className="field-label" htmlFor="player-search">
              Hitter Name
            </label>
            <input
              id="player-search"
              className="text-input"
              placeholder="Start typing a batter's name"
              value={query}
              onChange={(event) => {
                const nextQuery = event.target.value;
                setQuery(nextQuery);
                if (
                  selectedPlayer &&
                  nextQuery.trim().toLowerCase() !== selectedPlayer.fullName.toLowerCase()
                ) {
                  setSelectedPlayer(null);
                }
                setError(null);
              }}
              onKeyDown={handlePlayerSearchKeyDown}
              role="combobox"
              aria-expanded={players.length > 0}
              aria-controls="player-suggestions"
              aria-activedescendant={
                activePlayerIndex >= 0 && players[activePlayerIndex]
                  ? `player-suggestion-${players[activePlayerIndex].id}`
                  : undefined
              }
            />
            {isSearching ? <div className="help-text">Searching current hitters...</div> : null}
          </div>

          {players.length > 0 ? (
            <div id="player-suggestions" className="suggestions" role="listbox">
              {players.map((player, index) => (
                <button
                  key={player.id}
                  id={`player-suggestion-${player.id}`}
                  type="button"
                  className={`suggestion${index === activePlayerIndex ? " active" : ""}`}
                  role="option"
                  aria-selected={index === activePlayerIndex}
                  onMouseEnter={() => setActivePlayerIndex(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectPlayer(player);
                  }}
                  onTouchStart={() => selectPlayer(player)}
                  onClick={() => selectPlayer(player)}
                >
                  <Image
                    src={buildPlayerHeadshotUrl(player.id)}
                    alt={`${player.fullName} headshot`}
                    width={44}
                    height={44}
                    className="suggestion-headshot"
                  />
                  <span>
                    <strong>{formatPlayerNameWithBatSide(player)}</strong>
                    <span className="muted">
                      {player.currentTeamAbbreviation ?? "FA"} • {player.primaryPosition ?? "BAT"} •{" "}
                      {player.batSide ?? "?"} hitter
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {selectedPlayer ? (
            <div className="chip-row">
              <span className="chip">{formatPlayerNameWithBatSide(selectedPlayer)}</span>
              <span className="chip">{selectedPlayer.currentTeamName ?? "No team"}</span>
              <span className="chip">
                {selectedPlayer.batSide ?? "?"} hitter • {selectedPlayer.primaryPosition ?? "BAT"}
              </span>
            </div>
          ) : null}

          <div
            className="grid"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginTop: "1rem" }}
          >
            <div className="input-group">
              <label className="field-label" htmlFor="market-select">
                Outcome
              </label>
              <select
                id="market-select"
                className="select-input"
                value={selectedMarket}
                onChange={(event) => {
                  setSelectedMarket(event.target.value as AnalysisMarket);
                  clearActiveResults();
                }}
              >
                <option value="hit">Hit Probability</option>
                <option value="hit_2_plus">2+ Hits Probability</option>
                <option value="home_run">Home Run Probability</option>
              </select>
            </div>

            <div className="input-group">
              <label className="field-label" htmlFor="date-select">
                Game Date
              </label>
              <input
                id="date-select"
                type="date"
                className="text-input"
                value={selectedDate}
                onChange={(event) => {
                  changeScheduleDate(event.target.value);
                }}
              />
            </div>

            <div className="input-group">
              <label className="field-label" htmlFor="game-select">
                Game
              </label>
              <select
                id="game-select"
                className="select-input"
                value={selectedGamePk ?? ""}
                onChange={(event) => {
                  setSelectedGamePk(event.target.value ? Number(event.target.value) : null);
                  clearActiveResults();
                }}
              >
                <option value="">Choose a game</option>
                {games.map((game) => (
                  <option key={game.gamePk} value={game.gamePk}>
                    {buildGameLabel(game)}
                  </option>
                ))}
              </select>
            </div>

            <div className="input-group">
              <label className="field-label" htmlFor="manual-odds-input">
                DraftKings Odds
              </label>
              <input
                id="manual-odds-input"
                className="text-input"
                inputMode="numeric"
                placeholder="-135, +120, 120, DK -135"
                value={manualOddsInput}
                onChange={(event) => {
                  setManualOddsInput(event.target.value);
                  setError(null);
                }}
              />
            </div>
          </div>

          <div className="cta-row">
            <button
              type="button"
              className="primary-button"
              onClick={() => void analyze()}
              disabled={!selectedPlayer || !selectedGamePk || isAnalyzing}
            >
              {isAnalyzing ? "Running model..." : `Analyze ${selectedMarketLabel} Chance`}
            </button>
            <button
              type="button"
              className="secondary-button pick-button"
              onClick={() => void compareLineup("hit")}
              disabled={!selectedGamePk || isComparingLineup}
            >
              {isComparingLineup && lineupComparisonMarket === "hit"
                ? "Comparing hit picks..."
                : "Find Best Hit Pick"}
            </button>
            <button
              type="button"
              className="secondary-button pick-button"
              onClick={() => void compareLineup("home_run")}
              disabled={!selectedGamePk || isComparingLineup}
            >
              {isComparingLineup && lineupComparisonMarket === "home_run"
                ? "Comparing HR picks..."
                : "Find Best Home Run Pick"}
            </button>
            <button
              type="button"
              className="secondary-button pick-button"
              onClick={() => void analyzeGameWinner()}
              disabled={!selectedGamePk || isGameWinnerLoading}
            >
              {isGameWinnerLoading ? "Predicting winner..." : "Analyze Game Winner"}
            </button>
            <span className="help-text">
              {selectedGame
                ? `${selectedGame.awayTeam.abbreviation} at ${selectedGame.homeTeam.abbreviation} selected. Use hitter tools, lineup buttons, or the game winner analyzer.`
                : "Pick a hitter, market, and game to run the model."}
            </span>
          </div>

          <div className="percentage-guide">
            <div className="percentage-guide-heading">
              <span className="field-label">Reading The Percentages</span>
              <p>
                The model number is an estimated chance for the selected outcome in this
                matchup, not a guarantee. Use it as a confidence signal, then compare it
                against risk, lineup spot, and the previous model result.
              </p>
            </div>

            <div className="percentage-guide-grid">
              <div>
                <h3>Hit Probability</h3>
                <ul>
                  <li><strong>Below 40%</strong> Low-confidence spot with thin contact margin.</li>
                  <li><strong>40-49%</strong> Playable only when other matchup signals are strong.</li>
                  <li><strong>50-59%</strong> Solid range for a hitter expected to produce traffic.</li>
                  <li><strong>60%+</strong> Strong hit profile, especially with lineup and pitcher support.</li>
                </ul>
              </div>

              <div>
                <h3>Home Run Probability</h3>
                <ul>
                  <li><strong>Below 5%</strong> Long-shot outcome without enough power signal.</li>
                  <li><strong>5-9%</strong> Viable dart only when price or context is favorable.</li>
                  <li><strong>10-14%</strong> Meaningful power setup with matchup support.</li>
                  <li><strong>15%+</strong> Premium home-run profile for this slate.</li>
                </ul>
              </div>
            </div>
          </div>

          {error ? <div className="error-text">{error}</div> : null}
          </div>

          <section
            ref={resultsRef}
            className={`results${hasResults ? " results-ready" : ""}`}
          >
            {selectedGameWinPrediction ? (
              <div className="panel game-winner-card">
                <div className="panel-heading-row">
                  <div>
                    <p className="eyebrow">Game Winner Prediction</p>
                    <h2>
                      {selectedGameWinPrediction.awayTeam.team.abbreviation} at{" "}
                      {selectedGameWinPrediction.homeTeam.team.abbreviation}
                    </h2>
                    <p className="muted">
                      Predicted winner:{" "}
                      <strong>{selectedGameWinPrediction.predictedWinner.abbreviation}</strong>{" "}
                      with <ConfidenceLabel confidence={selectedGameWinPrediction.confidence} />.
                      This is an independent baseball projection built from matchup data.
                    </p>
                  </div>
                  <span className="winner-badge">
                    {selectedGameWinPrediction.predictedWinner.abbreviation}{" "}
                    {formatPercent(
                      Math.max(
                        selectedGameWinPrediction.homeWinProbability,
                        selectedGameWinPrediction.awayWinProbability,
                      ),
                    )}
                  </span>
                </div>

                <div className="winner-probability-grid">
                  <div>
                    <span className="field-label">Away Win</span>
                    <strong>{formatPercent(selectedGameWinPrediction.awayWinProbability)}</strong>
                    <span>{selectedGameWinPrediction.awayTeam.team.name}</span>
                    <button
                      type="button"
                      className="compact-add-button"
                      onClick={() => addGameWinnerToParlay(selectedGameWinPrediction, "away")}
                      disabled={parlayPlayers.some(
                        (player) =>
                          player.id ===
                          `team-win:${selectedGameWinPrediction.game.gamePk}:away`,
                      )}
                    >
                      {parlayPlayers.some(
                        (player) =>
                          player.id ===
                          `team-win:${selectedGameWinPrediction.game.gamePk}:away`,
                      )
                        ? "Added"
                        : "Add Win To Parlay"}
                    </button>
                  </div>
                  <div>
                    <span className="field-label">Home Win</span>
                    <strong>{formatPercent(selectedGameWinPrediction.homeWinProbability)}</strong>
                    <span>{selectedGameWinPrediction.homeTeam.team.name}</span>
                    <button
                      type="button"
                      className="compact-add-button"
                      onClick={() => addGameWinnerToParlay(selectedGameWinPrediction, "home")}
                      disabled={parlayPlayers.some(
                        (player) =>
                          player.id ===
                          `team-win:${selectedGameWinPrediction.game.gamePk}:home`,
                      )}
                    >
                      {parlayPlayers.some(
                        (player) =>
                          player.id ===
                          `team-win:${selectedGameWinPrediction.game.gamePk}:home`,
                      )
                        ? "Added"
                        : "Add Win To Parlay"}
                    </button>
                  </div>
                  <div>
                    <span className="field-label">Model</span>
                    <strong>{selectedGameWinPrediction.modelType}</strong>
                    <span>{selectedGameWinPrediction.modelVersion}</span>
                  </div>
                </div>

                <div className="winner-methodology-box">
                  <strong>Independent Number</strong>
                  <p>
                    This projection is built from baseball data only: starters, lineups,
                    bullpen usage, team form, defense, park, and weather.
                  </p>
                  <span>
                    Uses live baseball APIs for starters, lineups, bullpen usage, team form,
                    defense, park, and weather before the model makes its own probability.
                  </span>
                  <span>
                    Freshness: lineup {selectedGameWinPrediction.dataFreshness.lineupStatus},
                    game status {selectedGameWinPrediction.dataFreshness.gameStatus}, generated{" "}
                    {new Date(
                      selectedGameWinPrediction.dataFreshness.generatedAt,
                    ).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    .
                  </span>
                </div>

                <div className="external-context-panel">
                  <strong>External Context</strong>
                  <div className="external-badge-row">
                    {getExternalBadges(selectedGameWinPrediction.externalContext).map((badge) => (
                      <span key={badge}>{badge}</span>
                    ))}
                  </div>
                  {selectedGameWinPrediction.externalContext?.confidenceFlags.length ? (
                    <p>
                      Prediction confidence reduced because some enrichment sources were missing
                      or incomplete.
                    </p>
                  ) : null}
                </div>

                <div className="winner-analysis-summary">
                  <strong>Why The Model Leans This Way</strong>
                  <p>{selectedGameWinPrediction.analysisSummary}</p>
                </div>

                <div className="winner-summary-sections">
                  {selectedGameWinPrediction.summarySections.map((section) => (
                    <div key={section.title} className="winner-summary-section">
                      <div className="winner-summary-section-heading">
                        <strong>{section.title}</strong>
                        <span className={`factor-edge ${section.edge}`}>{section.edge}</span>
                      </div>
                      <div className="winner-stat-table">
                        <div>
                          <span />
                          <span>{selectedGameWinPrediction.awayTeam.team.abbreviation}</span>
                          <span>{selectedGameWinPrediction.homeTeam.team.abbreviation}</span>
                        </div>
                        {section.stats.map((stat) => (
                          <div key={stat.label}>
                            <span>{stat.label}</span>
                            <strong>{stat.away}</strong>
                            <strong>{stat.home}</strong>
                          </div>
                        ))}
                      </div>
                      <p>{section.note}</p>
                    </div>
                  ))}
                </div>

                <div className="winner-series-history">
                  <div className="winner-summary-section-heading">
                    <strong>Previous Games In This Series</strong>
                    <span className="muted">
                      {selectedGameWinPrediction.previousSeriesGames.length > 0
                        ? `${selectedGameWinPrediction.previousSeriesGames.length} found`
                        : "none yet"}
                    </span>
                  </div>
                  {selectedGameWinPrediction.previousSeriesGames.length > 0 ? (
                    <div className="series-game-list">
                      {selectedGameWinPrediction.previousSeriesGames.map((seriesGame) => (
                        <div key={seriesGame.gamePk} className="series-game-row">
                          <span>{formatShortDate(seriesGame.officialDate)}</span>
                          <strong
                            className={seriesGame.winner === "away" ? "series-winner" : ""}
                          >
                            {seriesGame.awayTeam.abbreviation} {seriesGame.awayScore ?? "-"}
                          </strong>
                          <span>@</span>
                          <strong
                            className={seriesGame.winner === "home" ? "series-winner" : ""}
                          >
                            {seriesGame.homeTeam.abbreviation} {seriesGame.homeScore ?? "-"}
                          </strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">
                      No completed head-to-head games were found in the last week, so series
                      momentum is kept neutral.
                    </p>
                  )}
                </div>

                <div className="winner-factor-grid">
                  {selectedGameWinPrediction.topFactors.slice(0, 4).map((factor) => (
                    <div key={`${factor.factor}-${factor.detail}`}>
                      <span className={`factor-edge ${factor.edge}`}>{factor.edge}</span>
                      <strong>{factor.factor}</strong>
                      <p>{factor.detail}</p>
                    </div>
                  ))}
                </div>

                {selectedGameWinPrediction.warnings.length > 0 ? (
                  <div className="winner-warning-list">
                    {selectedGameWinPrediction.warnings.map((warning) => (
                      <span key={warning}>{warning}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {lineupComparison?.topPick ? (
              <div className="panel lineup-comparison-panel analyst-readable-panel">
                <p className="eyebrow">Starting Lineup Comparison</p>
                <h2>
                  Best {lineupComparison.marketLabel.toLowerCase()} target:{" "}
                  {formatPlayerNameWithBatSide(lineupComparison.topPick.hitter.player)}
                </h2>
                <p className="muted">
                  {lineupComparison.selection
                    ? lineupComparison.selection.analystNarrative.analystParagraph
                    : `The cards below rank the published starters by the model's projected ${lineupComparison.marketLabel.toLowerCase()} probability and explain the main reasons behind each number.`}
                </p>

                {lineupComparison.selection ? (
                  <>
                    <div className="stat-strip analyst-stat-strip">
                      <div className="stat-box">
                        <span className="field-label">Selected Player</span>
                        <strong>{lineupComparison.selection.selectedHitter}</strong>
                      </div>
                      <div className="stat-box">
                        <span className="field-label">Hit Probability</span>
                        <strong>{formatPercent(lineupComparison.selection.hitProbability)}</strong>
                      </div>
                      <div className="stat-box">
                        <span className="field-label">Confidence</span>
                        <strong>{lineupComparison.selection.confidence}</strong>
                      </div>
                      <div className="stat-box">
                        <span className="field-label">Recommendation</span>
                        <strong>{lineupComparison.selection.recommendation}</strong>
                      </div>
                    </div>

                    <div className="percentage-guide-grid analyst-insight-grid">
                      <div>
                        <h3>Why This Player?</h3>
                        <ul className="compact-list">
                          {lineupComparison.selection.whyHeStandsOut.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h3>Why Not The Obvious Star?</h3>
                        <ul className="compact-list">
                          {(lineupComparison.selection.whyNotTheStarPlayer.length > 0
                            ? lineupComparison.selection.whyNotTheStarPlayer
                            : ["The top star still rated as the best pick, and the model had real evidence for it."]).map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="snapshot-grid analyst-snapshot-grid" style={{ marginTop: "1rem" }}>
                      <div className="panel snapshot-card">
                        <h3>Analyst Explanation</h3>
                        <p className="muted">
                          {lineupComparison.selection.analystNarrative.quickSummary}
                        </p>
                        <ul className="snapshot-list">
                          {lineupComparison.selection.analystNarrative.keyStats.map((stat) => (
                            <li key={stat}>{stat}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="panel snapshot-card">
                        <h3>Top Alternatives</h3>
                        <ul className="snapshot-list">
                          {lineupComparison.selection.topAlternatives.map((entry) => (
                            <li key={entry.playerId}>
                              {entry.playerName}: {formatPercent(entry.hitProbability, 1)} hit,{" "}
                              {entry.reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="panel snapshot-card">
                        <h3>Risk Warning</h3>
                        <ul className="snapshot-list">
                          {(lineupComparison.selection.risks.length > 0
                            ? lineupComparison.selection.risks
                            : ["No extra risk note rose above normal variance."]).map((risk) => (
                            <li key={risk}>{risk}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="panel snapshot-card">
                        <h3>Confidence</h3>
                        <p className="muted">
                          {lineupComparison.selection.analystNarrative.confidenceExplanation}
                        </p>
                        {lineupComparison.selection.dataWarnings.length > 0 ? (
                          <ul className="snapshot-list">
                            {lineupComparison.selection.dataWarnings.map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </div>
                  </>
                ) : null}

                <div className="lineup-pick-grid">
                  {lineupComparison.players.slice(0, 8).map((entry, index) => {
                    const tone = getAnalysisTone(entry);
                    const selectionEntry = lineupComparison.selection?.comparisonTable.find(
                      (candidate) => candidate.playerId === entry.hitter.player.id,
                    );

                    return (
                      <div key={entry.analysisId} className={`lineup-pick-card ${tone}`}>
                        <div className="lineup-pick-rank">#{index + 1}</div>
                        <div className="lineup-pick-matchup">
                          <div className="lineup-pick-person">
                            <Image
                              src={buildPlayerHeadshotUrl(entry.hitter.player.id)}
                              alt={`${entry.hitter.player.fullName} headshot`}
                              width={88}
                              height={88}
                              className="lineup-pick-headshot"
                            />
                            <strong>{formatPlayerNameWithBatSide(entry.hitter.player)}</strong>
                            <span>{entry.hitter.player.currentTeamAbbreviation ?? "MLB"}</span>
                          </div>
                          <span className="lineup-pick-vs">VS</span>
                          <div className="lineup-pick-pitcher">
                            {entry.pitcher.player ? (
                              <Image
                                src={buildPlayerHeadshotUrl(entry.pitcher.player.id)}
                                alt={`${entry.pitcher.player.fullName} headshot`}
                                width={88}
                                height={88}
                                className="lineup-pick-headshot"
                              />
                            ) : (
                              <div className="lineup-pick-headshot placeholder">TBD</div>
                            )}
                            <strong>{entry.pitcher.player?.fullName ?? "TBD Pitcher"}</strong>
                            <span>{getPitchHandLabel(entry.pitcher.player?.pitchHand)}</span>
                          </div>
                        </div>

                        <div className="lineup-pick-main">
                          <span className="field-label">{lineupComparison.marketLabel}</span>
                          <strong>{formatPercent(entry.probabilities.atLeastOne)}</strong>
                          <span className={`pick-call ${tone}`}>{entry.recommendation}</span>
                        </div>

                        <div className="lineup-pick-meta">
                          <span>Slot {entry.hitter.lineupSlot ?? "n/a"}</span>
                          <ConfidenceLabel confidence={entry.confidence} />
                          <span>{entry.probabilities.expectedAtBats.toFixed(1)} exp AB</span>
                          {selectionEntry ? (
                            <span>Score {selectionEntry.finalScore.toFixed(2)}</span>
                          ) : null}
                        </div>

                        <p className="lineup-pick-reason">
                          {selectionEntry?.reason ?? buildPlayerCardReason(entry)}
                        </p>

                        <div className="comparison-card-actions">
                          <button
                            type="button"
                            className="compact-add-button"
                            onClick={() => void showLineupPlayerDetails(entry)}
                            disabled={isDetailLoading}
                          >
                            {detailLoadingPlayerId === entry.hitter.player.id
                              ? "Loading..."
                              : "Show More"}
                          </button>
                          <button
                            type="button"
                            className="compact-add-button"
                            onClick={() => addAnalysisToParlay(entry)}
                            disabled={parlayPlayers.some(
                              (player) =>
                                player.id ===
                                `player:${entry.hitter.player.id}:${entry.game.gamePk}:${entry.market}`,
                            )}
                          >
                            {parlayPlayers.some(
                              (player) =>
                                player.id ===
                                `player:${entry.hitter.player.id}:${entry.game.gamePk}:${entry.market}`,
                            )
                              ? "Added"
                              : "Add To Parlay"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {lineupComparison.skippedPlayers.length > 0 ? (
                  <p className="muted" style={{ marginTop: "1rem" }}>
                    Skipped: {lineupComparison.skippedPlayers.join(" | ")}
                  </p>
                ) : null}
              </div>
        ) : null}

        {!analysis ? (
          <div className="panel empty-state">
            <h2>Ready For A Matchup</h2>
            <p className="muted">
              Search a hitter, pick either hit or home run, select the game, and the
              model will return the probability, confidence level, and reasoning. You can
              also compare the full published starting lineup and let the app surface the
              top play automatically.
            </p>
          </div>
        ) : (
          <>
            <div ref={analysisDetailRef} className="grid secondary-grid">
              <div className={`panel summary-card summary-lead ${recommendationTone}`}>
                <div className="player-media-stack">
                  <Image
                    src={buildPlayerHeadshotUrl(analysis.hitter.player.id)}
                    alt={`${analysis.hitter.player.fullName} headshot`}
                    width={132}
                    height={132}
                    className="player-headshot"
                  />
                  <button
                    type="button"
                    className="parlay-add-button"
                    onClick={() => addAnalysisToParlay(analysis)}
                    disabled={parlayPlayers.some(
                      (player) =>
                        player.id ===
                        `player:${analysis.hitter.player.id}:${analysis.game.gamePk}:${analysis.market}`,
                    )}
                  >
                    {parlayPlayers.some(
                      (player) =>
                        player.id ===
                        `player:${analysis.hitter.player.id}:${analysis.game.gamePk}:${analysis.market}`,
                    )
                      ? "Added"
                      : "Add To Parlay"}
                  </button>
                </div>
                <p className="eyebrow">{analysis.recommendation}</p>
                <div className="player-result-heading">
                  <div>
                    <h2>{formatPlayerNameWithBatSide(analysis.hitter.player)}</h2>
                    <span>{analysis.hitter.player.currentTeamName ?? "MLB"}</span>
                  </div>
                </div>
                <div className="probability">
                  {formatPercent(analysis.probabilities.atLeastOne)}
                </div>
                <p className="muted">{buildPlayerCardReason(analysis)}</p>
                <div className="external-badge-row compact">
                  {getExternalBadges(analysis.externalContext ?? null).map((badge) => (
                    <span key={badge}>{badge}</span>
                  ))}
                </div>

                <div className="stat-strip">
                  <div className="stat-box">
                    <span className="field-label">Per At-Bat</span>
                    <strong>{formatPercent(analysis.probabilities.perAtBat)}</strong>
                  </div>
                  <div className="stat-box">
                    <span className="field-label">Outcome</span>
                    <strong>{analysis.marketLabel}</strong>
                  </div>
                  <div className="stat-box">
                    <span className="field-label">Expected ABs</span>
                    <strong>{analysis.probabilities.expectedAtBats.toFixed(1)}</strong>
                  </div>
                  {analysis.market === "hit" || analysis.market === "hit_2_plus" ? (
                    <>
                      <div className="stat-box">
                        <span className="field-label">Expected Hits</span>
                        <strong>
                          {analysis.probabilities.expectedHits?.toFixed(2) ?? "n/a"}
                        </strong>
                      </div>
                      <div className="stat-box">
                        <span className="field-label">2+ Hits</span>
                        <strong>
                          {analysis.probabilities.atLeastTwo !== null
                            ? formatPercent(analysis.probabilities.atLeastTwo)
                            : "n/a"}
                        </strong>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="panel summary-card summary-notes">
                <h2>Previous Model Result</h2>
                <div className="previous-result-box">
                  {analysis.previousModelResult ? (
                    <>
                      <strong>
                        {analysis.previousModelResult.date}:{" "}
                        {analysis.previousModelResult.probability !== null
                          ? `${analysis.previousModelResult.marketLabel} ${formatPercent(
                              analysis.previousModelResult.probability,
                            )}`
                          : analysis.previousModelResult.marketLabel}
                      </strong>
                      <span>
                        {getPreviousResultLabel(analysis.previousModelResult.rating)}
                        {getPreviousResultMarker(analysis.previousModelResult.rating)
                          ? ` ${getPreviousResultMarker(analysis.previousModelResult.rating)}`
                          : ""}
                        {analysis.previousModelResult.actualHits !== null
                          ? ` - ${analysis.previousModelResult.actualHits} H, ${analysis.previousModelResult.actualHomeRuns} HR, ${analysis.previousModelResult.actualAtBats} AB`
                          : ""}
                      </span>
                      <span>
                        {analysis.previousModelResult.game
                          ? `${analysis.previousModelResult.game.awayTeam.abbreviation} @ ${analysis.previousModelResult.game.homeTeam.abbreviation}`
                          : analysis.previousModelResult.message}
                      </span>
                    </>
                  ) : (
                    <>
                      <strong>Previous-day result unavailable.</strong>
                      <span>Run an analysis to calculate the previous-day model result.</span>
                    </>
                  )}
                </div>
              </div>

              <div className="panel summary-card matchup-history-card top-matchup-history">
                <h2>Batter Vs Pitcher</h2>
                <p className="muted">
                  {analysis.batterVsPitcher?.summary ??
                    `${analysis.hitter.player.fullName} has not previously faced ${
                      analysis.pitcher.player?.fullName ?? "the probable pitcher"
                    } in the Statcast sample.`}
                </p>
                <ul className="matchup-history-list">
                  <li>
                    <span>Matchup</span>
                    <strong>
                      {analysis.hitter.player.fullName} vs{" "}
                      {analysis.batterVsPitcher?.pitcherName ??
                        analysis.pitcher.player?.fullName ??
                        "TBD"}
                    </strong>
                  </li>
                  <li>
                    <span>Line</span>
                    <strong>
                      {analysis.batterVsPitcher
                        ? `${analysis.batterVsPitcher.hits} H / ${analysis.batterVsPitcher.atBats} AB`
                        : "0 H / 0 AB"}
                    </strong>
                  </li>
                  <li>
                    <span>AVG</span>
                    <strong>
                      {formatOptionalNumber(
                        analysis.batterVsPitcher?.battingAverage,
                        3,
                      )}
                    </strong>
                  </li>
                  <li>
                    <span>HR</span>
                    <strong>{analysis.batterVsPitcher?.homeRuns ?? 0}</strong>
                  </li>
                  <li>
                    <span>K</span>
                    <strong>{analysis.batterVsPitcher?.strikeouts ?? 0}</strong>
                  </li>
                  <li>
                    <span>BB</span>
                    <strong>{analysis.batterVsPitcher?.walks ?? 0}</strong>
                  </li>
                  <li>
                    <span>Last Faced</span>
                    <strong>{analysis.batterVsPitcher?.lastFacedDate ?? "Never"}</strong>
                  </li>
                </ul>
              </div>

              <div className="panel summary-card recent-form-card">
                <h2>Last 5 Games</h2>
                <p className="muted">
                  Recent boxscore form is included in the model as a short-term adjustment.
                </p>
                {analysis.hitter.recentGames.length > 0 ? (
                  <div className="recent-game-table">
                    <div className="recent-game-row recent-game-header">
                      <span>Date</span>
                      <span>Opp</span>
                      <span>AB</span>
                      <span>H</span>
                      <span>R</span>
                      <span>RBI</span>
                      <span>HR</span>
                    </div>
                    {analysis.hitter.recentGames.map((game) => (
                      <div
                        key={`${game.gamePk ?? game.date}-${game.opponent ?? "opp"}`}
                        className="recent-game-row"
                      >
                        <span>{formatShortDate(game.date)}</span>
                        <span>{game.opponent ?? "MLB"}</span>
                        <strong>{game.atBats}</strong>
                        <strong>{game.hits}</strong>
                        <strong>{game.runs}</strong>
                        <strong>{game.rbi}</strong>
                        <strong>{game.homeRuns}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="recent-game-empty">
                    <strong>No recent game log available.</strong>
                    <span>The model kept the last-5 game adjustment neutral.</span>
                  </div>
                )}
              </div>

              {analysis.analystEngine ? (
                <div className="panel summary-card debug-context-card analyst-readable-panel">
                  <div className="debug-context-header">
                    <div>
                      <h2>MLB Analyst Engine</h2>
                      <p className="muted">{analysis.analystEngine.summary}</p>
                    </div>
                  </div>

                  <div className="stat-strip analyst-stat-strip">
                    <div className="stat-box">
                      <span className="field-label">Analyst %</span>
                      <strong>{formatPercent(analysis.analystEngine.predictedProbability)}</strong>
                    </div>
                    <div className="stat-box">
                      <span className="field-label">Confidence</span>
                      <strong>{analysis.analystEngine.confidence}</strong>
                    </div>
                    <div className="stat-box">
                      <span className="field-label">Lean</span>
                      <strong>{analysis.analystEngine.recommendation}</strong>
                    </div>
                    <div className="stat-box">
                      <span className="field-label">Fair Odds</span>
                      <strong>{formatAmericanOdds(analysis.analystEngine.fairOdds)}</strong>
                    </div>
                    <div className="stat-box">
                      <span className="field-label">Team Win</span>
                      <strong>
                        {formatPercent(analysis.analystEngine.gameScript.teamWinProbability)}
                      </strong>
                    </div>
                    <div className="stat-box">
                      <span className="field-label">Blowout Risk</span>
                      <strong>{formatPercent(analysis.analystEngine.gameScript.blowoutRisk)}</strong>
                    </div>
                  </div>

                  <div className="odds-summary-grid">
                    <div className="panel odds-summary-card">
                      <div className="odds-summary-heading">
                        <h3>Odds And Value</h3>
                        <span
                          className={`value-pill ${valueToneClass(analysis.analystEngine.manualOdds?.valueRating ?? analysis.analystEngine.valueRating)}`}
                        >
                          {analysis.analystEngine.manualOdds?.valueRating ?? analysis.analystEngine.valueRating}
                        </span>
                      </div>
                      <div className="odds-summary-lines">
                        <div className="odds-summary-line">
                          <span>Model Probability</span>
                          <strong>{formatPercent(analysis.analystEngine.predictedProbability, 1)}</strong>
                        </div>
                        <div className="odds-summary-line">
                          <span>
                            {analysis.analystEngine.manualOdds ? "Your Odds" : "Sportsbook Odds"}
                          </span>
                          <strong>{formatAmericanOdds(analysis.analystEngine.sportsbookOdds)}</strong>
                        </div>
                        <div className="odds-summary-line">
                          <span>
                            {analysis.analystEngine.manualOdds ? "Sportsbook" : "Book Implied"}
                          </span>
                          <strong>
                            {analysis.analystEngine.manualOdds
                              ? analysis.analystEngine.manualOdds.sportsbook ?? "DraftKings"
                              : formatPercentMaybe(
                                  analysis.analystEngine.sportsbookImpliedProbability,
                                  1,
                                )}
                          </strong>
                        </div>
                        <div className="odds-summary-line">
                          <span>
                            {analysis.analystEngine.manualOdds ? "Implied Probability" : "No-Vig Market"}
                          </span>
                          <strong>
                            {analysis.analystEngine.manualOdds
                              ? formatPercent(analysis.analystEngine.manualOdds.impliedProbability, 1)
                              : formatPercentMaybe(
                                  analysis.analystEngine.noVigMarketProbability,
                                  1,
                                )}
                          </strong>
                        </div>
                        <div className="odds-summary-line">
                          <span>Fair Odds</span>
                          <strong>{formatAmericanOdds(analysis.analystEngine.fairOdds)}</strong>
                        </div>
                        <div className="odds-summary-line">
                          <span>Edge</span>
                          <strong>
                            {formatSignedPercent(
                              analysis.analystEngine.manualOdds?.edge ??
                                analysis.analystEngine.edgeIfAvailable,
                              1,
                            )}
                          </strong>
                        </div>
                      </div>
                      <p className="odds-summary-copy">
                        {oddsSummaryText(analysis.analystEngine)}
                      </p>
                    </div>
                  </div>

                  <div className="percentage-guide-grid analyst-insight-grid">
                    <div>
                      <h3>Why It Likes It</h3>
                      <ul className="compact-list">
                        {(analysis.analystEngine.topReasonsFor.length > 0
                          ? analysis.analystEngine.topReasonsFor
                          : ["No major positive edge surfaced beyond the baseline model."]).map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h3>What It Fears</h3>
                      <ul className="compact-list">
                        {(analysis.analystEngine.topReasonsAgainst.length > 0
                          ? analysis.analystEngine.topReasonsAgainst
                          : ["No major negative flag surfaced beyond standard variance."]).map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="snapshot-grid analyst-snapshot-grid" style={{ marginTop: "1rem" }}>
                    <div className="panel snapshot-card">
                      <h3>Game Script</h3>
                      <ul className="snapshot-list">
                        <li>Summary: {analysis.analystEngine.gameScript.summary}</li>
                        <li>
                          Implied runs: {analysis.analystEngine.gameScript.impliedRuns.toFixed(1)}
                        </li>
                        <li>
                          Opp implied runs:{" "}
                          {analysis.analystEngine.gameScript.opponentImpliedRuns.toFixed(1)}
                        </li>
                        <li>
                          Likely winner:{" "}
                          {analysis.analystEngine.gameScript.likelyWinningTeam ?? "n/a"}
                        </li>
                      </ul>
                    </div>

                    <div className="panel snapshot-card">
                      <h3>Environment</h3>
                      <ul className="snapshot-list">
                        <li>{analysis.analystEngine.environment.summary}</li>
                        <li>
                          Wind: {analysis.analystEngine.environment.windImpact}
                        </li>
                        <li>
                          Ballpark hit factor:{" "}
                          {analysis.analystEngine.environment.ballpark.hitFactor.toFixed(2)}
                        </li>
                        <li>
                          Ballpark HR factor:{" "}
                          {analysis.analystEngine.environment.ballpark.homeRunFactor.toFixed(2)}
                        </li>
                      </ul>
                    </div>

                    <div className="panel snapshot-card">
                      <h3>Vegas Context</h3>
                      <ul className="snapshot-list">
                        <li>
                          Source: {analysis.analystEngine.vegas?.source ?? "unavailable"}
                        </li>
                        <li>
                          Home line:{" "}
                          {formatAmericanOdds(analysis.analystEngine.vegas?.homeMoneyline)}
                        </li>
                        <li>
                          Away line:{" "}
                          {formatAmericanOdds(analysis.analystEngine.vegas?.awayMoneyline)}
                        </li>
                        <li>
                          Total:{" "}
                          {analysis.analystEngine.vegas?.totalRuns !== null &&
                          analysis.analystEngine.vegas?.totalRuns !== undefined
                            ? analysis.analystEngine.vegas.totalRuns.toFixed(1)
                            : "n/a"}
                        </li>
                      </ul>
                    </div>

                    <div className="panel snapshot-card">
                      <h3>Data Quality</h3>
                      <ul className="snapshot-list">
                        <li>
                          Sources: {analysis.analystEngine.dataQuality.sourcesUsed.join(", ")}
                        </li>
                        <li>
                          Missing:{" "}
                          {analysis.analystEngine.dataQuality.missingFields.length > 0
                            ? analysis.analystEngine.dataQuality.missingFields.join(", ")
                            : "none"}
                        </li>
                        <li>
                          Warnings:{" "}
                          {analysis.analystEngine.dataQuality.warnings.length > 0
                            ? analysis.analystEngine.dataQuality.warnings.slice(0, 2).join(" | ")
                            : "none"}
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              ) : null}

              {analysis.explainability ? (
                <div className="panel summary-card debug-context-card analyst-readable-panel">
                  <div className="debug-context-header">
                    <div>
                      <h2>Betting Analyst Read</h2>
                      <p className="muted">{analysis.explainability.whyThisPick}</p>
                    </div>
                  </div>
                  <div className="snapshot-grid analyst-snapshot-grid" style={{ marginTop: 0 }}>
                    <div className="panel snapshot-card">
                      <h3>Why This Pick?</h3>
                      <ul className="snapshot-list">
                        {analysis.explainability.topPositiveFactors.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="panel snapshot-card">
                      <h3>Risk Factors</h3>
                      <ul className="snapshot-list">
                        {analysis.explainability.topNegativeFactors.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="panel snapshot-card">
                      <h3>Vegas Odds Comparison</h3>
                      <p className="muted">
                        {analysis.explainability.vegasComparison ??
                          "Enter DraftKings odds to compare the model probability against sportsbook implied probability."}
                      </p>
                    </div>
                    <div className="panel snapshot-card">
                      <h3>Missing Data</h3>
                      <ul className="snapshot-list">
                        {(analysis.explainability.missingData.length > 0
                          ? analysis.explainability.missingData
                          : ["No major data gaps were detected for this prediction."]).map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <p className="muted">{analysis.explainability.safetyNote}</p>
                </div>
              ) : null}

            </div>

            <div className="factor-grid">
              {analysis.factors.map((factor) => (
                <div
                  key={factor.label}
                  className={`panel factor-card factor-impact-${factor.impact}`}
                >
                  <h3>{factor.label}</h3>
                  <div className="factor-value">
                    {factor.impact === "positive"
                      ? "Helps"
                      : factor.impact === "negative"
                        ? "Hurts"
                        : "Neutral"}
                  </div>
                  <p className="factor-detail">{getPlainFactorDetail(factor)}</p>
                </div>
              ))}
            </div>

            <div className="snapshot-grid">
              <div className="panel snapshot-card">
                <h3>Hitter Snapshot</h3>
                <ul className="snapshot-list">
                  <li>2026 AVG: {formatOptionalNumber(analysis.hitter.season?.avg, 3)}</li>
                  <li>2026 OPS: {formatOptionalNumber(analysis.hitter.season?.ops, 3)}</li>
                  <li>2026 HR: {analysis.hitter.season?.homeRuns ?? "n/a"}</li>
                  <li>
                    2026 xBA:{" "}
                    {formatOptionalNumber(analysis.hitter.expected?.expectedBattingAverage, 3)}
                  </li>
                  <li>
                    2026 xSLG: {formatOptionalNumber(analysis.hitter.expected?.expectedSlugging, 3)}
                  </li>
                  <li>
                    2025 AVG prior: {formatOptionalNumber(analysis.hitter.priorSeason?.avg, 3)}
                  </li>
                  <li>
                    Sprint speed: {formatOptionalNumber(analysis.hitter.sprint?.sprintSpeed, 1)} ft/s
                  </li>
                  <li>Lineup slot: {analysis.hitter.lineupSlot ?? "not posted"}</li>
                </ul>
              </div>

              <div className="panel snapshot-card">
                <h3>Pitcher Snapshot</h3>
                <ul className="snapshot-list">
                  <li>Pitcher: {analysis.pitcher.player?.fullName ?? "TBD"}</li>
                  <li>
                    Throws: {getPitchHandLabel(analysis.pitcher.player?.pitchHand)}
                  </li>
                  <li>2026 ERA: {formatOptionalNumber(analysis.pitcher.season?.era, 2)}</li>
                  <li>
                    2026 xBA allowed:{" "}
                    {formatOptionalNumber(
                      analysis.pitcher.expected?.expectedBattingAverage,
                      3,
                    )}
                  </li>
                  <li>
                    2026 xSLG allowed:{" "}
                    {formatOptionalNumber(analysis.pitcher.expected?.expectedSlugging, 3)}
                  </li>
                  <li>
                    2025 AVG allowed prior: {formatOptionalNumber(analysis.pitcher.priorSeason?.avg, 3)}
                  </li>
                  <li>
                    Pitch mix:{" "}
                    {analysis.pitcher.pitchMix.length > 0
                      ? analysis.pitcher.pitchMix
                          .slice(0, 3)
                          .map((pitch) => `${pitch.label} ${pitch.usage.toFixed(1)}%`)
                          .join(", ")
                      : "not available"}
                  </li>
                </ul>
              </div>

              <div className="panel snapshot-card">
                <h3>Venue And Weather</h3>
                <ul className="snapshot-list">
                  <li>Venue: {analysis.venue?.name ?? analysis.game.venue.name}</li>
                  <li>Roof: {analysis.venue?.roofType ?? "unknown"}</li>
                  <li>Turf: {analysis.venue?.turfType ?? "unknown"}</li>
                  <li>Center field: {analysis.venue?.dimensions.center ?? "n/a"} ft</li>
                  <li>Weather: {formatOptionalNumber(analysis.weather?.temperatureF, 0)}F</li>
                  <li>Wind: {formatOptionalNumber(analysis.weather?.windSpeedMph, 0)} mph</li>
                </ul>
              </div>

              <div className="panel snapshot-card">
                <h3>Defense And Diagnostics</h3>
                <ul className="snapshot-list">
                  <li>Opposing defense: {analysis.defense?.teamName ?? "n/a"}</li>
                  <li>
                    Fielding pct: {formatOptionalNumber(analysis.defense?.fieldingPct, 3)}
                  </li>
                  <li>Team OAA: {analysis.defense?.oaa ?? "n/a"}</li>
                  <li>Arm strength: {formatOptionalNumber(analysis.defense?.armOverall, 1)}</li>
                  <li>Hitter sample: {analysis.diagnostics.hitterSampleSize} ABs</li>
                  <li>Pitch-mix coverage: {formatPercent(analysis.diagnostics.pitchMixCoverage)}</li>
                  <li>Confidence: <ConfidenceLabel confidence={analysis.confidence} /></li>
                </ul>
              </div>
            </div>

            <div className="panel feedback-panel" style={{ marginTop: "1rem" }}>
              <h3>Teach The Model</h3>
              <p className="muted">
                Save whether the call felt right. These notes are stored locally in
                the app so the scoring system can be tuned over time for both hit and
                home-run markets.
              </p>
              <div className="input-group">
                <label className="field-label" htmlFor="feedback-note">
                  Optional Note
                </label>
                <textarea
                  id="feedback-note"
                  className="note-input"
                  rows={3}
                  placeholder="What did the model miss, if anything?"
                  value={feedbackNote}
                  onChange={(event) => setFeedbackNote(event.target.value)}
                />
              </div>

              <div className="input-group">
                <label className="field-label" htmlFor="feedback-image">
                  Parlay Proof Image
                </label>
                <input
                  id="feedback-image"
                  type="file"
                  className="text-input"
                  accept="image/*"
                  onChange={(event) =>
                    setFeedbackImage(event.target.files?.[0] ?? null)
                  }
                />
                {feedbackImage ? (
                  <div className="help-text">
                    Attached: {feedbackImage.name}. Use Model Was Right when the
                    slip confirms the call.
                  </div>
                ) : null}
              </div>

              <div className="feedback-row">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void saveFeedback("correct")}
                >
                  Model Was Right
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void saveFeedback("too_high")}
                >
                  Too Optimistic
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void saveFeedback("too_low")}
                >
                  Too Pessimistic
                </button>
                <button
                  type="button"
                  className="secondary-button pick-button"
                  onClick={() => void auditFinishedGames()}
                  disabled={isAuditingOutcomes}
                >
                  {isAuditingOutcomes ? "Checking Games..." : "Check Finished Games"}
                </button>
              </div>

              {feedbackStatus ? <div className="status-text">{feedbackStatus}</div> : null}
            </div>
          </>
            )}

          </section>
        </div>

        <aside className="schedule-section schedule-desktop">{renderScheduleBoard()}</aside>
      </section>
    </main>
  );
}
