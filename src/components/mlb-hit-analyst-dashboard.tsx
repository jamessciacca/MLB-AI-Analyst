"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";

import {
  type BestHittersBoardResponse,
  type ModelPerformanceSummaryResponse,
} from "@/lib/analyst/board-types";
import { type AnalystPredictionResult } from "@/lib/analyst/types";

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

function formatPercentMaybe(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined) {
    return "n/a";
  }

  return formatPercent(value, digits);
}

function formatNumberMaybe(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined) {
    return "n/a";
  }

  return value.toFixed(digits);
}

function displayedMarketProbability(analyst: AnalystPredictionResult | null | undefined) {
  return analyst?.noVigMarketProbability ?? analyst?.sportsbookImpliedProbability ?? null;
}

function valueToneClass(valueRating: AnalystPredictionResult["valueRating"] | null | undefined) {
  if (valueRating === "positive value") {
    return "positive";
  }
  if (valueRating === "overpriced") {
    return "negative";
  }
  if (valueRating === "no odds available") {
    return "unavailable";
  }

  return "neutral";
}

function oddsSummaryText(analyst: AnalystPredictionResult) {
  if (analyst.sportsbookOdds === null || analyst.sportsbookOdds === undefined) {
    return "No sportsbook player prop was available yet, so this card is leaning on the model, simulation, and matchup context instead of a live price.";
  }

  return `Model: ${formatPercent(analyst.predictedProbability, 1)} | Market: ${formatPercent(displayedMarketProbability(analyst) ?? analyst.sportsbookImpliedProbability ?? 0, 1)} | Fair odds: ${formatAmericanOdds(analyst.fairOdds)} | Sportsbook: ${formatAmericanOdds(analyst.sportsbookOdds)} | Edge: ${formatSignedPercent(analyst.edgeIfAvailable, 1)}`;
}

