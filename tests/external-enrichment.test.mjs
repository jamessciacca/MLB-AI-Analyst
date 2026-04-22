import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const config = JSON.parse(readFileSync("ml/game_win_model_config.json", "utf8"));

test("game winner config includes external enrichment features with defaults", () => {
  const expected = [
    "is_day_game",
    "is_night_game",
    "is_twilight_start",
    "first_pitch_minutes_from_sunset",
    "day_length_minutes",
    "weather_severity_score",
    "weather_boost_for_hr",
    "weather_penalty_for_pitchers",
    "market_implied_home_win_prob",
    "market_implied_away_win_prob",
    "lineup_uncertainty_score",
    "injury_uncertainty_score",
    "external_data_completeness_score",
  ];

  for (const feature of expected) {
    assert.ok(config.featureNames.includes(feature), `${feature} missing from featureNames`);
    assert.equal(typeof config.defaults[feature], "number", `${feature} default missing`);
  }
});

test("provider modules and backfill script are present", () => {
  for (const file of [
    "src/lib/providers/espn-site-provider.ts",
    "src/lib/providers/espn-core-provider.ts",
    "src/lib/providers/open-meteo-provider.ts",
    "src/lib/providers/nominatim-provider.ts",
    "src/lib/providers/sunrise-sunset-provider.ts",
    "src/lib/enrichment/external-context.ts",
    "src/lib/enrichment/external-features.ts",
    "scripts/backfill_external_enrichment.mjs",
  ]) {
    assert.ok(existsSync(file), `${file} should exist`);
  }
});
