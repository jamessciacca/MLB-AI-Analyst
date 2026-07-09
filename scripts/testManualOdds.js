#!/usr/bin/env node

const TEST_INPUTS = [
  "-135",
  "+120",
  "120",
  "DraftKings -145",
  "DK +180",
  "FanDuel +220",
  "abc",
  "0",
];

const MODEL_PROBABILITY = 0.66;

function americanOddsToImpliedProbability(odds) {
  if (odds === null || odds === undefined || !Number.isFinite(odds) || odds === 0) {
    return null;
  }

  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function manualOddsValueRating(edge) {
  if (edge >= 0.07) {
    return "strong positive value";
  }
  if (edge >= 0.03) {
    return "positive value";
  }
  if (edge <= -0.07) {
    return "bad value";
  }
  if (edge <= -0.03) {
    return "overpriced";
  }

  return "fair/no clear edge";
}

function normalizeSportsbookName(input) {
  const trimmed = String(input || "").trim();

  if (!trimmed) {
    return null;
  }

  const compact = trimmed.toLowerCase().replace(/[^a-z]/g, "");

  if (compact === "dk" || compact === "draftkings") {
    return "DraftKings";
  }

  return trimmed;
}

function normalizeAmericanOddsInput(input) {
  const originalInput = String(input ?? "").trim();

  if (!originalInput) {
    return { ok: false, error: "Enter American odds like -135 or DraftKings -145." };
  }

  const match = originalInput.match(/([+-]?\d+)(?!.*[+-]?\d+)/);

  if (!match) {
    return { ok: false, error: "Odds must include a number like -135 or +120." };
  }

  const parsed = Number(match[1]);

  if (!Number.isFinite(parsed) || parsed === 0) {
    return { ok: false, error: "American odds cannot be 0." };
  }

  const sportsbookText = originalInput.replace(match[1], "").replace(/[-+]/g, " ").trim();
  const sportsbook = normalizeSportsbookName(sportsbookText);

  if (sportsbook && sportsbook !== "DraftKings") {
    return { ok: false, error: "Only DraftKings manual odds are supported right now." };
  }

  const impliedProbability = americanOddsToImpliedProbability(parsed);

  if (impliedProbability === null) {
    return { ok: false, error: "Unable to convert odds into implied probability." };
  }

  return {
    ok: true,
    value: {
      originalInput,
      normalizedOdds: parsed,
      impliedProbability,
      edge: MODEL_PROBABILITY - impliedProbability,
      valueRating: manualOddsValueRating(MODEL_PROBABILITY - impliedProbability),
      sportsbook: "DraftKings",
    },
  };
}

for (const input of TEST_INPUTS) {
  const result = normalizeAmericanOddsInput(input);

  console.log("");
  console.log(`Input: ${input}`);

  if (!result.ok) {
    console.log(`Error: ${result.error}`);
    continue;
  }

  console.log(`Normalized odds: ${result.value.normalizedOdds > 0 ? `+${result.value.normalizedOdds}` : result.value.normalizedOdds}`);
  console.log(`Implied probability: ${(result.value.impliedProbability * 100).toFixed(2)}%`);
  console.log(`Model edge vs 66.00%: ${result.value.edge >= 0 ? "+" : ""}${(result.value.edge * 100).toFixed(2)}%`);
  console.log(`Value rating: ${result.value.valueRating}`);
}
