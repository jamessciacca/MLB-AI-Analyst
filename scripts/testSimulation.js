#!/usr/bin/env node

const playerName = process.argv[2];
const date = process.argv[3] || new Date().toISOString().slice(0, 10);
const baseUrl = process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;

if (!playerName) {
  console.error('Usage: node scripts/testSimulation.js "Nico Hoerner" [YYYY-MM-DD]');
  process.exit(1);
}

async function fetchJson(url) {
  const response = await fetch(url);
  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error || `Request failed: ${response.status}`);
  }

  return json;
}

async function main() {
  const players = await fetchJson(
    `${baseUrl}/api/players/search?q=${encodeURIComponent(playerName)}`,
  );
  const player = players.players?.[0];

  if (!player) {
    throw new Error(`No player match found for "${playerName}".`);
  }

  const analysis = await fetchJson(
    `${baseUrl}/api/mlb/player-hit-analysis?playerId=${player.id}&date=${encodeURIComponent(
      date,
    )}`,
  );
  const simulation = analysis.analystEngine.simulationSummary;

  if (!simulation) {
    throw new Error("Simulation summary was unavailable for this player.");
  }

  console.log(`Player: ${analysis.requestResolution.matchedPlayerName}`);
  console.log(
    `Game: ${analysis.game.awayTeam.abbreviation} @ ${analysis.game.homeTeam.abbreviation}`,
  );
  console.log(`Simulated hit probability: ${(simulation.simulatedHitProbability * 100).toFixed(1)}%`);
  console.log(`No-hit probability: ${(simulation.noHitProbability * 100).toFixed(1)}%`);
  console.log(`Average hits: ${simulation.averageSimulatedHits.toFixed(2)}`);
  console.log(
    `Confidence interval: ${(simulation.confidenceInterval[0] * 100).toFixed(1)}% to ${(simulation.confidenceInterval[1] * 100).toFixed(1)}%`,
  );
  console.log(`Drivers: ${simulation.mostImportantFactors.join(" | ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unable to test simulation.");
  process.exit(1);
});
