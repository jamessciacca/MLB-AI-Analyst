import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { clamp } from "./utils.ts";

type SourceProbabilityCalibration = {
  method: "platt_logit";
  sourceColumn: "predicted_probability";
  intercept: number;
  slope: number;
  trainingRows: number;
  validationRows: number;
};

type CalibrationArtifact = {
  generatedAt: string;
  sourceProbabilityCalibration?: SourceProbabilityCalibration | null;
};

export type HitProbabilityCalibrationResult = {
  probability: number;
  applied: boolean;
  modelVersion: string | null;
  trainingRows: number;
  validationRows: number;
};

const CALIBRATION_ARTIFACT_PATH = path.join(
  process.cwd(),
  "ml",
  "artifacts",
  "calibration.json",
);

let cachedArtifact: CalibrationArtifact | null | undefined;

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value));
}

function logit(probability: number) {
  const clipped = clamp(probability, 0.001, 0.999);
  return Math.log(clipped / (1 - clipped));
}

function loadArtifact() {
  if (cachedArtifact !== undefined) {
    return cachedArtifact;
  }

  if (!existsSync(CALIBRATION_ARTIFACT_PATH)) {
    cachedArtifact = null;
    return cachedArtifact;
  }

  try {
    cachedArtifact = JSON.parse(
      readFileSync(CALIBRATION_ARTIFACT_PATH, "utf8"),
    ) as CalibrationArtifact;
  } catch {
    cachedArtifact = null;
  }

  return cachedArtifact;
}

function isUsableCalibration(
  calibration: SourceProbabilityCalibration | null | undefined,
): calibration is SourceProbabilityCalibration {
  return (
    calibration?.method === "platt_logit" &&
    Number.isFinite(calibration.intercept) &&
    Number.isFinite(calibration.slope) &&
    calibration.trainingRows >= 30 &&
    calibration.validationRows >= 10
  );
}

export function calibrateHitProbability(
  probability: number,
): HitProbabilityCalibrationResult {
  const artifact = loadArtifact();
  const calibration = artifact?.sourceProbabilityCalibration;

  if (!Number.isFinite(probability) || !isUsableCalibration(calibration)) {
    return {
      probability,
      applied: false,
      modelVersion: null,
      trainingRows: 0,
      validationRows: 0,
    };
  }

  const calibrated = sigmoid(calibration.intercept + calibration.slope * logit(probability));

  return {
    probability: clamp(calibrated, 0.01, 0.99),
    applied: true,
    modelVersion: artifact?.generatedAt ?? null,
    trainingRows: calibration.trainingRows,
    validationRows: calibration.validationRows,
  };
}
