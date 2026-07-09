#!/usr/bin/env node

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const market = process.argv[3] || "hit";
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
  console.log(`Testing best hitter explanations for ${date} (${market})`);
  console.log(`Using app at ${baseUrl}`);

  const games = await fetchJson(`${baseUrl}/api/games?date=${encodeURIComponent(date)}`);

  for (const game of games.games || []) {
    try {
      const comparison = await fetchJson(`${baseUrl}/api/analyze-lineup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gamePk: game.gamePk,
          market,
        }),
      });
      const selection = comparison.selection;

      console.log("");
      console.log(`${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`);

      if (!selection) {
        const topPick = comparison.topPick;
        console.log(
          `Top pick: ${topPick?.hitter?.player?.fullName || "n/a"} ${
            topPick ? `(${(topPick.probabilities.atLeastOne * 100).toFixed(1)}%)` : ""
          }`,
        );
        console.log("Selection explanation engine was not available for this market.");
        continue;
      }

      console.log(
        `Selected hitter: ${selection.selectedHitter} (${(selection.hitProbability * 100).toFixed(1)}%, ${selection.confidence})`,
      );
      console.log(`Recommendation: ${selection.recommendation}`);
      console.log(`Why selected: ${selection.whyHeStandsOut.join(" | ")}`);
      console.log(
        `Why not the obvious star: ${
          selection.whyNotTheStarPlayer.join(" | ") || "The obvious star still graded best."
        }`,
      );
      console.log(
        `Top 3 alternatives: ${selection.topAlternatives
          .map(
            (entry) =>
              `${entry.playerName} ${(entry.hitProbability * 100).toFixed(1)}% (${entry.reason})`,
          )
          .join(" | ")}`,
      );
      console.log(
        `Risk notes: ${selection.risks.join(" | ") || "No major extra risk note."}`,
      );
      console.log(`Analyst note: ${selection.analystNarrative.analystParagraph}`);
    } catch (error) {
      console.log("");
      console.log(`${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`);
      console.log(
        `Skipped: ${error instanceof Error ? error.message : "Unable to build explanation."}`,
      );
    }
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Unable to run best hitter explanation test.",
  );
  process.exit(1);
});
