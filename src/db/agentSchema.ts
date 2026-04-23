export const AGENT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
);

CREATE TABLE IF NOT EXISTS memory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  importance_score REAL NOT NULL DEFAULT 0.5,
  source TEXT NOT NULL DEFAULT 'chat',
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS user_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.6,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prediction_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prediction_id TEXT NOT NULL UNIQUE,
  game_date TEXT,
  game_id INTEGER,
  team TEXT,
  opponent TEXT,
  player_name TEXT,
  player_id INTEGER,
  market_type TEXT NOT NULL,
  market_line TEXT,
  predicted_probability REAL,
  model_score REAL,
  implied_probability REAL,
  prediction_summary TEXT NOT NULL,
  reasoning_features_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  source_context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS prediction_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prediction_id TEXT,
  feedback_source TEXT NOT NULL DEFAULT 'user_chat',
  raw_user_message TEXT,
  normalized_feedback_type TEXT,
  feedback_type TEXT NOT NULL,
  user_message TEXT NOT NULL,
  actual_outcome TEXT NOT NULL DEFAULT 'unknown',
  actual_outcome_boolean INTEGER,
  actual_stat_value REAL,
  was_prediction_correct INTEGER,
  confidence_adjustment_note TEXT,
  notes TEXT,
  match_confidence REAL,
  match_reasons TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resolved_prediction_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prediction_id TEXT NOT NULL,
  resolved_at TEXT NOT NULL,
  actual_outcome INTEGER,
  actual_value REAL,
  was_prediction_correct INTEGER,
  resolution_method TEXT NOT NULL,
  resolution_confidence REAL NOT NULL,
  raw_resolution_context_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS model_calibration_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prediction_id TEXT,
  market_type TEXT,
  predicted_probability REAL,
  outcome_boolean INTEGER,
  observed_outcome INTEGER,
  probability_bucket TEXT,
  bucket TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS aggregate_calibration_stats (
  market_type TEXT NOT NULL,
  probability_bucket TEXT NOT NULL,
  total_predictions INTEGER NOT NULL,
  total_wins INTEGER NOT NULL,
  observed_win_rate REAL NOT NULL,
  avg_predicted_probability REAL NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (market_type, probability_bucket)
);

CREATE TABLE IF NOT EXISTS training_feedback_rows (
  prediction_id TEXT PRIMARY KEY,
  player_name TEXT,
  game_date TEXT,
  game_id INTEGER,
  market_type TEXT NOT NULL,
  market_line TEXT,
  predicted_probability REAL,
  implied_probability REAL,
  reasoning_features_json TEXT NOT NULL DEFAULT '{}',
  actual_outcome INTEGER,
  actual_value REAL,
  was_prediction_correct INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created
  ON chat_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_items_category_created
  ON memory_items(category, created_at);
CREATE INDEX IF NOT EXISTS idx_prediction_feedback_prediction
  ON prediction_feedback(prediction_id, created_at);
CREATE INDEX IF NOT EXISTS idx_prediction_records_status_created
  ON prediction_records(status, created_at);
CREATE INDEX IF NOT EXISTS idx_resolved_prediction_outcomes_prediction
  ON resolved_prediction_outcomes(prediction_id, resolved_at);
`;
