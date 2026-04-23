import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { AgentRepository } from "../src/db/agentRepository.ts";
import { updateCalibrationForResolution } from "../src/outcomes/calibration.ts";
import { parseOutcomeFeedbackMessage } from "../src/outcomes/feedbackParser.ts";
import { processOutcomeFeedback } from "../src/outcomes/feedbackService.ts";
import { findBestPredictionMatch } from "../src/outcomes/matcher.ts";
import { resolvePredictionOutcome } from "../src/outcomes/resolver.ts";
import {
  buildTrainingFeedbackRow,
  exportResolvedPredictionsToCsv,
  exportResolvedPredictionsToJsonl,
} from "../src/outcomes/trainingExport.ts";

function tempRepository() {
  const dir = mkdtempSync(path.join(tmpdir(), "mlb-outcome-test-"));
  return new AgentRepository(path.join(dir, "memory.sqlite"));
}

function samplePrediction(overrides = {}) {
  return {
    predictionId: "contreras-hit-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    gameDate: "2026-04-22",
    gameId: 123,
    team: "MIL",
    opponent: "CHC",
    playerName: "William Contreras",
    playerId: 12345,
    marketType: "hit",
    marketLine: "over_0.5_hit",
    predictedProbability: 0.68,
    modelScore: 0.68,
    impliedProbability: null,
    reasoningSummary: "William Contreras hit prediction at 68%.",
    reasoningFeaturesJson: "{}",
    status: "pending",
    sourceContextJson: "{}",
    ...overrides,
  };
}

test("parses direct player hit outcome feedback", () => {
  const parsed = parseOutcomeFeedbackMessage("William Contreras got a hit", {
    recentPredictions: [samplePrediction()],
  });

  assert.equal(parsed.kind, "prediction_feedback");
  assert.equal(parsed.playerName, "William Contreras");
  assert.equal(parsed.marketType, "hit");
  assert.equal(parsed.actualOutcome, true);
  assert.equal(parsed.actualValue, 1);
  assert.equal(parsed.feedbackType, "outcome_only");
  assert.ok(parsed.confidence > 0.8);
});

test("parses homer, vague loss, praise, and risk-only feedback", () => {
  const homer = parseOutcomeFeedbackMessage("he homered", {
    recentPredictions: [samplePrediction({ marketType: "home_run", marketLine: "over_0.5_hr" })],
  });
  const lost = parseOutcomeFeedbackMessage("that one lost");
  const praise = parseOutcomeFeedbackMessage("great call");
  const risky = parseOutcomeFeedbackMessage("the HR pick was too aggressive");

  assert.equal(homer.marketType, "home_run");
  assert.equal(homer.actualOutcome, true);
  assert.equal(lost.actualOutcome, false);
  assert.equal(praise.feedbackType, "correct");
  assert.equal(risky.feedbackType, "too_risky");
  assert.equal(risky.reasoningOnly, true);
});

test("matches exact player and market before vague latest prediction", () => {
  const contreras = samplePrediction();
  const judge = samplePrediction({
    predictionId: "judge-hr-1",
    playerName: "Aaron Judge",
    marketType: "home_run",
    marketLine: "over_0.5_hr",
  });
  const parsed = parseOutcomeFeedbackMessage("Contreras got a hit", {
    recentPredictions: [judge, contreras],
  });
  const match = findBestPredictionMatch(parsed, [judge, contreras]);

  assert.equal(match.prediction?.predictionId, "contreras-hit-1");
  assert.ok(match.confidence >= 0.55);
});

test("matches vague feedback to latest compatible prediction and refuses unsafe match", () => {
  const prediction = samplePrediction();
  const vague = parseOutcomeFeedbackMessage("that one lost");
  const vagueMatch = findBestPredictionMatch(vague, [prediction]);
  const noMatch = findBestPredictionMatch(
    parseOutcomeFeedbackMessage("William Contreras got a hit"),
    [],
  );

  assert.equal(vagueMatch.prediction?.predictionId, prediction.predictionId);
  assert.equal(noMatch.prediction, null);
});

test("resolves hit, home run, and threshold markets", () => {
  const hit = resolvePredictionOutcome(
    samplePrediction(),
    parseOutcomeFeedbackMessage("William Contreras got a hit", {
      recentPredictions: [samplePrediction()],
    }),
  );
  const homer = resolvePredictionOutcome(
    samplePrediction({ marketType: "home_run", marketLine: "over_0.5_hr" }),
    parseOutcomeFeedbackMessage("he did not homer"),
  );
  const multiHit = resolvePredictionOutcome(
    samplePrediction({ marketLine: "over_1.5_hits" }),
    parseOutcomeFeedbackMessage("he got 2 hits"),
  );

  assert.equal(hit?.actualOutcome, true);
  assert.equal(homer?.actualOutcome, false);
  assert.equal(multiHit?.actualOutcome, true);
});

test("processing feedback appends resolution, calibration, and training row", async () => {
  const repository = tempRepository();
  const prediction = samplePrediction();

  try {
    repository.upsertOutcomePrediction(prediction);
    const result = await processOutcomeFeedback(
      repository,
      "William Contreras got a hit",
      { createMemory: false },
    );

    assert.equal(result.match.prediction?.predictionId, prediction.predictionId);
    assert.equal(result.resolution?.actualOutcome, true);
    assert.equal(result.logged.calibrationUpdated, true);
    assert.equal(result.logged.trainingRowCreated, true);
    assert.equal(repository.listTrainingFeedbackRows().length, 1);
    assert.equal(repository.listAggregateCalibrationStats()[0]?.probabilityBucket, "65_70");
  } finally {
    repository.close();
  }
});

test("training row builders and exporters write resolved data", async () => {
  const repository = tempRepository();
  const prediction = samplePrediction();
  const resolution = {
    predictionId: prediction.predictionId,
    actualOutcome: true,
    actualValue: 1,
    wasPredictionCorrect: true,
    resolutionMethod: "user_message",
    resolutionConfidence: 0.92,
    rawResolutionContextJson: "{}",
  };

  try {
    repository.saveTrainingFeedbackRow(buildTrainingFeedbackRow(prediction, resolution));
    updateCalibrationForResolution(repository, prediction, resolution);

    const csv = await exportResolvedPredictionsToCsv(repository);
    const jsonl = await exportResolvedPredictionsToJsonl(repository);

    assert.equal(csv.rows, 1);
    assert.equal(jsonl.rows, 1);
    assert.equal(existsSync(csv.path), true);
    assert.equal(existsSync(jsonl.path), true);
  } finally {
    repository.close();
    rmSync(path.join(process.cwd(), "data", "training", "resolved_predictions.csv"), {
      force: true,
    });
    rmSync(path.join(process.cwd(), "data", "training", "resolved_predictions.jsonl"), {
      force: true,
    });
  }
});
