#!/usr/bin/env node

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const baseUrl = process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;

function americanOddsToImpliedProbability(odds) {
  if (odds === null || odds === undefined || !Number.isFinite(odds) || odds === 0) {
    return null;
  }

  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function probabilityToFairAmericanOdds(probability) {
  if (
    probability === null ||
    probability === undefined ||
    !Number.isFinite(probability) ||
    probability <= 0 ||
    probability >= 1
  ) {
    return null;
  }

  return probability >= 0.5
    ? -Math.round((probability / (1 - probability)) * 100)
    : Math.round(((1 - probability) / probability) * 100);
}

function formatAmericanOdds(value) {
  if (value === null || value === undefined) {
    return "n/a";
  }

  return value > 0 ? `+${value}` : String(value);
}

function formatPercent(value, digits = 1) {
  if (value === null || value === undefined) {
    return "n/a";
  }

  return `${(value * 100).toFixed(digits)}%`;
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
  const moneyline = await fetchJson(
    `${baseUrl}/api/odds/mlb/moneyline?date=${encodeURIComponent(date)}`,
  );

  console.log(`MLB moneyline odds for ${moneyline.officialDate}`);

  if (!moneyline.available) {
    console.log(`Unavailable: ${(moneyline.warnings || []).join(" | ") || "No odds available."}`);
    return;
  }

  for (const game of (moneyline.odds || []).slice(0, 5)) {
    console.log(
      `${game.game}: ${formatAmericanOdds(game.awayOdds)} / ${formatAmericanOdds(game.homeOdds)} | no-vig ${formatPercent(game.noVigAwayProbability)} / ${formatPercent(game.noVigHomeProbability)} | ${game.bookmaker || "book n/a"}`,
    );
  }

  const firstEvent = moneyline.odds?.[0];

  if (!firstEvent?.eventId) {
    console.log(`Warnings: ${(moneyline.warnings || []).join(" | ") || "No matched events."}`);
    return;
  }

  const props = await fetchJson(
    `${baseUrl}/api/odds/mlb/event/${encodeURIComponent(firstEvent.eventId)}/player-props`,
  );

  console.log("");
  console.log(`Event ${firstEvent.eventId} player props`);
  console.log(`Hit props found: ${(props.batterHits || []).length}`);
  console.log(`Home run props found: ${(props.batterHomeRuns || []).length}`);

  for (const prop of (props.batterHits || []).slice(0, 3)) {
    console.log(
      `HIT ${prop.playerName}: over ${formatAmericanOdds(prop.overOdds)} | under ${formatAmericanOdds(prop.underOdds)} | no-vig over ${formatPercent(prop.noVigOverProbability)}`,
    );
  }

  for (const prop of (props.batterHomeRuns || []).slice(0, 3)) {
    console.log(
      `HR ${prop.playerName}: over ${formatAmericanOdds(prop.overOdds)} | under ${formatAmericanOdds(prop.underOdds)} | no-vig over ${formatPercent(prop.noVigOverProbability)}`,
    );
  }

  console.log("");
  console.log("Math checks");
  console.log(
    `-140 implied probability: ${formatPercent(americanOddsToImpliedProbability(-140))}`,
  );
  console.log(`66.2% fair odds: ${formatAmericanOdds(probabilityToFairAmericanOdds(0.662))}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unable to test Vegas odds.");
  process.exit(1);
});
