# MLB Analyst AI

A full-stack Next.js app that searches current MLB hitters, estimates hit/home-run outcomes, compares lineup targets, and predicts MLB game winners.

The app blends:

- MLB StatsAPI for current players, schedules, probable pitchers, venue metadata, and season stats
- Baseball Savant / Statcast CSV endpoints for expected stats, sprint speed, pitch mix, defense, and raw matchup data
- Open-Meteo for game-time weather
- Optional enrichment providers: ESPN Site API, ESPN Core API, Open-Meteo historical weather, Nominatim geocoding, and Sunrise-Sunset daylight context
- Optional OpenAI reasoning for a short AI-written explanation layered on top of the deterministic score
- A local conversational memory agent for prediction explanation, preferences, and feedback learning

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env.local` if you want AI explanations:

```bash
cp .env.example .env.local
```

3. Add your OpenAI API key to `.env.local`:

```bash
OPENAI_API_KEY=your_key_here
```

4. Start the app:

```bash
npm run dev
```

5. Open `http://localhost:3000`

Run the terminal chat agent:

```bash
npm run chat
```

## What It Does

- Search current active MLB batters by name
- Pick a game date and matching game
- Pull live probable pitcher, venue, weather, hitter stats, pitcher stats, and Statcast matchup inputs
- Estimate:
  - per-at-bat hit probability
  - probability of at least one hit in the game
  - recommendation: `good play`, `neutral`, or `avoid`
- Predict game winners from starters, bullpen freshness, offense, lineups, defense, recent form, park, and weather context
- Store feedback in `data/feedback.ndjson` so you can tune the model over time
- Chat with a memory-aware MLB prediction assistant in the terminal
- Resolve natural-language prediction outcomes into calibration and training rows

## Chat Agent And Memory

The app includes a local conversational agent under `src/agent/`. It can explain saved predictions, remember stable user preferences, and log natural-language feedback such as:

```text
good prediction, Player A did get a hit
that HR pick was too aggressive
remember I care more about safe hit props than home run upside
weight lineup spot more heavily
```

Memory is persisted locally in SQLite at `data/agent-memory.sqlite` by default. The SQLite database stores chat sessions, chat messages, durable memories, user preferences, prediction records, prediction feedback, and calibration log rows. Existing raw prediction history remains in `data/predictions.ndjson`; the agent reads that file and mirrors recent records into SQLite for chat and feedback linking.

Terminal commands:

```text
/help
/exit
/memory
/feedback good Player A hit
/recent-predictions
/unresolved
/export-training
/sessions
/clear-session
/show-last-prediction
```

Agent API routes are available for scripts or future UI hooks:

- `POST /api/agent/chat`
- `GET /api/agent/sessions`
- `POST /api/agent/feedback`
- `GET /api/agent/memory` in development mode

Agent configuration:

```bash
AGENT_MEMORY_ENABLED=true
AGENT_SEMANTIC_MEMORY_ENABLED=false
AGENT_MAX_RECENT_MESSAGES=12
AGENT_MAX_RETRIEVED_MEMORIES=8
AGENT_MEMORY_DB_PATH=data/agent-memory.sqlite
AGENT_TERMINAL_ENABLED=true
AGENT_AUTO_MEMORY_ENABLED=true
AGENT_OPENAI_MODEL=gpt-5.4-mini
```

Semantic memory is intentionally off in v1. SQLite keyword, recency, category, and importance scoring are the default retrieval strategy. A future Chroma-backed retriever can sit beside `src/agent/memoryManager.ts`, storing embeddings in Chroma while keeping SQLite as the source of truth for memory metadata.

To test memory behavior:

```bash
npm run chat
```

Then say `remember I prefer safer hit props`, ask a follow-up, and inspect `/memory`. To test prediction feedback, run a prediction in the app, then use `/show-last-prediction` and `/feedback good player hit`.

## Outcome Feedback Loop

The app has an append-only resolved-prediction feedback subsystem in `src/outcomes/`. It does not mutate model weights from a single result. The loop is:

