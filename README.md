# MLB Analyst AI

A full-stack Next.js app that searches current MLB hitters, estimates hit/home-run outcomes, compares lineup targets, and predicts MLB game winners.

The app blends:

- MLB StatsAPI for current players, schedules, probable pitchers, venue metadata, and season stats
- Baseball Savant / Statcast CSV endpoints for expected stats, sprint speed, pitch mix, defense, and raw matchup data
- Open-Meteo for game-time weather
- Optional enrichment providers: ESPN Site API, ESPN Core API, Open-Meteo historical weather, Nominatim geocoding, and Sunrise-Sunset daylight context
- Optional OpenAI reasoning for a short AI-written explanation layered on top of the deterministic score

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
