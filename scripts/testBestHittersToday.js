#!/usr/bin/env node

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const baseUrl = process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error || `Request failed: ${response.status}`);
  }

  return json;
}

async function main() {
  const board = await fetchJson(
    `${baseUrl}/api/mlb/best-hitters-by-game?date=${encodeURIComponent(date)}`,
  );

  console.log(`Best hitters by game for ${board.officialDate}`);

  for (const game of board.games || []) {
    const label = `${game.game.awayTeam.abbreviation} @ ${game.game.homeTeam.abbreviation}`;
    console.log("");
    console.log(label);

    if (!game.available || !game.selection) {
      console.log(`Pending: ${game.warnings.join(" | ") || "No full board available."}`);
      continue;
    }

    console.log(
      `Selected: ${game.selection.selectedHitter} (${(game.selection.hitProbability * 100).toFixed(1)}%, ${game.selection.confidence})`,
    );
    console.log(`Recommendation: ${game.selection.recommendation}`);
    console.log(`Why: ${game.selection.whyHeStandsOut.join(" | ")}`);
    console.log(
      `Why not star: ${game.selection.whyNotTheStarPlayer.join(" | ") || "Star still graded best."}`,
    );
    console.log(
      `Alternatives: ${game.selection.topAlternatives
        .map((entry) => `${entry.playerName} ${(entry.hitProbability * 100).toFixed(1)}%`)
        .join(" | ")}`,
    );
    console.log(`Risks: ${game.selection.risks.join(" | ") || "none"}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unable to test best hitters today.");
  process.exit(1);
});
