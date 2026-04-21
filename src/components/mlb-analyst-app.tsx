"use client";

import { useDeferredValue, useEffect, useRef, useState } from "react";

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
  const awayPitcher = game.awayProbablePitcher?.fullName ?? "TBD";
  const homePitcher = game.homeProbablePitcher?.fullName ?? "TBD";

  return `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation} | ${awayPitcher} vs ${homePitcher}`;
}

export function MlbAnalystApp({ defaultDate }: { defaultDate: string }) {
  const resultsRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [players, setPlayers] = useState<PlayerSearchResult[]>([]);
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
  const [lineupComparisonMarket, setLineupComparisonMarket] =
    useState<AnalysisMarket | null>(null);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null);
  const analysisId = analysis?.analysisId ?? null;
  const lineupComparisonId = lineupComparison?.generatedAt ?? null;
  const hasResults = Boolean(analysisId || lineupComparison?.topPick);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPlayers() {
      if (deferredQuery.trim().length < 2) {
        setPlayers([]);
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

    resultsRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [analysisId, hasResults, isAnalyzing, isComparingLineup, lineupComparisonId]);

  async function analyze() {
    if (!selectedPlayer || !selectedGamePk) {
      return;
    }

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
          gamePk: selectedGamePk,
          market: selectedMarket,
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
      setIsAnalyzing(false);
    }
  }

  async function compareLineup(market: AnalysisMarket) {
    if (!selectedGamePk) {
      return;
    }

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
          gamePk: selectedGamePk,
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

  async function saveFeedback(rating: FeedbackRating) {
    if (!analysis) {
      return;
    }

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          analysisId: analysis.analysisId,
          playerId: analysis.hitter.player.id,
          gamePk: analysis.game.gamePk,
          market: analysis.market,
          probability: analysis.probabilities.atLeastOne,
          recommendation: analysis.recommendation,
          rating,
          notes: feedbackNote,
        }),
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Unable to save feedback.");
      }

      setFeedbackStatus("Feedback saved for future tuning.");
      setFeedbackNote("");
    } catch (feedbackError) {
      setFeedbackStatus(
        feedbackError instanceof Error
          ? feedbackError.message
          : "Unable to save feedback.",
      );
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

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">2026 Live Data + 2025 Stabilization</p>
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

      <section className="grid controls">
        <div className="panel controls-main panel-command">
          <h2>Search And Analyze</h2>
          <p className="muted">
            The current model blends MLB StatsAPI, Baseball Savant, Open-Meteo, live
            probable pitchers, recent game data, prior-season carry-over, and now lets
            you analyze one hitter directly or compare the full starting lineup for both
            hits and home runs.
          </p>

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
            />
            {isSearching ? <div className="help-text">Searching current hitters...</div> : null}
          </div>

          {players.length > 0 ? (
            <div className="suggestions">
              {players.map((player) => (
                <button
                  key={player.id}
                  type="button"
                  className="suggestion"
                  onClick={() => {
                    setSelectedPlayer(player);
                    setQuery(player.fullName);
                    setPlayers([]);
                    setAnalysis(null);
                    setLineupComparison(null);
                  }}
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
              className="secondary-button"
              onClick={() => void compareLineup("hit")}
              disabled={!selectedGamePk || isComparingLineup}
            >
              {isComparingLineup && lineupComparisonMarket === "hit"
                ? "Comparing hit picks..."
                : "Find Best Hit Pick"}
            </button>
            <button
              type="button"
              className="secondary-button"
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

          {error ? <div className="error-text">{error}</div> : null}
        </div>

        <div className="panel controls-side panel-catalog">
          <h2>What This Uses</h2>
          <ul className="snapshot-list">
            <li>2026 hitter season line and 2025 prior-season stabilization</li>
            <li>2026 pitcher expected stats, contact quality, and pitch mix</li>
            <li>Recent Statcast results from previous games this season</li>
            <li>Opponent fielding, Outs Above Average, and arm strength</li>
            <li>Venue geometry, roof type, turf type, and forecast weather</li>
            <li>Live lineup slot when MLB has published it</li>
            <li>Market-specific logic for either hits or home runs</li>
          </ul>

          <div className="game-select-list" style={{ marginTop: "1rem" }}>
            {games.slice(0, 4).map((game) => (
              <div key={game.gamePk} className="game-option">
                <strong>
                  {game.awayTeam.abbreviation} @ {game.homeTeam.abbreviation}
                </strong>
                <div className="muted">{buildGameLabel(game)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section ref={resultsRef} className="results">
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
                <p className="eyebrow">{analysis.recommendation}</p>
                <h2>{analysis.hitter.player.fullName}</h2>
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
                <h2>Model Notes</h2>
                <p className="muted">
                  {analysis.game.awayTeam.name} at {analysis.game.homeTeam.name} on{" "}
                  {analysis.game.officialDate}. Probable pitcher:{" "}
                  {analysis.pitcher.player?.fullName ?? "TBD"}. Market:{" "}
                  {analysis.marketLabel}.
                </p>

                {analysis.aiSummary ? (
                  <>
                    <h3 style={{ marginTop: "1rem" }}>AI Summary</h3>
                    <p className="muted">{analysis.aiSummary}</p>
                  </>
                ) : null}

                <ul className="note-list">
                  {analysis.notes.length > 0 ? (
                    analysis.notes.map((note) => <li key={note}>{note}</li>)
                  ) : (
                    <li>The model had enough context that it did not need special caveats.</li>
                  )}
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
              </div>

              {feedbackStatus ? <div className="status-text">{feedbackStatus}</div> : null}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
