# MLB Analyst AI

A full-stack Next.js app that searches current MLB hitters and estimates whether a selected hitter has a strong chance to record at least one hit in a chosen game.

The app blends:

- MLB StatsAPI for current players, schedules, probable pitchers, venue metadata, and season stats
- Baseball Savant / Statcast CSV endpoints for expected stats, sprint speed, pitch mix, defense, and raw matchup data
- Open-Meteo for game-time weather
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
- Store feedback in `data/feedback.ndjson` so you can tune the model over time

## Notes

- This is a heuristics-based v1 model, not a fully trained betting model.
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
