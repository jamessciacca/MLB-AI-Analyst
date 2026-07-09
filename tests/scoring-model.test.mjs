import assert from "node:assert/strict";
import test from "node:test";

import { isUsableMlHitModelArtifact } from "../src/lib/ml-hit-predictor.ts";
import { getMlHitFeatureNames } from "../src/lib/ml-hit-features.ts";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function shrinkRate(observed, sampleSize, prior, stabilizationPoint) {
  if (observed === null || observed === undefined || !Number.isFinite(observed)) {
    return prior;
  }

  const sample = Math.max(sampleSize ?? 0, 0);
  const weight = sample / (sample + stabilizationPoint);
  return observed * weight + prior * (1 - weight);
}

function atLeastOne(probability, opportunities) {
  return 1 - (1 - probability) ** opportunities;
}

function atLeastTwo(probability, opportunities) {
  const noHits = (1 - probability) ** opportunities;
  const exactlyOne = opportunities * probability * (1 - probability) ** Math.max(opportunities - 1, 0);
  return clamp(1 - noHits - exactlyOne, 0, 1);
}

test("game-level hit probability increases with more opportunities", () => {
  assert.ok(atLeastOne(0.25, 4.6) > atLeastOne(0.25, 3.4));
});

test("2+ hit probability stays below 1+ hit probability", () => {
  const onePlus = atLeastOne(0.28, 4.4);
  const twoPlus = atLeastTwo(0.28, 4.4);

  assert.ok(twoPlus > 0);
  assert.ok(twoPlus < onePlus);
});

test("shrinkage pulls small samples toward league average", () => {
  const leagueAverage = 0.245;
  const smallSample = shrinkRate(0.5, 6, leagueAverage, 260);
  const largeSample = shrinkRate(0.5, 260, leagueAverage, 260);

  assert.ok(Math.abs(smallSample - leagueAverage) < Math.abs(largeSample - leagueAverage));
});

test("manual logistic inference returns a valid probability", () => {
  const intercept = -0.2;
  const coefficients = [0.7, -0.3, 0.15];
  const standardizedFeatures = [0.8, -0.4, 0.2];
  const logit = coefficients.reduce(
    (sum, coefficient, index) => sum + coefficient * standardizedFeatures[index],
    intercept,
  );
  const probability = 1 / (1 + Math.exp(-logit));

  assert.ok(probability > 0);
  assert.ok(probability < 1);
});

test("expected hits are derived from inferred per-at-bat probability", () => {
  const onePlus = 0.62;
  const projectedAbs = 4.2;
  const inferredPerAtBat = 1 - (1 - onePlus) ** (1 / projectedAbs);
  const expectedHits = projectedAbs * inferredPerAtBat;

  assert.ok(inferredPerAtBat > 0);
  assert.ok(expectedHits > 0);
  assert.ok(expectedHits < projectedAbs);
});

test("ML artifact validator rejects constant 50 percent models", () => {
  const featureNames = getMlHitFeatureNames();
  const zeroSignalArtifact = {
    modelType: "regularized_logistic_regression",
    version: "test",
    trainedAt: "2026-04-25T00:00:00.000Z",
    featureNames,
    intercept: 0,
    coefficients: Object.fromEntries(featureNames.map((feature) => [feature, 0])),
    standardization: {
      mean: Object.fromEntries(featureNames.map((feature) => [feature, 0])),
      scale: Object.fromEntries(featureNames.map((feature) => [feature, 1])),
    },
  };
  const usableArtifact = {
    ...zeroSignalArtifact,
    coefficients: {
      ...zeroSignalArtifact.coefficients,
      batter_avg: 0.4,
    },
  };

  assert.equal(isUsableMlHitModelArtifact(zeroSignalArtifact), false);
  assert.equal(isUsableMlHitModelArtifact(usableArtifact), true);
});
