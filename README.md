# MLB Analyst AI

A full-stack Next.js app that searches current MLB hitters, estimates hit/home-run outcomes, compares lineup targets, and predicts MLB game winners.

The app blends:

- MLB StatsAPI for current players, schedules, probable pitchers, venue metadata, and season stats
- Baseball Savant / Statcast CSV endpoints for expected stats, sprint speed, pitch mix, defense, and raw matchup data
- Open-Meteo for game-time weather
- Optional The Odds API for moneyline, batter hit props, batter HR props, and no-vig market context
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

Optional analyst-engine market context:

```bash
ODDS_API_KEY=your_api_key_here
ODDS_DEFAULT_REGION=us
ODDS_FORMAT=american
ODDS_BOOKMAKERS=
ODDS_PREFERRED_BOOKMAKERS=draftkings
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
- Feed hit props with balanced game-shape context like win probability, team run environment, competitiveness, and blowout risk
- Generate a richer MLB Analyst Engine view that blends:
  - player talent baseline
  - recent form
  - batter vs pitcher matchup
  - pitch mix and handedness
  - bullpen quality and fatigue
  - lineup spot / projected plate appearances
  - ballpark and weather
  - Vegas context when available
  - game script / blowout risk
  - local feedback calibration
- Rank full lineups with a Hitter Selection Explanation Engine that:
  - does not blindly choose stars
  - compares teammates on recent process, at-bat quality, matchup, value, and risk
  - explains why the chosen hitter beat the obvious bigger-name alternatives
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

## Hit Prop Game Context

Hit props are no longer scored in isolation. For `hit` markets, the app now builds a game-shape context layer in `src/lib/hit-game-context-features.ts` and feeds it into both the fallback scorer and the ML feature vector.

The context layer includes:

- hitter team win probability and opponent win probability
- implied team run environment for both sides
- game competitiveness and blowout-risk proxies
- offensive support and offensive suppression scores
- expected plate-appearance environment and run-support index

The adjustment is intentionally capped and moderate. Favorites do not automatically get a blanket boost, and underdogs are not automatically buried. The hitter-pitcher matchup still carries most of the weight.

Example behavior:

- A hitter on a modest favorite with healthy projected team runs in a close game can get a small context boost.
- A hitter on a weak underdog with low projected runs and elevated blowout risk can get a slight penalty.
- A close, balanced game often stays near neutral, so batter skill and pitcher matchup remain the main drivers.

Every hit analysis response now includes:

- `hitGameContext` for the engineered context features
- `debug.hitGameContext` for inspection fields like:
  - `hitterTeamWinProbability`
  - `hitterTeamImpliedRuns`
  - `gameCompetitivenessScore`
  - `blowoutRiskScore`
  - `contextAdjustmentDelta`
  - `preContextHitProbability`
  - `finalHitProbability`

Useful tuning flags:

```bash
ENABLE_GAME_CONTEXT_FOR_HIT_PROPS=true
HIT_GAME_CONTEXT_WEIGHT=1
MAX_GAME_CONTEXT_BOOST=0.012
MAX_GAME_CONTEXT_PENALTY=0.018
USE_MARKET_IMPLIED_WIN_PROBABILITY=true
USE_INTERNAL_WIN_MODEL=true
BLEND_MARKET_AND_INTERNAL_WIN_CONTEXT=true
HIT_GAME_CONTEXT_INTERNAL_BLEND_WEIGHT=0.6
```

To evaluate whether the new context features are actually helping, run:

```bash
python3 ml/evaluate_hit_game_context.py --input data/player_game_training.csv
```

Or use the shortcut:

```bash
npm run eval:hit-context
```

The evaluator now:

- uses a time-ordered train / calibration / test split
- calibrates probabilities on a middle slice and evaluates only on the newest holdout slice
- compares baseline hit features vs context-aware hit features
- reports metric deltas for:
  - accuracy
  - log loss
  - Brier score
  - ROC AUC
- breaks results out for:
  - favorites
  - underdogs
  - high blowout risk
  - low blowout risk
  - low team total
  - high team total

If you use the npm shortcut, it also writes a JSON report to:

```text
data/evaluation/hit_context_eval.json
```

## MLB Analyst Engine

The app now includes a deeper analyst layer exposed through:

```text
GET /api/mlb/analyst/prediction?playerName=Aaron%20Judge&gameId=777123&market=hit
```

Supported query params:

- `playerName` or `playerId`
- `gameId` or `gamePk`
- `market=hit|home_run|total_bases|rbi|runs`
- optional `sportsbookOdds=-110`

The analyst engine blends configurable weights from `src/lib/analyst/weights.ts` across:

- base model probability
- batter context
- pitcher matchup
- team offense
- game environment
- market context
- feedback calibration

The response includes:

- probability and fair odds
- confidence and lean
- top reasons for and against
- last-10 game pattern analysis
- at-bat quality trend signals
- seeded Monte Carlo hit simulation
- game script summary with blowout risk
- matchup notes, pitch mix notes, and handedness context
- ballpark and weather summaries
- Vegas market context if available
- data-source and missing-data warnings
- supporting context for HR / total bases / RBI / runs

If the Odds API key is missing, the engine falls back to lighter ESPN odds context when available, or skips odds gracefully.

## Vegas Odds Integration

The app now has a dedicated The Odds API layer in `src/lib/vegas-odds-service.ts`.

Supported MLB markets:

- `h2h` for moneyline
- `batter_hits` for hitter hit props
- `batter_home_runs` for hitter home-run props

Normalized odds routes:

- `GET /api/odds/mlb/moneyline`
- `GET /api/odds/mlb/event/:eventId/player-props`
- `GET /api/odds/mlb/game/:gameId`
- `GET /api/odds/mlb/player?playerName=&gameId=&market=batter_hits`

What the odds layer adds:

- sportsbook price and implied probability
- no-vig market probability when both sides are available
- fair odds from the model probability
- edge between the model and the book price
- value rating for hit and HR props when prices are posted

The analyst engine uses odds as one signal, not the whole answer. Moneyline context helps game script and team-strength assumptions, while player props help the hit-prop and HR-prop value view.

Bookmaker behavior:

- `ODDS_BOOKMAKERS` restricts the API request to only those books
- `ODDS_PREFERRED_BOOKMAKERS` tells the app which book to prefer first when multiple books are returned

The default preferred bookmaker is now `draftkings`, so the app will use DraftKings odds when they exist and fall back gracefully when DraftKings has not posted that market yet.

## Best Hitter Explanation Engine

`Find Best Hit Pick` no longer just sorts by raw hit probability. The app now runs a hitter-selection layer for published lineups and explains the pick like an analyst.

The selection engine:

- evaluates the full lineup instead of only the biggest names
- blends raw hit probability, matchup score, recent form, at-bat quality, value, under-the-radar score, and risk
- uses a star-power proxy so the app does not blindly default to the most famous hitter
- compares the chosen hitter against at least three alternatives
- explains why the selected hitter beat the obvious star when that happens

Interpretation notes:

- `raw probability score`: the hitter's direct hit probability
- `matchup score`: handedness, pitch-shape, and pitcher-quality fit
- `recent form score`: last-10 results and process trend
- `at-bat quality score`: whether the hitter is making better contact than the box score suggests
- `value score`: internal edge after accounting for star/name inflation when player prop odds are unavailable
- `under-the-radar score`: boost for players with strong profiles but less obvious star power
- `risk score`: downside from strikeout pressure, lineup uncertainty, missing data, and game-script issues

The UI now shows:

- selected hitter
- hit probability
- confidence
- why this player
- why not the obvious star
- top 3 alternatives
- risk warning
- analyst explanation paragraph

To print the best hitter explanation for every game on a date while the app is running:

```bash
node scripts/testBestHittersExplanation.js 2026-04-23
```

Optional second argument:

```bash
node scripts/testBestHittersExplanation.js 2026-04-23 hit
```

## MLB Hit Analyst Dashboard

There is now a dedicated dashboard page at:

```text
/hit-analyst
```

The page is linked from the main app and presents:

- today's best hitters by game
- the selected hitter for each matchup
- hit probability and fair odds
- confidence and recommendation
- why this player
- why not the obvious star
- top alternatives
- simulation and risk summaries
- data-quality notes
- a live calibration snapshot

## New MLB API Routes

The app now exposes a broader MLB hit-analysis surface under `src/app/api/mlb/`:

- `GET /api/mlb/player-hit-analysis?playerName=Aaron%20Judge&gameId=777123`
- `GET /api/mlb/best-hitters-today`
- `GET /api/mlb/best-hitters-by-game?date=2026-04-23`
- `GET /api/mlb/game-hit-board?gameId=777123`
- `POST /api/mlb/feedback`
- `GET /api/mlb/model-performance`

Notes:

- `player-hit-analysis` accepts `playerId` or `playerName`, and can infer the next game when `gameId` is omitted.
- `best-hitters-by-game` and `best-hitters-today` are lineup-dependent. If lineups are not posted yet, the response will warn instead of inventing bats.
- `model-performance` blends live feedback calibration with any saved ML artifacts in `ml/artifacts/`.

Example feedback payload:

```json
{
  "playerId": 592450,
  "playerName": "Aaron Judge",
  "gamePk": 777123,
  "market": "hit",
  "probability": 0.67,
  "actualResult": true,
  "featuresUsed": ["last10", "simulation", "pitcherMatchup"],
  "notes": "Good process call"
}
```

## Training And Retraining

Install Python dependencies:

```bash
python -m pip install -r ml/requirements.txt
```

Train the hit model:

```bash
python ml/train_hit_model.py --input data/player_game_training.csv
```

The training script now:

- compares Logistic Regression, Random Forest, and Gradient Boosting
- prints a validation summary
- exports the runtime JSON artifact used by the app
- writes `ml/artifacts/hit_model_training_summary.json`
- writes `ml/artifacts/calibration.json`

The web app still consumes the coefficient-based logistic artifact for runtime inference, so if a tree model wins validation you will see that called out in the training summary while the runtime export remains app-compatible.

## Feedback And Long-Term Learning

Manual analyst feedback is still stored locally, and resolved outcomes continue to feed the calibration loop.

Useful files:

- `data/feedback.ndjson`
- `data/outcome-feedback.ndjson`
- `data/predictions.ndjson`

Helpful commands:

```bash
npm install
npm run dev
python -m pip install -r ml/requirements.txt
python ml/train_hit_model.py --input data/player_game_training.csv
npm run export:resolved
```

Additional hit-analyst test scripts:

```bash
node scripts/testPlayerHitAnalysis.js "Aaron Judge"
node scripts/testBestHittersToday.js
node scripts/testSimulation.js "Nico Hoerner"
node scripts/testCalibration.js
node scripts/testVegasOdds.js
```

## Notes

- This is a heuristics-based v1 model, not a fully trained betting model.
- Game winner prediction uses `ml/artifacts/game_win_model.json` when trained, and falls back to a transparent scoring model when no artifact exists. See `docs/GAME_WIN_MODEL.md`.
- When a probable pitcher is missing, the app falls back to weaker team-level context and lowers confidence.
- When lineups are not posted yet, best-hitter board routes warn and degrade gracefully instead of faking projected batting orders.
- Player-specific hit-prop odds are still optional and may be unavailable; when that happens, value scoring uses the current internal proxy logic rather than invented prices.
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
