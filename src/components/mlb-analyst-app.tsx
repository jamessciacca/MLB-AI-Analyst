"use client";

import Image from "next/image";
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
  type LineupComparisonResult,
  type PlayerSearchResult,
} from "@/lib/types";

type SearchResponse = {
  players: PlayerSearchResult[];
  error?: string;
};

type GamesResponse = {
  games: GameSummary[];
  error?: string;
};

type FeedbackRating = "correct" | "too_high" | "too_low";
type ColorTheme = "light" | "dark";

type ParlayPlayer = {
  id: number;
  name: string;
  team: string | null;
  market: AnalysisMarket | null;
  probability: number | null;
};

const THEME_STORAGE_KEY = "mlb-analyst-theme";
const THEME_CHANGE_EVENT = "mlb-analyst-theme-change";

function getStoredTheme(): ColorTheme {
  if (typeof window === "undefined") {
    return "light";
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === "dark" || storedTheme === "light" ? storedTheme : "light";
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

function formatOptionalNumber(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined) {
    return "n/a";
  }

  return value.toFixed(digits);
}

function getMarketLabel(market: AnalysisMarket) {
  return market === "home_run" ? "Home Run" : "Hit";
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

function buildTeamLogoUrl(teamId: number) {
  return `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
}

function buildPlayerHeadshotUrl(playerId: number) {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/w_220,h_220,c_pad,b_auto,q_auto:best/v1/people/${playerId}/headshot/67/current`;
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
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [players, setPlayers] = useState<PlayerSearchResult[]>([]);
  const [activePlayerIndex, setActivePlayerIndex] = useState(-1);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerSearchResult | null>(null);
  const [selectedDate, setSelectedDate] = useState(defaultDate);
  const [selectedMarket, setSelectedMarket] = useState<AnalysisMarket>("hit");
  const [games, setGames] = useState<GameSummary[]>([]);
  const [selectedGamePk, setSelectedGamePk] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [lineupComparison, setLineupComparison] = useState<LineupComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isComparingLineup, setIsComparingLineup] = useState(false);
  const [isAuditingOutcomes, setIsAuditingOutcomes] = useState(false);
  const [showModelDetails, setShowModelDetails] = useState(false);
  const [showScheduleMenu, setShowScheduleMenu] = useState(false);
  const colorTheme = useSyncExternalStore(
    subscribeToThemeChanges,
    getStoredTheme,
    () => "light",
  );
  const [lineupComparisonMarket, setLineupComparisonMarket] =
    useState<AnalysisMarket | null>(null);
  const [parlayPlayers, setParlayPlayers] = useState<ParlayPlayer[]>([]);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackImage, setFeedbackImage] = useState<File | null>(null);
  const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null);
  const analysisId = analysis?.analysisId ?? null;
  const lineupComparisonId = lineupComparison?.generatedAt ?? null;
  const hasResults = Boolean(analysisId || lineupComparison?.topPick);

  useEffect(() => {
    document.documentElement.dataset.theme = colorTheme;
  }, [colorTheme]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPlayers() {
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
  }, [deferredQuery]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadGames() {
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
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error ? loadError.message : "Unable to load games.",
          );
        }
      }
    }

    void loadGames();
    return () => controller.abort();
  }, [selectedDate, selectedPlayer]);

  useEffect(() => {
    if (isAnalyzing || isComparingLineup) {
      return;
    }

    if (!hasResults) {
      return;
    }

    const scrollTimer = window.setTimeout(() => {
      resultsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 140);

    return () => window.clearTimeout(scrollTimer);
  }, [analysisId, hasResults, isAnalyzing, isComparingLineup, lineupComparisonId]);

  function selectPlayer(player: PlayerSearchResult) {
    setSelectedPlayer(player);
    setQuery(player.fullName);
    setPlayers([]);
    setActivePlayerIndex(-1);
    setAnalysis(null);
    setLineupComparison(null);
  }

  function addPlayerToParlay(player: ParlayPlayer) {
    setParlayPlayers((current) => {
      if (current.some((entry) => entry.id === player.id)) {
        return current;
      }

      return [...current, player];
    });
  }

  function removePlayerFromParlay(playerId: number) {
    setParlayPlayers((current) => current.filter((player) => player.id !== playerId));
  }

  function addAnalysisToParlay(result: AnalysisResult) {
    addPlayerToParlay({
      id: result.hitter.player.id,
      name: result.hitter.player.fullName,
      team: result.hitter.player.currentTeamAbbreviation,
      market: result.market,
      probability: result.probabilities.atLeastOne,
    });
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

  async function analyze() {
    if (!selectedPlayer || !selectedGamePk) {
      return;
    }

    const gamePk = selectedGamePk;

    setIsAnalyzing(true);
    setError(null);
    setFeedbackStatus(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          playerId: selectedPlayer.id,
          gamePk,
          market: selectedMarket,
        }),
      });

      const data = (await response.json()) as AnalysisResult & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to build analysis.");
      }

      setAnalysis(data);
      setLineupComparison(null);
      setQuery("");
      setPlayers([]);
      setSelectedPlayer(null);
      setSelectedGamePk(null);
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "Unable to build analysis.",
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function compareLineup(market: AnalysisMarket) {
    if (!selectedGamePk) {
      return;
    }

    const gamePk = selectedGamePk;

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
      setQuery("");
      setPlayers([]);
      setSelectedPlayer(null);
      setSelectedGamePk(null);
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
  const recommendationTone =
    analysis?.recommendation === "good play"
      ? "positive"
      : analysis?.recommendation === "avoid"
        ? "negative"
        : "neutral";
  const isModelLoading = isAnalyzing || isComparingLineup;
  const loadingTitle = isComparingLineup
    ? "Comparing The Lineup"
    : "Running Matchup Model";
  const loadingMessage = isComparingLineup
    ? "Ranking the published starters, matchup context, and weather signal."
    : "Checking hitter form, pitcher profile, weather, prior results, and matchup history.";

  function renderScheduleBoard() {
    return (
      <>
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Daily Board</p>
            <h2>Schedule For {formatScheduleDate(selectedDate)}</h2>
          </div>
          <span className="schedule-count">
            {games.length === 1 ? "1 game" : `${games.length} games`}
          </span>
        </div>

        {games.length > 0 ? (
          <div className="schedule-grid">
            {games.map((game) => {
              const isSelected = selectedGamePk === game.gamePk;

              return (
                <button
                  key={game.gamePk}
                  type="button"
                  className={`schedule-card ${getScheduleWeatherClass(game)}${
                    isSelected ? " selected" : ""
                  }`}
                  onClick={() => {
                    setSelectedGamePk(game.gamePk);
                    setAnalysis(null);
                    setLineupComparison(null);
                    setError(null);
                    setShowScheduleMenu(false);
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
                </button>
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
    <main className="shell">
      <aside className="parlay-builder" aria-label="Parlay builder">
        <div className="parlay-builder-header">
          <div>
            <span className="field-label">Parlay Builder</span>
            <strong>{parlayPlayers.length} players</strong>
          </div>
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

        {parlayPlayers.length > 0 ? (
          <ul className="parlay-list">
            {parlayPlayers.map((player) => (
              <li key={player.id}>
                <div>
                  <strong>{player.name}</strong>
                  <span>
                    {player.team ?? "MLB"}
                    {player.market
                      ? ` · ${getMarketLabel(player.market)} ${
                          player.probability !== null
                            ? formatPercent(player.probability)
                            : ""
                        }`
                      : ""}
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
        ) : (
          <p className="parlay-empty">Add players from the analysis card to build a shortlist.</p>
        )}
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

      <section className="hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <div className="hero-topline">
              <p className="eyebrow">2026 Live Data + 2025 Stabilization</p>
              <button
                type="button"
                className="theme-toggle"
                aria-pressed={colorTheme === "dark"}
                onClick={() => setStoredTheme(colorTheme === "dark" ? "light" : "dark")}
              >
                {colorTheme === "dark" ? "Day Mode" : "Night Mode"}
              </button>
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
          </div>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="analysis-column">
          <div className="panel controls-main panel-command">
          <div className="panel-heading-row">
            <div>
              <h2>Search And Analyze</h2>
              <p className="muted">
                Search one hitter or compare the published starters for the selected game.
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
                setQuery(event.target.value);
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
                  onClick={() => selectPlayer(player)}
                >
                  <span>
                    <strong>{player.fullName}</strong>
                  </span>
                  <span className="muted">
                    {player.currentTeamAbbreviation ?? "FA"} • {player.primaryPosition ?? "BAT"} •{" "}
                    {player.batSide ?? "?"} hitter
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {selectedPlayer ? (
            <div className="chip-row">
              <span className="chip">{selectedPlayer.fullName}</span>
              <span className="chip">{selectedPlayer.currentTeamName ?? "No team"}</span>
              <span className="chip">
                {selectedPlayer.batSide ?? "?"} hitter • {selectedPlayer.primaryPosition ?? "BAT"}
              </span>
            </div>
          ) : null}

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginTop: "1rem" }}>
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
                  setAnalysis(null);
                  setLineupComparison(null);
                }}
              >
                <option value="hit">Hit Probability</option>
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
                  setSelectedDate(event.target.value);
                  setSelectedGamePk(null);
                  setAnalysis(null);
                  setLineupComparison(null);
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
                  setAnalysis(null);
                  setLineupComparison(null);
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
            <span className="help-text">
              {selectedGame
                ? `${selectedGame.awayTeam.abbreviation} at ${selectedGame.homeTeam.abbreviation} selected. Use the dropdown for single-player analysis, or the dedicated lineup buttons for best hit and best home-run picks.`
                : "Pick a hitter, market, and game to run the model."}
            </span>
          </div>

          <div className="percentage-guide">
            <div className="percentage-guide-heading">
              <span className="field-label">Reading The Percentages</span>
              <p>
                The model number is an estimated chance for the selected outcome in this
                matchup, not a guarantee. Use it as a confidence signal, then compare it
                against risk, odds, lineup spot, and the previous model result.
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
            {lineupComparison?.topPick ? (
              <div className="panel" style={{ marginBottom: "1rem" }}>
            <p className="eyebrow">Starting Lineup Comparison</p>
            <h2>
              Best {lineupComparison.marketLabel.toLowerCase()} target:{" "}
              {lineupComparison.topPick.hitter.player.fullName}
            </h2>
            <p className="muted">
              {formatPercent(lineupComparison.topPick.probabilities.atLeastOne)} chance in{" "}
              {lineupComparison.game.awayTeam.abbreviation} at{" "}
              {lineupComparison.game.homeTeam.abbreviation}. The table below ranks every
              published starter in the game.
            </p>

            <div className="snapshot-grid" style={{ marginTop: "1rem" }}>
              {lineupComparison.players.slice(0, 6).map((entry, index) => (
                <div key={entry.analysisId} className="panel snapshot-card">
                  <h3>
                    #{index + 1} {entry.hitter.player.fullName}
                  </h3>
                  <button
                    type="button"
                    className="compact-add-button"
                    onClick={() => addAnalysisToParlay(entry)}
                    disabled={parlayPlayers.some(
                      (player) => player.id === entry.hitter.player.id,
                    )}
                  >
                    {parlayPlayers.some((player) => player.id === entry.hitter.player.id)
                      ? "Added"
                      : "Add To Parlay"}
                  </button>
                  <ul className="snapshot-list">
                    <li>Team: {entry.hitter.player.currentTeamAbbreviation ?? "n/a"}</li>
                    <li>Lineup slot: {entry.hitter.lineupSlot ?? "n/a"}</li>
                    <li>
                      {lineupComparison.marketLabel}:{" "}
                      {formatPercent(entry.probabilities.atLeastOne)}
                    </li>
                    <li>Confidence: {entry.confidence}</li>
                    <li>Call: {entry.recommendation}</li>
                    <li>Pitcher: {entry.pitcher.player?.fullName ?? "TBD"}</li>
                    <li>Pitcher hand: {getPitchHandLabel(entry.pitcher.player?.pitchHand)}</li>
                  </ul>
                </div>
              ))}
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
            <div className="grid secondary-grid">
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
                      (player) => player.id === analysis.hitter.player.id,
                    )}
                  >
                    {parlayPlayers.some((player) => player.id === analysis.hitter.player.id)
                      ? "Added"
                      : "Add To Parlay"}
                  </button>
                </div>
                <p className="eyebrow">{analysis.recommendation}</p>
                <div className="player-result-heading">
                  <div>
                    <h2>{analysis.hitter.player.fullName}</h2>
                    <span>{analysis.hitter.player.currentTeamName ?? "MLB"}</span>
                  </div>
                </div>
                <div className="probability">
                  {formatPercent(analysis.probabilities.atLeastOne)}
                </div>
                <p className="muted">{analysis.summary}</p>

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
            </div>

            <div className="factor-grid">
              {analysis.factors.map((factor) => (
                <div
                  key={factor.label}
                  className={`panel factor-card factor-impact-${factor.impact}`}
                >
                  <h3>{factor.label}</h3>
                  <div className="factor-value">{factor.value}</div>
                  <p className="factor-detail">{factor.detail}</p>
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
                  <li>Confidence: {analysis.confidence}</li>
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
