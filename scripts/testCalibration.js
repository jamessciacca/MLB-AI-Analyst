#!/usr/bin/env node

const baseUrl = process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;

async function main() {
  const response = await fetch(`${baseUrl}/api/mlb/model-performance`);
  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error || `Request failed: ${response.status}`);
  }

  console.log(`Generated at: ${json.generatedAt}`);
  console.log("");
  console.log("Hit market calibration");
  console.log(`Adjustment: ${json.feedbackCalibration.byMarket.hit.adjustment}`);
  console.log(`Sample size: ${json.feedbackCalibration.byMarket.hit.sampleSize}`);
  console.log(`Correct: ${json.feedbackCalibration.byMarket.hit.correctCount}`);
  console.log(`Too high: ${json.feedbackCalibration.byMarket.hit.tooHighCount}`);
  console.log(`Too low: ${json.feedbackCalibration.byMarket.hit.tooLowCount}`);
  console.log("");
  console.log(`Artifact calibration present: ${json.artifactCalibration ? "yes" : "no"}`);
  console.log(`Training summary present: ${json.trainingSummary ? "yes" : "no"}`);
  console.log(`Notes: ${(json.notes || []).join(" | ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unable to test calibration.");
  process.exit(1);
});