1. Predictions are saved to `data/predictions.ndjson`.
2. Recent predictions are mirrored into SQLite `prediction_records`.
3. Natural feedback is parsed, matched, and logged.
4. Resolved outcomes are appended to `resolved_prediction_outcomes`.
5. Calibration logs and aggregate bucket stats are updated.
6. Training-ready rows are accumulated for future model retraining.

Supported examples:

```text
William Contreras got a hit
good prediction, he got there
that one missed
you were right on that hit prop
the home run pick was too aggressive
he did not homer
that over 1.5 hits lost
good call on Contreras
```

Matching prefers unresolved predictions with the same player and market, then player-only matches, then the latest compatible prediction for phrases like `that one` or `he`. If the match confidence is too low, feedback is logged without resolving a prediction.

Calibration is bucketed in five-point probability bands such as `65_70`. When a prediction resolves, the app appends a `model_calibration_log` row and recomputes `aggregate_calibration_stats` for that market and bucket. This supports later analysis like whether 65-70% hit props are actually winning near that rate.

Prediction outcome API routes:

- `POST /api/predictions/feedback` with `{ "message": "William Contreras got a hit" }`
- `POST /api/predictions/resolve` for direct structured resolution
- `GET /api/predictions/recent`
- `GET /api/predictions/unresolved`
- `GET /api/predictions/calibration`
- `POST /api/predictions/export`

Training export:

```bash
npm run export:resolved
```

This writes:

- `data/training/resolved_predictions.csv`
- `data/training/resolved_predictions.jsonl`

Limitations: user feedback is treated as user-provided outcome evidence, not external truth. Ambiguous messages are not forced into a prediction. Reasoning-only feedback such as `too aggressive` is saved, but does not create an outcome row unless an actual outcome is inferable.

## Notes

- This is a heuristics-based v1 model, not a fully trained betting model.
- Game winner prediction uses `ml/artifacts/game_win_model.json` when trained, and falls back to a transparent scoring model when no artifact exists. See `docs/GAME_WIN_MODEL.md`.
- When a probable pitcher is missing, the app falls back to weaker team-level context and lowers confidence.
- "Field quality" is modeled as ballpark geometry plus opposing defense because there is not a clean free public API for literal daily field-condition quality.
- The AI summary is optional. The core score works without OpenAI.

## Commands

```bash
npm run dev
npm run build
npm run start
npm run lint
npm test
npm run chat
npm run export:resolved
```

## Data Sources

- MLB StatsAPI: https://statsapi.mlb.com/
- Baseball Savant CSV docs: https://baseballsavant.mlb.com/csv-docs
- Open-Meteo: https://open-meteo.com/

## External Enrichment Providers

The app now has an optional provider layer in `src/lib/providers/` and a merged context builder in `src/lib/enrichment/`.

Providers:

- ESPN Site API: schedule cross-check, event summary, injuries, and event-level context when exposed
- ESPN Core API: richer ESPN event references and competition metadata
- Open-Meteo forecast/archive: live weather fallback and historical weather for training/backtests
- Nominatim OpenStreetMap: venue geocoding when MLB venue coordinates are missing
- Sunrise-Sunset: daylight, twilight, and first-pitch timing relative to sunset

These providers are no-signup enrichment layers. The app continues if any of them fail, and missing enrichment lowers confidence instead of fabricating values. ESPN endpoints are unofficial and may change shape without notice.

Nominatim requires a valid User-Agent. You can optionally set:

```bash
NOMINATIM_USER_AGENT="MLBAnalystAI/1.0 your-email-or-site"
```

Backfill historical enrichment:

```bash
node scripts/backfill_external_enrichment.mjs \
  --input data/game_win_training.csv \
  --jsonl data/training/enriched_game_context.jsonl \
  --csv data/enriched_games.csv
```

The backfill script expects rows with at least `date` and ideally `venue_name`, `latitude`, and `longitude`. It writes historical weather and daylight features for future model training. Historical weather is for backtesting/training enrichment, not live-game forecasting.