function MetricTile({
  label,
  value,
  note,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: "default" | "positive" | "negative" | "neutral";
}) {
  return (
    <div className={`analyst-metric-tile ${tone}`}>
      <span className="field-label">{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

function DataSection({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <section className="analyst-data-section">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

function DashboardLoadingScreen({ date }: { date: string }) {
  return (
    <section className="panel hit-analyst-loading-screen" aria-live="polite" aria-busy="true">
      <div className="hit-analyst-loader-orbit" aria-hidden="true">
        <span />
      </div>
      <div className="hit-analyst-loading-copy">
        <p className="eyebrow">Building Hit Board</p>
        <h2>Organizing the {date} card</h2>
        <p className="muted">
          Pulling lineups, matchup context, simulations, odds, model calibration, and
          hitter-selection notes into one clean board.
        </p>
      </div>
      <div className="hit-analyst-loading-steps">
        {[
          "Lineups",
          "Pitcher Matchups",
          "Recent Form",
          "Simulation",
          "Odds Value",
          "Risk Notes",
        ].map((step) => (
          <span key={step}>{step}</span>
        ))}
      </div>
    </section>
  );
}

export function MlbHitAnalystDashboard({ defaultDate }: { defaultDate: string }) {
  const [selectedDate, setSelectedDate] = useState(defaultDate);
  const [board, setBoard] = useState<BestHittersBoardResponse | null>(null);
  const [performance, setPerformance] = useState<ModelPerformanceSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDailyTopFour, setShowDailyTopFour] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const [boardResponse, performanceResponse] = await Promise.all([
          fetch(`/api/mlb/best-hitters-by-game?date=${encodeURIComponent(selectedDate)}`),
          fetch("/api/mlb/model-performance"),
        ]);
        const boardJson = (await boardResponse.json()) as BestHittersBoardResponse & {
          error?: string;
        };
        const performanceJson = (await performanceResponse.json()) as ModelPerformanceSummaryResponse & {
          error?: string;
        };

        if (!boardResponse.ok) {
          throw new Error(boardJson.error ?? "Unable to load best hitters board.");
        }
        if (!performanceResponse.ok) {
          throw new Error(performanceJson.error ?? "Unable to load model performance.");
        }

        if (!cancelled) {
          setBoard(boardJson);
          setPerformance(performanceJson);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load the MLB hit analyst dashboard.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  const availableGames = board?.games.filter((game) => game.available).length ?? 0;
  const dailyTopPicks = board?.dailyTopPicks ?? [];

  return (
    <main className="shell hit-analyst-shell">
      <section className="hero hit-analyst-hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <div className="hero-topline">
              <p className="eyebrow">Professional Hit-Prop Board</p>
              <div className="hero-action-row">
                <Link href="/" className="theme-toggle theme-toggle-link">
                  Main App
                </Link>
                <Link href="/keepsakes" className="theme-toggle theme-toggle-link">
                  Slip Keepsakes
                </Link>
              </div>
            </div>
            <h1>MLB Hit Analyst</h1>
            <p>
              This board looks for the best hit-prop candidate in each game, not just the
              biggest name. It weighs recent process, contact quality, matchup fit,
              simulation, environment, calibration, and value-aware selection logic.
            </p>
          </div>
        </div>
      </section>

      <section className="panel hit-analyst-controls">
        <div>
          <p className="eyebrow">Board Controls</p>
          <h2>Daily Hit Board</h2>
          <p className="muted">
            Pick a date to rebuild the best-hitters-by-game board from the current data
            pipeline.
          </p>
        </div>
        <div className="hit-analyst-control-row">
          <label className="field-group">
            <span className="field-label">Date</span>
            <input
              type="date"
              className="select-input"
              value={selectedDate}
              onChange={(event) => {
                setSelectedDate(event.target.value);
                setShowDailyTopFour(false);
              }}
            />
          </label>
          <button
            type="button"
            className="theme-toggle hit-analyst-primary-action"
            disabled={isLoading || !board || dailyTopPicks.length === 0}
            onClick={() => setShowDailyTopFour((current) => !current)}
          >
            {showDailyTopFour ? "Hide Best 4" : "Find Best 4 Hit Picks"}
          </button>
        </div>
      </section>

      {error ? (
        <section className="panel">
          <h2>Unable To Load Board</h2>
          <p className="muted">{error}</p>
        </section>
      ) : null}

      {isLoading ? <DashboardLoadingScreen date={selectedDate} /> : null}

      {!isLoading && board ? (
        <>
          <section className="panel analyst-readable-panel">
            <div className="panel-heading-row">
              <div>
                <p className="eyebrow">Board Overview</p>
                <h2>{board.officialDate} Hit-Prop Candidates</h2>
                <p className="muted">
                  {availableGames} game{availableGames === 1 ? "" : "s"} currently have a
                  selected hit-prop candidate on the board.
                </p>
              </div>
            </div>
            <div className="stat-strip analyst-stat-strip">
              <div className="stat-box">
                <span className="field-label">Games On Board</span>
                <strong>{board.games.length}</strong>
              </div>
              <div className="stat-box">
                <span className="field-label">Available Picks</span>
                <strong>{availableGames}</strong>
              </div>
              <div className="stat-box">
                <span className="field-label">Sources</span>
                <strong>{board.sourcesUsed.length}</strong>
              </div>
            </div>
            {board.warnings.length > 0 ? (
              <ul className="compact-list">
                {board.warnings.slice(0, 4).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </section>

          {showDailyTopFour ? (
            <section className="panel analyst-readable-panel daily-top-four-panel">
              <div className="panel-heading-row">
                <div>
                  <p className="eyebrow">Best 4 Hit Picks</p>
                  <h2>Daily Shortlist Comparison</h2>
                  <p className="muted">
                    {board.dailyTopPicksComparison?.summary ??
                      "The model did not find four fully available hit picks for this date."}
                  </p>
                </div>
                <div className="hit-board-probability daily-top-four-count">
                  <span className="field-label">Picks</span>
                  <strong>{dailyTopPicks.length}</strong>
                </div>
              </div>

              {board.dailyTopPicksComparison ? (
                <>
                  <div className="daily-top-four-differentiators">
                    {board.dailyTopPicksComparison.differentiators.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>

                  <div className="daily-top-four-grid">
                    {dailyTopPicks.map((pick) => (
                      <article key={`${pick.gamePk}-${pick.playerId}`} className="daily-top-four-card">
                        <div className="daily-top-four-card-top">
                          <span className="daily-top-four-rank">#{pick.rank}</span>
                          <div>
                            <p className="eyebrow">{pick.gameLabel}</p>
                            <h3>{pick.playerName}</h3>
                            <p className="muted">
                              {pick.team ?? "MLB"} vs {pick.opponent} · {pick.venueName}
                            </p>
                          </div>
                        </div>

                        <div className="analyst-decision-grid daily-top-four-metrics">
                          <MetricTile
                            label="Hit Prob."
                            value={formatPercent(pick.hitProbability, 1)}
                            note="Model"
                            tone="positive"
                          />
                          <MetricTile
                            label="Daily Score"
                            value={formatNumberMaybe(pick.dailyScore, 2)}
                            note="Rank"
                          />
                          <MetricTile
                            label="Matchup"
                            value={formatPercent(pick.matchupScore, 0)}
                            note="Pitcher fit"
                          />
                          <MetricTile
                            label="Lineup"
                            value={pick.lineupSlot ? `#${pick.lineupSlot}` : "TBD"}
                            note={formatPercent(pick.lineupOpportunityScore, 0)}
                          />
                          <MetricTile
                            label="History"
                            value={formatPercent(pick.recentHistoryScore, 0)}
                            note="Recent"
                          />
                          <MetricTile
                            label="Fair Odds"
                            value={formatAmericanOdds(pick.fairOdds)}
                            note={formatSignedPercent(pick.edgeIfAvailable, 1)}
                          />
                        </div>

                        <p className="hit-board-summary">{pick.comparisonSummary}</p>

                        <div className="daily-top-four-detail-grid">
                          <DataSection title="Matchup" eyebrow="Pitcher">
                            <p className="hit-board-summary">{pick.matchupSummary}</p>
                          </DataSection>
                          <DataSection title="Previous Game" eyebrow="History">
                            <p className="hit-board-summary">{pick.previousGameSummary}</p>
                          </DataSection>
                        </div>

                        <div className="daily-top-four-detail-grid">
                          <DataSection title="Why It Made The Four">
                            <ul className="compact-list">
                              {pick.whyTopFour.map((reason) => (
                                <li key={reason}>{reason}</li>
                              ))}
                            </ul>
                          </DataSection>
                          <DataSection title="Risk Check">
                            <ul className="compact-list">
                              {(pick.riskNotes.length > 0
                                ? pick.riskNotes
                                : ["No extra risk flag rose above normal hit-prop variance."]).map((risk) => (
                                <li key={risk}>{risk}</li>
                              ))}
                            </ul>
                          </DataSection>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <ul className="compact-list">
                  <li>Not enough games have confirmed hitter boards for a four-pick comparison yet.</li>
                </ul>
              )}
            </section>
          ) : null}

          {performance ? (
            <section className="panel analyst-readable-panel">
              <p className="eyebrow">Model Performance</p>
              <h2>Calibration And Feedback Snapshot</h2>
              <div className="snapshot-grid analyst-snapshot-grid">
                <div className="panel snapshot-card">
                  <h3>Hit Calibration</h3>
                  <ul className="snapshot-list">
                        <li>
                      Adjustment:{" "}
                      {performance.feedbackCalibration.markets.hit.adjustment.toFixed(4)}
                    </li>
                    <li>
                      Sample size: {performance.feedbackCalibration.markets.hit.sampleSize}
                    </li>
                    <li>
                      Correct / Too High / Too Low:{" "}
                      {performance.feedbackCalibration.markets.hit.correctCount} /{" "}
                      {performance.feedbackCalibration.markets.hit.tooHighCount} /{" "}
                      {performance.feedbackCalibration.markets.hit.tooLowCount}
                    </li>
                  </ul>
                </div>
                <div className="panel snapshot-card">
                  <h3>Training Artifacts</h3>
                  <ul className="snapshot-list">
                    <li>
                      Calibration artifact:{" "}
                      {performance.artifactCalibration ? "available" : "missing"}
                    </li>
                    <li>
                      Training summary: {performance.trainingSummary ? "available" : "missing"}
                    </li>
                  </ul>
                </div>
                <div className="panel snapshot-card">
                  <h3>Notes</h3>
                  <ul className="snapshot-list">
                    {performance.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          ) : null}

          <section className="hit-board-grid">
            {board.games.map((entry) => {
              const selected = entry.selection;
              const selectedAnalyst = entry.selectedAnalyst;

              return (
                <article key={entry.game.gamePk} className="panel hit-board-card analyst-readable-panel">
                  <div className="hit-board-card-top">
                    <div className="hit-board-title-block">
                      <p className="eyebrow">
                        {entry.game.awayTeam.abbreviation} @ {entry.game.homeTeam.abbreviation}
                      </p>
                      <h2>{entry.available ? selected?.selectedHitter ?? entry.topPick?.hitter.player.fullName : "Board Pending"}</h2>
                      <div className="hit-board-meta-row">
                        <span>{entry.game.venue.name}</span>
                        <span>{entry.game.status}</span>
                        {selected ? <span>{selected.team} vs {selected.opponent}</span> : null}
                      </div>
                    </div>
                    {selectedAnalyst ? (
                      <div className="hit-board-probability">
                        <span className="field-label">Model Probability</span>
                        <strong>{formatPercent(selectedAnalyst.predictedProbability, 1)}</strong>
                      </div>
                    ) : null}
                  </div>

                  {!entry.available || !selected || !selectedAnalyst ? (
                    <ul className="compact-list">
                      {(entry.warnings.length > 0
                        ? entry.warnings
                        : ["A full hit board is not available for this game yet."]).map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : (
                    <>
                      <div className="analyst-decision-grid">
                        <MetricTile
                          label="Hit Probability"
                          value={formatPercent(selectedAnalyst.predictedProbability, 1)}
                          note="Model"
                          tone="positive"
                        />
                        <MetricTile
                          label="Fair Odds"
                          value={formatAmericanOdds(selectedAnalyst.fairOdds)}
                          note="Internal price"
                        />
                        <MetricTile
                          label="Edge"
                          value={formatSignedPercent(selectedAnalyst.edgeIfAvailable, 1)}
                          note={selectedAnalyst.valueRating}
                          tone={valueToneClass(selectedAnalyst.valueRating) === "positive" ? "positive" : "neutral"}
                        />
                        <MetricTile
                          label="Confidence"
                          value={selected.confidence}
                          note={selected.recommendation}
                        />
                        <MetricTile
                          label="Pattern"
                          value={selectedAnalyst.detectedPattern?.patternLabel ?? "steady_profile"}
                          note="Contact profile"
                        />
                        <MetricTile
                          label="Final Score"
                          value={formatNumberMaybe(selected.finalScore, 2)}
                          note="Selection model"
                        />
                      </div>

                      <div className="analyst-card-layout">
                        <DataSection title="Odds And Value" eyebrow="Market">
                          <div className="odds-summary-heading">
                            <span className={`value-pill ${valueToneClass(selectedAnalyst.valueRating)}`}>
                              {selectedAnalyst.valueRating}
                            </span>
                          </div>
                          <div className="odds-summary-lines">
                            <div className="odds-summary-line">
                              <span>Sportsbook</span>
                              <strong>{formatAmericanOdds(selectedAnalyst.sportsbookOdds)}</strong>
                            </div>
                            <div className="odds-summary-line">
                              <span>Book Implied</span>
                              <strong>
                                {formatPercentMaybe(selectedAnalyst.sportsbookImpliedProbability, 1)}
                              </strong>
                            </div>
                            <div className="odds-summary-line">
                              <span>No-Vig Market</span>
                              <strong>
                                {formatPercentMaybe(selectedAnalyst.noVigMarketProbability, 1)}
                              </strong>
                            </div>
                            <div className="odds-summary-line">
                              <span>Fair Odds</span>
                              <strong>{formatAmericanOdds(selectedAnalyst.fairOdds)}</strong>
                            </div>
                            <div className="odds-summary-line">
                              <span>Edge</span>
                              <strong>{formatSignedPercent(selectedAnalyst.edgeIfAvailable, 1)}</strong>
                            </div>
                          </div>
                          <p className="odds-summary-copy">{oddsSummaryText(selectedAnalyst)}</p>
                        </DataSection>

                        <DataSection title="Analyst Read" eyebrow="Summary">
                          <p className="hit-board-summary">{selected.analystNarrative.analystParagraph}</p>
                        </DataSection>
                      </div>

                      <div className="analyst-card-layout analyst-card-layout-thirds">
                        <DataSection title="Why This Player">
                          <ul className="compact-list">
                            {selected.whyHeStandsOut.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        </DataSection>
                        <DataSection title="Why Not The Star">
                          <ul className="compact-list">
                            {(selected.whyNotTheStarPlayer.length > 0
                              ? selected.whyNotTheStarPlayer
                              : ["The obvious star actually cleared the evidence bar in this matchup."]).map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        </DataSection>
                        <DataSection title="Risks">
                          <ul className="compact-list">
                            {(selected.risks.length > 0
                              ? selected.risks
                              : ["No extra risk flag rose above normal variance."]).map((risk) => (
                              <li key={risk}>{risk}</li>
                            ))}
                          </ul>
                        </DataSection>
                      </div>

                      <div className="analyst-card-layout analyst-card-layout-thirds">
                        <DataSection title="Simulation" eyebrow="Projection">
                          <ul className="snapshot-list">
                            <li>{selectedAnalyst.simulationSummary?.summary ?? "Simulation unavailable."}</li>
                            <li>
                              No-hit probability:{" "}
                              {selectedAnalyst.simulationSummary
                                ? formatPercent(selectedAnalyst.simulationSummary.noHitProbability, 1)
                                : "n/a"}
                            </li>
                            <li>
                              Average hits:{" "}
                              {selectedAnalyst.simulationSummary
                                ? selectedAnalyst.simulationSummary.averageSimulatedHits.toFixed(2)
                                : "n/a"}
                            </li>
                          </ul>
                        </DataSection>
                        <DataSection title="Top Alternatives" eyebrow="Comparison">
                          <ul className="snapshot-list">
                            {selected.topAlternatives.map((alternative) => (
                              <li key={alternative.playerId}>
                                {alternative.playerName}: {formatPercent(alternative.hitProbability, 1)} ·{" "}
                                {alternative.reason}
                              </li>
                            ))}
                          </ul>
                        </DataSection>
                        <DataSection title="Data Quality" eyebrow="Inputs">
                          <ul className="snapshot-list">
                            <li>Sources: {selectedAnalyst.dataQuality.sourcesUsed.join(", ")}</li>
                            <li>
                              Missing:{" "}
                              {selectedAnalyst.dataQuality.missingFields.length > 0
                                ? selectedAnalyst.dataQuality.missingFields.join(", ")
                                : "none"}
                            </li>
                            <li>
                              Confidence note: {selected.analystNarrative.confidenceExplanation}
                            </li>
                          </ul>
                        </DataSection>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </section>
        </>
      ) : null}
    </main>
  );
}
