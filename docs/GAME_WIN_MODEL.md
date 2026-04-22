# MLB Game Winner Prediction

This feature predicts the winner of a selected MLB game and returns home/away win probabilities, a predicted winner, confidence tier, factor breakdown, warnings, and a feature snapshot.

## Runtime Flow

- UI calls `POST /api/game-win-prediction` with a `gamePk`.
- External requests go through timeout/retry wrappers and short TTL caches so one delayed source does not sink the whole prediction.
- `src/lib/game-win-analyzer.ts` fetches game context from existing app services.
- `src/lib/game-win-features.ts` builds one pregame feature vector for the game.
- `src/lib/game-win-predictor.ts` uses `ml/artifacts/game_win_model.json` when present.
- If no artifact exists, the app uses a deterministic fallback model.

## Inputs Used

The first version uses data sources already used by the app:

- MLB StatsAPI schedule, probable pitchers, team hitting/pitching/fielding, lineups, recent results
- MLB live feed boxscores for recent bullpen usage when available
- Baseball Savant pitcher expected stats and team defense extras
- Venue geometry and Open-Meteo weather through existing venue/weather helpers
- Optional enrichment from ESPN Site/Core, Nominatim geocoding, Open-Meteo historical/forecast, and Sunrise-Sunset daylight timing

Missing inputs degrade gracefully. The response includes warnings such as unconfirmed lineups, missing probable starters, unavailable bullpen usage, flaky upstream source calls, unavailable weather, or fallback-model use.

## API

```http
POST /api/game-win-prediction
Content-Type: application/json

{
  "gamePk": 776123
}
```

```http
GET /api/games/776123/win-prediction
GET /api/games/today/win-predictions?date=2026-04-22
```

Responses include `dataFreshness` with the generation time, game status, lineup status, and weather forecast timestamp when available.
Responses also include `externalContext` with normalized venue, weather, daylight, injuries, optional market context if ESPN exposes it, missing fields, and derived enrichment features.

## UI Integration

- Schedule game cards include a `Show Win %` action that loads a compact card-level winner percentage.
- The existing control panel includes `Analyze Game Winner` for the full breakdown.
- The full panel shows predicted winner, home/away win probabilities, model type/version, top factors, and warnings.
- The full panel also shows a short freshness line so users can see whether the card is using posted lineups, current game status, and recent generation time.

## Fallback Model

The fallback model is transparent and deterministic. It blends:

- starting pitcher edge
- team offense and power
- plate discipline
- lineup/platoon context
- bullpen quality and recent fatigue
- defense
- recent form and run differential
- rest days
- home field
- park/weather environment
- missing-data penalties

The weighted score is converted to a probability with a sigmoid.

## Projection Independence

The prediction code path uses baseball inputs only:

- `src/lib/game-win-features.ts` contains only baseball/context features.
- `src/lib/game-win-predictor.ts` scores only those baseball/context features.

This keeps the model from regurgitating public numbers.

## Training

The training path mirrors the hit model:

```bash
python ml/build_game_win_training_dataset.py --output data/game_win_training.csv
python ml/train_game_win_model.py --input data/game_win_training.csv
```

The trainer saves:

```text
ml/artifacts/game_win_model.json
```

Training uses a time-ordered split to reduce leakage. The target is `home_team_win`, where `1` means the home team won. Feature rows must contain only pregame-known inputs.

## Data Availability Notes

Current limitations are surfaced as warnings rather than hidden:

- confirmed lineups may not be available until pregame
- injury and transaction feeds are not yet integrated
- bullpen leverage quality is approximated from team pitching and recent relief usage
- travel/time-zone context is not yet calculated
