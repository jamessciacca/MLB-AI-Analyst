import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  appendOutcomeFeedback,
  getAuditedAnalysisIds,
  getSavedPredictions,
  type OutcomeFeedbackEntry,
  type PredictionEntry,
} from "@/lib/feedback";
import { getLiveGameStatus, getPlayerGameBattingLine } from "@/lib/mlb";
import { type AnalysisMarket } from "@/lib/types";

const AUDIT_STATE_PATH = path.join(process.cwd(), "data", "audit-state.json");
const AUTO_AUDIT_INTERVAL_MS = 15 * 1000;

type AuditSkippedReason = "already_audited" | "game_not_final" | "no_boxscore_line";

type AuditResult = {
  checked: number;
  added: number;
  skipped: Array<{
    analysisId: string;
    playerId: number;
    gamePk: number;
    reason: AuditSkippedReason;
  }>;
  outcomes: OutcomeFeedbackEntry[];
};

type AuditState = {
  lastRunDate: string;
  lastRunAt: string;
  lastAdded: number;
  lastChecked: number;
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function readAuditState(): Promise<AuditState | null> {
  try {
    return JSON.parse(await readFile(AUDIT_STATE_PATH, "utf8")) as AuditState;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeAuditState(result: AuditResult) {
  await mkdir(path.dirname(AUDIT_STATE_PATH), { recursive: true });
  await writeFile(
    AUDIT_STATE_PATH,
    JSON.stringify(
      {
        lastRunDate: todayKey(),
        lastRunAt: new Date().toISOString(),
        lastAdded: result.added,
        lastChecked: result.checked,
      } satisfies AuditState,
      null,
      2,
    ),
    "utf8",
  );
}

function isFinalStatus(status: string) {
  const normalized = status.toLowerCase();
  return (
    normalized.includes("final") ||
    normalized.includes("game over") ||
    normalized.includes("completed")
  );
}

function outcomeSucceeded(market: AnalysisMarket, line: { hits: number; homeRuns: number }) {
  return market === "home_run" ? line.homeRuns > 0 : line.hits > 0;
}

function predictedSuccess(entry: PredictionEntry) {
  if (entry.recommendation === "good play") {
    return true;
  }
  if (entry.recommendation === "avoid") {
    return false;
  }

  return entry.market === "home_run" ? entry.probability >= 0.15 : entry.probability >= 0.5;
}

function ratingFromOutcome(entry: PredictionEntry, success: boolean) {
  const predicted = predictedSuccess(entry);

  if (predicted === success) {
    return "correct" as const;
  }

  return predicted && !success ? ("too_high" as const) : ("too_low" as const);
}

export async function auditSavedPredictionOutcomes(): Promise<AuditResult> {
  const [entries, auditedIds] = await Promise.all([
    getSavedPredictions(),
    getAuditedAnalysisIds(),
  ]);
  const outcomes: OutcomeFeedbackEntry[] = [];
  const skipped: AuditResult["skipped"] = [];

  for (const entry of entries) {
    if (auditedIds.has(entry.analysisId)) {
      skipped.push({
        analysisId: entry.analysisId,
        playerId: entry.playerId,
        gamePk: entry.gamePk,
        reason: "already_audited",
      });
      continue;
    }

    const gameStatus = await getLiveGameStatus(entry.gamePk);

    if (!gameStatus || !isFinalStatus(gameStatus)) {
      skipped.push({
        analysisId: entry.analysisId,
        playerId: entry.playerId,
        gamePk: entry.gamePk,
        reason: "game_not_final",
      });
      continue;
    }

    const line = await getPlayerGameBattingLine(entry.gamePk, entry.playerId);

    if (!line) {
      skipped.push({
        analysisId: entry.analysisId,
        playerId: entry.playerId,
        gamePk: entry.gamePk,
        reason: "no_boxscore_line",
      });
      continue;
    }

    const success = outcomeSucceeded(entry.market, line);

    outcomes.push({
      analysisId: entry.analysisId,
      playerId: entry.playerId,
      gamePk: entry.gamePk,
      market: entry.market,
      probability: entry.probability,
      recommendation: entry.recommendation,
      source: "auto_outcome",
      rating: ratingFromOutcome(entry, success),
      actualHits: line.hits,
      actualHomeRuns: line.homeRuns,
      outcomeSuccess: success,
      auditedAt: new Date().toISOString(),
      savedAt: new Date().toISOString(),
    });
  }

  await appendOutcomeFeedback(outcomes);

  return {
    checked: entries.length,
    added: outcomes.length,
    skipped,
    outcomes,
  };
}

export async function runDailyOutcomeAuditIfDue(): Promise<AuditResult | null> {
  const state = await readAuditState();
  const lastRunAt = state ? Date.parse(state.lastRunAt) : Number.NaN;

  if (Number.isFinite(lastRunAt) && Date.now() - lastRunAt < AUTO_AUDIT_INTERVAL_MS) {
    return null;
  }

  const result = await auditSavedPredictionOutcomes();
  await writeAuditState(result);
  return result;
}
