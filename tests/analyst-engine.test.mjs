import assert from "node:assert/strict";
import test from "node:test";

import {
  americanOddsToImpliedProbability,
  expectedValueFromAmericanOdds,
  probabilityToAmericanOdds,
  removeVig,
} from "../src/lib/analyst/math.ts";
import { getBallparkContext } from "../src/lib/analyst/ballpark-service.ts";
import { getAnalystWeights } from "../src/lib/analyst/weights.ts";

test("american odds convert to implied probability", () => {
  assert.ok(Math.abs(americanOddsToImpliedProbability(-150) - 0.6) < 0.001);
  assert.ok(Math.abs(americanOddsToImpliedProbability(+150) - 0.4) < 0.001);
});

test("probability converts back to fair american odds", () => {
  assert.equal(probabilityToAmericanOdds(0.6), -150);
  assert.equal(probabilityToAmericanOdds(0.4), 150);
});

test("remove vig normalizes both sides to one", () => {
  const noVig = removeVig(0.54, 0.5);

  assert.ok(noVig.noVigHomeProbability > 0.5);
  assert.ok(
    Math.abs((noVig.noVigHomeProbability ?? 0) + (noVig.noVigAwayProbability ?? 0) - 1) <
      0.0001,
  );
});

test("expected value is positive when model edge beats the price", () => {
  const ev = expectedValueFromAmericanOdds(0.58, 110);

  assert.ok(ev !== null);
  assert.ok(ev > 0);
});

test("analyst weights stay normalized", () => {
  const weights = getAnalystWeights();
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);

  assert.ok(Math.abs(total - 1) < 0.0001);
});

test("ballpark fallback recognizes Coors as a positive hitting environment", () => {
  const context = getBallparkContext(
    {
      venueId: 19,
      name: "Coors Field",
      latitude: 39.7559,
      longitude: -104.9942,
      elevationFeet: 5200,
      azimuthAngle: null,
      roofType: null,
      turfType: "Grass",
      dimensions: {
        leftLine: 347,
        left: 390,
        leftCenter: 390,
        center: 415,
        rightCenter: 375,
        rightLine: 350,
      },
    },
    {
      gamePk: 1,
      officialDate: "2026-04-23",
      gameDate: "2026-04-23T20:10:00Z",
      status: "Scheduled",
      dayNight: "night",
      venue: { id: 19, name: "Coors Field" },
      homeTeam: { id: 115, name: "Colorado Rockies", abbreviation: "COL" },
      awayTeam: { id: 111, name: "Boston Red Sox", abbreviation: "BOS" },
      homeScore: null,
      awayScore: null,
      homeProbablePitcher: null,
      awayProbablePitcher: null,
    },
  );

  assert.ok(context.hitFactor > 1.05);
  assert.ok(context.homeRunFactor > 1.1);
});
