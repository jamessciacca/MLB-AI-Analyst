import { readFile } from "node:fs/promises";
import path from "node:path";

import { clamp } from "../utils.ts";

import { type AnalystMarket } from "./types.ts";

type OutcomeRow = {
  market?: string;
  probability?: number;
  outcomeSuccess?: boolean;
};

type CalibrationBucket = {
  bucket: string;
  count: number;
  predictedRate: number;
  observedRate: number;
  adjustment: number;
};

export type AnalystCalibrationSummary = {
  market: AnalystMarket;
  sampleSize: number;
  brierScore: number | null;
  logLoss: number | null;
  adjustment: number;
  bucket: CalibrationBucket | null;
  buckets: CalibrationBucket[];
};

const OUTCOME_FEEDBACK_PATH = path.join(process.cwd(), "data", "outcome-feedback.ndjson");

function bucketLabel(probability: number) {
  const lower = Math.floor(clamp(probability, 0, 0.999) * 10) * 10;
  const upper = lower + 10;
  return `${lower}-${upper}%`;
}

function safeLogLoss(probability: number, outcome: boolean) {
  const clipped = clamp(probability, 0.001, 0.999);
  return outcome ? -Math.log(clipped) : -Math.log(1 - clipped);
}

async function readOutcomeRows(): Promise<OutcomeRow[]> {
  try {
    const raw = await readFile(OUTCOME_FEEDBACK_PATH, "utf8");

    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as OutcomeRow;
        } catch {
          return null;
        }
      })
      .filter((row): row is OutcomeRow => Boolean(row));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function getAnalystCalibrationSummary(
  market: AnalystMarket,
  probability: number,
): Promise<AnalystCalibrationSummary> {
  const supportedMarket = market === "total_bases" || market === "rbi" || market === "runs" ? "hit" : market;
  const rows = (await readOutcomeRows()).filter(
    (row) =>
      row.market === supportedMarket &&
      typeof row.probability === "number" &&
      typeof row.outcomeSuccess === "boolean",
  );

  if (rows.length === 0) {
    return {
      market,
      sampleSize: 0,
      brierScore: null,
      logLoss: null,
      adjustment: 0,
      bucket: null,
      buckets: [],
    };
  }

  const bucketMap = new Map<string, Array<{ probability: number; outcomeSuccess: boolean }>>();

  for (const row of rows) {
    const label = bucketLabel(row.probability as number);
    const entry = bucketMap.get(label) ?? [];
    entry.push({
      probability: row.probability as number,
      outcomeSuccess: row.outcomeSuccess as boolean,
    });
    bucketMap.set(label, entry);
  }

  const buckets = [...bucketMap.entries()].map(([bucket, entries]) => {
    const predictedRate =
      entries.reduce((sum, entry) => sum + entry.probability, 0) / entries.length;
    const observedRate =
      entries.reduce((sum, entry) => sum + (entry.outcomeSuccess ? 1 : 0), 0) / entries.length;

    return {
      bucket,
      count: entries.length,
      predictedRate,
      observedRate,
      adjustment: observedRate - predictedRate,
    };
  });

  const targetBucket = bucketLabel(probability);
  const bucket = buckets.find((entry) => entry.bucket === targetBucket) ?? null;
  const adjustment = bucket ? clamp(bucket.adjustment, -0.08, 0.08) : 0;
  const brierScore =
    rows.reduce(
      (sum, row) => sum + (((row.probability as number) - ((row.outcomeSuccess as boolean) ? 1 : 0)) ** 2),
      0,
    ) / rows.length;
  const logLoss =
    rows.reduce(
      (sum, row) => sum + safeLogLoss(row.probability as number, row.outcomeSuccess as boolean),
      0,
    ) / rows.length;

  return {
    market,
    sampleSize: rows.length,
    brierScore,
    logLoss,
    adjustment,
    bucket,
    buckets,
  };
}
