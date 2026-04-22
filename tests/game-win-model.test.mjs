import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const config = JSON.parse(readFileSync("ml/game_win_model_config.json", "utf8"));

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function fallbackProbability(features) {
  const weights = {
    starter_quality_diff: 0.58,
    offense_ops_diff: 2.2,
    bullpen_quality_diff: 0.34,
    bullpen_fatigue_diff: 0.32,
    season_win_pct_diff: 1.1,
    home_field: 0.18,
    critical_missing_count: -0.035,
  };
  let score = -0.02;

  for (const feature of config.featureNames) {
    score += (features[feature] ?? config.defaults[feature] ?? 0) * (weights[feature] ?? 0);
  }

  return Math.min(Math.max(sigmoid(score), 0.03), 0.97);
}

test("game winner config exports complete defaults", () => {
  assert.equal(config.target, "home_team_win");
  assert.ok(config.featureNames.includes("starter_quality_diff"));
  assert.ok(config.featureNames.includes("bullpen_fatigue_diff"));
  assert.ok(config.featureNames.includes("lineup_confirmed"));

  for (const feature of config.featureNames) {
    assert.equal(typeof config.defaults[feature], "number", `${feature} default missing`);
  }
});

test("fallback probability increases with starter and offense edge", () => {
  const neutral = fallbackProbability(config.defaults);
  const strongerHome = fallbackProbability({
    ...config.defaults,
    starter_quality_diff: 0.9,
    offense_ops_diff: 0.08,
    bullpen_quality_diff: 0.4,
  });

  assert.ok(strongerHome > neutral);
});

test("missing critical data lowers fallback probability and confidence signal", () => {
  const complete = fallbackProbability({
    ...config.defaults,
    starter_quality_diff: 0.4,
    critical_missing_count: 0,
  });
  const missing = fallbackProbability({
    ...config.defaults,
    starter_quality_diff: 0.4,
    critical_missing_count: 6,
  });

  assert.ok(missing < complete);
});
