#!/usr/bin/env node

const playerName = process.argv[2];
const date = process.argv[3] || new Date().toISOString().slice(0, 10);
const baseUrl = process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;

if (!playerName) {
  console.error('Usage: node scripts/testPlayerHitAnalysis.js "Aaron Judge" [YYYY-MM-DD]');
  process.exit(1);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error || `Request failed: ${response.status}`);
  }

  return json;
}

async function main() {
  const search = await fetchJson(
    `${baseUrl}/api/players/search?q=${encodeURIComponent(playerName)}`,
  );
  const player = search.players?.[0];

  if (!player) {
    throw new Error(`No player match found for "${playerName}".`);
  }

  const result = await fetchJson(
    `${baseUrl}/api/mlb/player-hit-analysis?playerId=${player.id}&date=${encodeURIComponent(
      date,
    )}`,
  );

  console.log(`Player: ${result.requestResolution.matchedPlayerName}`);
  console.log(
    `Game: ${result.game.awayTeam.abbreviation} @ ${result.game.homeTeam.abbreviation} (${result.game.gamePk})`,
  );
  console.log(
    `Probability: ${(result.analystEngine.predictedProbability * 100).toFixed(1)}%`,
  );
  console.log(`Fair odds: ${result.analystEngine.fairOdds ?? "n/a"}`);
  console.log(`Confidence: ${result.analystEngine.confidence}`);
  console.log(`Recommendation: ${result.analystEngine.recommendation}`);
  console.log(`Pattern: ${result.analystEngine.detectedPattern?.patternLabel ?? "n/a"}`);
  console.log(`Summary: ${result.analystEngine.summary}`);
  console.log(`Why for: ${(result.analystEngine.topReasonsFor || []).join(" | ")}`);
  console.log(
    `Why against: ${(result.analystEngine.topReasonsAgainst || []).join(" | ")}`,
  );
  console.log(
    `Warnings: ${(result.analystEngine.dataQuality.warnings || []).join(" | ") || "none"}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unable to test player hit analysis.");
  process.exit(1);
});
