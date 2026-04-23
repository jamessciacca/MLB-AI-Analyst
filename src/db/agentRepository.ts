import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { AGENT_SCHEMA_SQL } from "./agentSchema.ts";
import {
  type AgentPrediction,
  type ChatMessage,
  type ChatRole,
  type ChatSession,
  type MemoryItem,
  type MemoryItemInput,
  type PredictionFeedback,
  type PredictionRecord,
  type UserPreference,
} from "../agent/types.ts";
import {
  type FeedbackSource,
  type OutcomeFeedbackType,
  type OutcomePredictionRecord,
  type OutcomeResolution,
  type PredictionStatus,
  type TrainingFeedbackRow,
} from "../outcomes/types.ts";

type DbRow = Record<string, unknown>;

function nowIso() {
  return new Date().toISOString();
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toSession(row: DbRow): ChatSession {
  return {
    id: String(row.id),
    title: String(row.title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toMessage(row: DbRow): ChatMessage {
  return {
    id: Number(row.id),
    sessionId: String(row.session_id),
    role: String(row.role) as ChatRole,
    content: String(row.content),
    createdAt: String(row.created_at),
  };
}

function toMemory(row: DbRow): MemoryItem {
  return {
    id: Number(row.id),
    category: row.category as MemoryItem["category"],
    content: String(row.content),
    tags: parseJsonArray(row.tags),
    importanceScore: Number(row.importance_score),
    source: String(row.source),
    createdAt: String(row.created_at),
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
  };
}

function toPreference(row: DbRow): UserPreference {
  return {
    id: Number(row.id),
    key: String(row.key),
    value: String(row.value),
    confidence: Number(row.confidence),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toPrediction(row: DbRow): PredictionRecord {
  return {
    id: Number(row.id),
    predictionId: String(row.prediction_id),
    playerName: row.player_name ? String(row.player_name) : null,
    marketType: row.market_type as PredictionRecord["marketType"],
    predictedProbability:
      row.predicted_probability === null || row.predicted_probability === undefined
        ? null
        : Number(row.predicted_probability),
    predictionSummary: String(row.prediction_summary),
    createdAt: String(row.created_at),
  };
}

function optionalString(row: DbRow, key: string) {
  return row[key] === null || row[key] === undefined ? null : String(row[key]);
}

function optionalNumber(row: DbRow, key: string) {
  return row[key] === null || row[key] === undefined ? null : Number(row[key]);
}

function optionalBoolean(row: DbRow, key: string) {
  return row[key] === null || row[key] === undefined ? null : Number(row[key]) === 1;
}

function toOutcomePrediction(row: DbRow): OutcomePredictionRecord {
  return {
    id: Number(row.id),
    predictionId: String(row.prediction_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at || row.created_at),
    gameDate: optionalString(row, "game_date"),
    gameId: optionalNumber(row, "game_id"),
    team: optionalString(row, "team"),
    opponent: optionalString(row, "opponent"),
    playerName: optionalString(row, "player_name"),
    playerId: optionalNumber(row, "player_id"),
    marketType: String(row.market_type) as OutcomePredictionRecord["marketType"],
    marketLine: optionalString(row, "market_line"),
    predictedProbability: optionalNumber(row, "predicted_probability"),
    modelScore: optionalNumber(row, "model_score"),
    impliedProbability: optionalNumber(row, "implied_probability"),
    reasoningSummary: String(row.prediction_summary),
    reasoningFeaturesJson: String(row.reasoning_features_json ?? "{}"),
    status: String(row.status ?? "pending") as PredictionStatus,
    sourceContextJson: String(row.source_context_json ?? "{}"),
  };
}

function toTrainingRow(row: DbRow): TrainingFeedbackRow {
  return {
    predictionId: String(row.prediction_id),
    playerName: optionalString(row, "player_name"),
    gameDate: optionalString(row, "game_date"),
    gameId: optionalNumber(row, "game_id"),
    marketType: String(row.market_type),
    marketLine: optionalString(row, "market_line"),
    predictedProbability: optionalNumber(row, "predicted_probability"),
    impliedProbability: optionalNumber(row, "implied_probability"),
    reasoningFeaturesJson: String(row.reasoning_features_json ?? "{}"),
    actualOutcome: optionalBoolean(row, "actual_outcome"),
    actualValue: optionalNumber(row, "actual_value"),
    wasPredictionCorrect: optionalBoolean(row, "was_prediction_correct"),
    createdAt: String(row.created_at),
  };
}

function toFeedback(row: DbRow): PredictionFeedback {
  return {
    id: Number(row.id),
    predictionId: row.prediction_id ? String(row.prediction_id) : null,
    feedbackType: row.feedback_type as PredictionFeedback["feedbackType"],
    userMessage: String(row.user_message),
    actualOutcome: row.actual_outcome as PredictionFeedback["actualOutcome"],
    wasPredictionCorrect:
      row.was_prediction_correct === null || row.was_prediction_correct === undefined
        ? null
        : Number(row.was_prediction_correct) === 1,
    createdAt: String(row.created_at),
  };
}

export class AgentRepository {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(AGENT_SCHEMA_SQL);
    this.runCompatibilityMigrations();
  }

  close() {
    this.db.close();
  }

  createSession(title = "MLB chat"): ChatSession {
    const createdAt = nowIso();
    const id = crypto.randomUUID();

    this.db
      .prepare(
        "INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(id, title, createdAt, createdAt);

    return { id, title, createdAt, updatedAt: createdAt };
  }

  getSession(id: string): ChatSession | null {
    const row = this.db
      .prepare("SELECT * FROM chat_sessions WHERE id = ?")
      .get(id) as DbRow | undefined;

    return row ? toSession(row) : null;
  }

  getOrCreateSession(id?: string | null, title?: string): ChatSession {
    if (id) {
      const existing = this.getSession(id);

      if (existing) {
        return existing;
      }
    }

    return this.createSession(title);
  }

  listSessions(limit = 20): ChatSession[] {
    return (
      this.db
        .prepare("SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT ?")
        .all(limit) as DbRow[]
    ).map(toSession);
  }

  clearSession(sessionId: string) {
    this.db.prepare("DELETE FROM chat_messages WHERE session_id = ?").run(sessionId);
    this.db
      .prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?")
      .run(nowIso(), sessionId);
  }

  addMessage(sessionId: string, role: ChatRole, content: string): ChatMessage {
    const createdAt = nowIso();
    const result = this.db
      .prepare(
        "INSERT INTO chat_messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(sessionId, role, content, createdAt);

    this.db
      .prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?")
      .run(createdAt, sessionId);

    return {
      id: Number(result.lastInsertRowid),
      sessionId,
      role,
      content,
      createdAt,
    };
  }

  getRecentMessages(sessionId: string, limit: number): ChatMessage[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
        )
        .all(sessionId, limit) as DbRow[]
    )
      .map(toMessage)
      .reverse();
  }

  getMessages(sessionId: string, limit = 100): ChatMessage[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC, id ASC LIMIT ?",
        )
        .all(sessionId, limit) as DbRow[]
    ).map(toMessage);
  }

  saveMemory(input: MemoryItemInput): MemoryItem {
    const createdAt = nowIso();
    const tags = JSON.stringify(input.tags ?? []);
    const result = this.db
      .prepare(
        `INSERT INTO memory_items
          (category, content, tags, importance_score, source, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        input.category,
        input.content,
        tags,
        input.importanceScore ?? 0.6,
        input.source ?? "chat",
        createdAt,
      );

    return {
      id: Number(result.lastInsertRowid),
      category: input.category,
      content: input.content,
      tags: input.tags ?? [],
      importanceScore: input.importanceScore ?? 0.6,
      source: input.source ?? "chat",
      createdAt,
      lastUsedAt: null,
    };
  }

  listMemories(limit = 20): MemoryItem[] {
    return (
      this.db
        .prepare("SELECT * FROM memory_items ORDER BY created_at DESC, id DESC LIMIT ?")
        .all(limit) as DbRow[]
    ).map(toMemory);
  }

  getCandidateMemories(limit = 80): MemoryItem[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM memory_items ORDER BY importance_score DESC, created_at DESC LIMIT ?",
        )
        .all(limit) as DbRow[]
    ).map(toMemory);
  }

  markMemoriesUsed(ids: number[]) {
    if (ids.length === 0) {
      return;
    }

    const stamp = nowIso();
    const update = this.db.prepare("UPDATE memory_items SET last_used_at = ? WHERE id = ?");

    for (const id of ids) {
      update.run(stamp, id);
    }
  }

  upsertPreference(key: string, value: string, confidence = 0.65): UserPreference {
    const stamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO user_preferences (key, value, confidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          confidence = MAX(user_preferences.confidence, excluded.confidence),
          updated_at = excluded.updated_at`,
      )
      .run(key, value, confidence, stamp, stamp);

    const row = this.db
      .prepare("SELECT * FROM user_preferences WHERE key = ?")
      .get(key) as DbRow;

    return toPreference(row);
  }

  listPreferences(limit = 20): UserPreference[] {
    return (
      this.db
        .prepare("SELECT * FROM user_preferences ORDER BY updated_at DESC LIMIT ?")
        .all(limit) as DbRow[]
    ).map(toPreference);
  }

  upsertPrediction(prediction: AgentPrediction): PredictionRecord {
    const stamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO prediction_records
          (prediction_id, player_name, market_type, predicted_probability, model_score,
           prediction_summary, reasoning_features_json, status, source_context_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '{}', 'pending', '{}', ?, ?)
         ON CONFLICT(prediction_id) DO UPDATE SET
          player_name = excluded.player_name,
          market_type = excluded.market_type,
          predicted_probability = excluded.predicted_probability,
          model_score = excluded.model_score,
          prediction_summary = excluded.prediction_summary,
          updated_at = excluded.updated_at`,
      )
      .run(
        prediction.predictionId,
        prediction.playerName,
        prediction.marketType,
        prediction.predictedProbability,
        prediction.predictedProbability,
        prediction.predictionSummary,
        prediction.createdAt,
        stamp,
      );

    const row = this.db
      .prepare("SELECT * FROM prediction_records WHERE prediction_id = ?")
      .get(prediction.predictionId) as DbRow;

    return toPrediction(row);
  }

  getLatestPrediction(): PredictionRecord | null {
    const row = this.db
      .prepare("SELECT * FROM prediction_records ORDER BY created_at DESC LIMIT 1")
      .get() as DbRow | undefined;

    return row ? toPrediction(row) : null;
  }

  upsertOutcomePrediction(prediction: OutcomePredictionRecord): OutcomePredictionRecord {
    const stamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO prediction_records
          (prediction_id, game_date, game_id, team, opponent, player_name, player_id,
           market_type, market_line, predicted_probability, model_score, implied_probability,
           prediction_summary, reasoning_features_json, status, source_context_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(prediction_id) DO UPDATE SET
          game_date = COALESCE(excluded.game_date, prediction_records.game_date),
          game_id = COALESCE(excluded.game_id, prediction_records.game_id),
          team = COALESCE(excluded.team, prediction_records.team),
          opponent = COALESCE(excluded.opponent, prediction_records.opponent),
          player_name = COALESCE(excluded.player_name, prediction_records.player_name),
          player_id = COALESCE(excluded.player_id, prediction_records.player_id),
          market_type = excluded.market_type,
          market_line = COALESCE(excluded.market_line, prediction_records.market_line),
          predicted_probability = excluded.predicted_probability,
          model_score = excluded.model_score,
          implied_probability = COALESCE(excluded.implied_probability, prediction_records.implied_probability),
          prediction_summary = excluded.prediction_summary,
          reasoning_features_json = excluded.reasoning_features_json,
          source_context_json = excluded.source_context_json,
          updated_at = excluded.updated_at`,
      )
      .run(
        prediction.predictionId,
        prediction.gameDate,
        prediction.gameId,
        prediction.team,
        prediction.opponent,
        prediction.playerName,
        prediction.playerId,
        prediction.marketType,
        prediction.marketLine,
        prediction.predictedProbability,
        prediction.modelScore,
        prediction.impliedProbability,
        prediction.reasoningSummary,
        prediction.reasoningFeaturesJson,
        prediction.status,
        prediction.sourceContextJson,
        prediction.createdAt,
        prediction.updatedAt || stamp,
      );

    const saved = this.getOutcomePredictionById(prediction.predictionId);

    if (!saved) {
      throw new Error("Unable to save prediction record.");
    }

    return saved;
  }

  getOutcomePredictionById(predictionId: string): OutcomePredictionRecord | null {
    const row = this.db
      .prepare("SELECT * FROM prediction_records WHERE prediction_id = ?")
      .get(predictionId) as DbRow | undefined;

    return row ? toOutcomePrediction(row) : null;
  }

  listOutcomePredictions({
    limit = 30,
    unresolvedOnly = false,
  }: {
    limit?: number;
    unresolvedOnly?: boolean;
  } = {}): OutcomePredictionRecord[] {
    const sql = unresolvedOnly
      ? "SELECT * FROM prediction_records WHERE status != 'resolved' ORDER BY created_at DESC LIMIT ?"
      : "SELECT * FROM prediction_records ORDER BY created_at DESC LIMIT ?";

    return (this.db.prepare(sql).all(limit) as DbRow[]).map(toOutcomePrediction);
  }

  hasResolvedOutcome(predictionId: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM resolved_prediction_outcomes WHERE prediction_id = ? LIMIT 1")
      .get(predictionId);

    return Boolean(row);
  }

  saveOutcomeFeedback(input: {
    predictionId: string | null;
    feedbackSource: FeedbackSource;
    rawUserMessage: string;
    normalizedFeedbackType: OutcomeFeedbackType;
    feedbackType: PredictionFeedback["feedbackType"];
    actualOutcomeText: PredictionFeedback["actualOutcome"];
    actualOutcomeBoolean: boolean | null;
    actualStatValue: number | null;
    wasPredictionCorrect: boolean | null;
    confidenceAdjustmentNote?: string | null;
    notes?: string | null;
    matchConfidence?: number | null;
    matchReasons?: string[];
  }) {
    const createdAt = nowIso();
    const result = this.db
      .prepare(
        `INSERT INTO prediction_feedback
          (prediction_id, feedback_source, raw_user_message, normalized_feedback_type,
           feedback_type, user_message, actual_outcome, actual_outcome_boolean,
           actual_stat_value, was_prediction_correct, confidence_adjustment_note,
           notes, match_confidence, match_reasons, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.predictionId,
        input.feedbackSource,
        input.rawUserMessage,
        input.normalizedFeedbackType,
        input.feedbackType,
        input.rawUserMessage,
        input.actualOutcomeText,
        input.actualOutcomeBoolean === null ? null : input.actualOutcomeBoolean ? 1 : 0,
        input.actualStatValue,
        input.wasPredictionCorrect === null ? null : input.wasPredictionCorrect ? 1 : 0,
        input.confidenceAdjustmentNote ?? null,
        input.notes ?? null,
        input.matchConfidence ?? null,
        JSON.stringify(input.matchReasons ?? []),
        createdAt,
      );

    return Number(result.lastInsertRowid);
  }

  saveResolvedOutcome(resolution: OutcomeResolution) {
    const resolvedAt = nowIso();
    const result = this.db
      .prepare(
        `INSERT INTO resolved_prediction_outcomes
          (prediction_id, resolved_at, actual_outcome, actual_value, was_prediction_correct,
           resolution_method, resolution_confidence, raw_resolution_context_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        resolution.predictionId,
        resolvedAt,
        resolution.actualOutcome === null ? null : resolution.actualOutcome ? 1 : 0,
        resolution.actualValue,
        resolution.wasPredictionCorrect === null
          ? null
          : resolution.wasPredictionCorrect
            ? 1
            : 0,
        resolution.resolutionMethod,
        resolution.resolutionConfidence,
        resolution.rawResolutionContextJson,
      );

    this.db
      .prepare("UPDATE prediction_records SET status = 'resolved', updated_at = ? WHERE prediction_id = ?")
      .run(resolvedAt, resolution.predictionId);

    return Number(result.lastInsertRowid);
  }

  appendCalibrationLog(input: {
    predictionId: string;
    marketType: string;
    predictedProbability: number | null;
    outcomeBoolean: boolean;
    probabilityBucket: string;
  }) {
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO model_calibration_log
          (prediction_id, market_type, predicted_probability, outcome_boolean,
           observed_outcome, probability_bucket, bucket, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.predictionId,
        input.marketType,
        input.predictedProbability,
        input.outcomeBoolean ? 1 : 0,
        input.outcomeBoolean ? 1 : 0,
        input.probabilityBucket,
        input.probabilityBucket,
        createdAt,
      );
  }

  recomputeAggregateCalibration(marketType: string, probabilityBucket: string) {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total_predictions,
                SUM(CASE WHEN outcome_boolean = 1 THEN 1 ELSE 0 END) AS total_wins,
                AVG(predicted_probability) AS avg_predicted_probability
         FROM model_calibration_log
         WHERE market_type = ? AND probability_bucket = ?`,
      )
      .get(marketType, probabilityBucket) as DbRow | undefined;

    const totalPredictions = Number(row?.total_predictions ?? 0);
    const totalWins = Number(row?.total_wins ?? 0);
    const avgPredictedProbability = Number(row?.avg_predicted_probability ?? 0);
    const observedWinRate = totalPredictions > 0 ? totalWins / totalPredictions : 0;

    this.db
      .prepare(
        `INSERT INTO aggregate_calibration_stats
          (market_type, probability_bucket, total_predictions, total_wins,
           observed_win_rate, avg_predicted_probability, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(market_type, probability_bucket) DO UPDATE SET
          total_predictions = excluded.total_predictions,
          total_wins = excluded.total_wins,
          observed_win_rate = excluded.observed_win_rate,
          avg_predicted_probability = excluded.avg_predicted_probability,
          updated_at = excluded.updated_at`,
      )
      .run(
        marketType,
        probabilityBucket,
        totalPredictions,
        totalWins,
        observedWinRate,
        avgPredictedProbability,
        nowIso(),
      );
  }

  saveTrainingFeedbackRow(row: TrainingFeedbackRow) {
    this.db
      .prepare(
        `INSERT INTO training_feedback_rows
          (prediction_id, player_name, game_date, game_id, market_type, market_line,
           predicted_probability, implied_probability, reasoning_features_json,
           actual_outcome, actual_value, was_prediction_correct, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(prediction_id) DO UPDATE SET
          actual_outcome = excluded.actual_outcome,
          actual_value = excluded.actual_value,
          was_prediction_correct = excluded.was_prediction_correct`,
      )
      .run(
        row.predictionId,
        row.playerName,
        row.gameDate,
        row.gameId,
        row.marketType,
        row.marketLine,
        row.predictedProbability,
        row.impliedProbability,
        row.reasoningFeaturesJson,
        row.actualOutcome === null ? null : row.actualOutcome ? 1 : 0,
        row.actualValue,
        row.wasPredictionCorrect === null ? null : row.wasPredictionCorrect ? 1 : 0,
        row.createdAt,
      );
  }

  listTrainingFeedbackRows(limit = 5000): TrainingFeedbackRow[] {
    return (
      this.db
        .prepare("SELECT * FROM training_feedback_rows ORDER BY created_at DESC LIMIT ?")
        .all(limit) as DbRow[]
    ).map(toTrainingRow);
  }

  listAggregateCalibrationStats() {
    return this.db
      .prepare(
        `SELECT market_type AS marketType,
                probability_bucket AS probabilityBucket,
                total_predictions AS totalPredictions,
                total_wins AS totalWins,
                observed_win_rate AS observedWinRate,
                avg_predicted_probability AS avgPredictedProbability,
                updated_at AS updatedAt
         FROM aggregate_calibration_stats
         ORDER BY market_type ASC, probability_bucket ASC`,
      )
      .all() as Array<{
      marketType: string;
      probabilityBucket: string;
      totalPredictions: number;
      totalWins: number;
      observedWinRate: number;
      avgPredictedProbability: number;
      updatedAt: string;
    }>;
  }

  savePredictionFeedback(
    input: Omit<PredictionFeedback, "id" | "createdAt">,
    predictedProbability?: number | null,
  ): PredictionFeedback {
    const createdAt = nowIso();
    const result = this.db
      .prepare(
        `INSERT INTO prediction_feedback
          (prediction_id, feedback_type, user_message, actual_outcome, was_prediction_correct, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.predictionId,
        input.feedbackType,
        input.userMessage,
        input.actualOutcome,
        input.wasPredictionCorrect === null ? null : input.wasPredictionCorrect ? 1 : 0,
        createdAt,
      );

    if (input.predictionId && input.wasPredictionCorrect !== null) {
      this.logCalibration(
        input.predictionId,
        predictedProbability ?? null,
        input.wasPredictionCorrect,
      );
    }

    return {
      ...input,
      id: Number(result.lastInsertRowid),
      createdAt,
    };
  }

  listPredictionFeedback(limit = 20): PredictionFeedback[] {
    return (
      this.db
        .prepare("SELECT * FROM prediction_feedback ORDER BY created_at DESC, id DESC LIMIT ?")
        .all(limit) as DbRow[]
    ).map(toFeedback);
  }

  getFeedbackForPrediction(predictionId: string, limit = 10): PredictionFeedback[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM prediction_feedback WHERE prediction_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(predictionId, limit) as DbRow[]
    ).map(toFeedback);
  }

  private logCalibration(
    predictionId: string,
    predictedProbability: number | null,
    observedOutcome: boolean,
  ) {
    const bucket =
      predictedProbability === null
        ? "unknown"
        : `${Math.floor(predictedProbability * 10) * 10}-${Math.floor(predictedProbability * 10) * 10 + 10}`;

    this.db
      .prepare(
        `INSERT INTO model_calibration_log
          (prediction_id, predicted_probability, observed_outcome, bucket, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(predictionId, predictedProbability, observedOutcome ? 1 : 0, bucket, nowIso());
  }

  private runCompatibilityMigrations() {
    const migrations: Array<{ table: string; column: string; sql: string }> = [
      { table: "prediction_records", column: "game_date", sql: "ALTER TABLE prediction_records ADD COLUMN game_date TEXT" },
      { table: "prediction_records", column: "game_id", sql: "ALTER TABLE prediction_records ADD COLUMN game_id INTEGER" },
      { table: "prediction_records", column: "team", sql: "ALTER TABLE prediction_records ADD COLUMN team TEXT" },
      { table: "prediction_records", column: "opponent", sql: "ALTER TABLE prediction_records ADD COLUMN opponent TEXT" },
      { table: "prediction_records", column: "player_id", sql: "ALTER TABLE prediction_records ADD COLUMN player_id INTEGER" },
      { table: "prediction_records", column: "market_line", sql: "ALTER TABLE prediction_records ADD COLUMN market_line TEXT" },
      { table: "prediction_records", column: "model_score", sql: "ALTER TABLE prediction_records ADD COLUMN model_score REAL" },
      { table: "prediction_records", column: "implied_probability", sql: "ALTER TABLE prediction_records ADD COLUMN implied_probability REAL" },
      { table: "prediction_records", column: "reasoning_features_json", sql: "ALTER TABLE prediction_records ADD COLUMN reasoning_features_json TEXT NOT NULL DEFAULT '{}'" },
      { table: "prediction_records", column: "status", sql: "ALTER TABLE prediction_records ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'" },
      { table: "prediction_records", column: "source_context_json", sql: "ALTER TABLE prediction_records ADD COLUMN source_context_json TEXT NOT NULL DEFAULT '{}'" },
      { table: "prediction_records", column: "updated_at", sql: "ALTER TABLE prediction_records ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''" },
      { table: "prediction_feedback", column: "feedback_source", sql: "ALTER TABLE prediction_feedback ADD COLUMN feedback_source TEXT NOT NULL DEFAULT 'user_chat'" },
      { table: "prediction_feedback", column: "raw_user_message", sql: "ALTER TABLE prediction_feedback ADD COLUMN raw_user_message TEXT" },
      { table: "prediction_feedback", column: "normalized_feedback_type", sql: "ALTER TABLE prediction_feedback ADD COLUMN normalized_feedback_type TEXT" },
      { table: "prediction_feedback", column: "actual_outcome_boolean", sql: "ALTER TABLE prediction_feedback ADD COLUMN actual_outcome_boolean INTEGER" },
      { table: "prediction_feedback", column: "actual_stat_value", sql: "ALTER TABLE prediction_feedback ADD COLUMN actual_stat_value REAL" },
      { table: "prediction_feedback", column: "confidence_adjustment_note", sql: "ALTER TABLE prediction_feedback ADD COLUMN confidence_adjustment_note TEXT" },
      { table: "prediction_feedback", column: "notes", sql: "ALTER TABLE prediction_feedback ADD COLUMN notes TEXT" },
      { table: "prediction_feedback", column: "match_confidence", sql: "ALTER TABLE prediction_feedback ADD COLUMN match_confidence REAL" },
      { table: "prediction_feedback", column: "match_reasons", sql: "ALTER TABLE prediction_feedback ADD COLUMN match_reasons TEXT" },
      { table: "model_calibration_log", column: "market_type", sql: "ALTER TABLE model_calibration_log ADD COLUMN market_type TEXT" },
      { table: "model_calibration_log", column: "outcome_boolean", sql: "ALTER TABLE model_calibration_log ADD COLUMN outcome_boolean INTEGER" },
      { table: "model_calibration_log", column: "probability_bucket", sql: "ALTER TABLE model_calibration_log ADD COLUMN probability_bucket TEXT" },
    ];

    for (const migration of migrations) {
      if (!this.hasColumn(migration.table, migration.column)) {
        this.db.exec(migration.sql);
      }
    }
  }

  private hasColumn(table: string, column: string) {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as DbRow[];

    return rows.some((row) => row.name === column);
  }
}
