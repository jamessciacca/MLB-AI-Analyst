# MLB Hit Prediction Model

## Goal

Predict the probability that a hitter records at least one hit in a selected game. The app also derives expected hits and an approximate probability of 2+ hits from the predicted 1+ hit probability and projected at-bats.

## Current Architecture

The app is Next.js/TypeScript. The existing context-aware model lives in `src/lib/scoring.ts` and remains as a fallback.

The ML path adds:

- `ml/model_config.json`: shared feature list and league-average defaults.
- `ml/features.py`: training-time feature preparation and leakage checks.
- `ml/train_hit_model.py`: regularized logistic-regression training, calibration, evaluation, and JSON export.
- `src/lib/ml-hit-features.ts`: app-side feature generation from `AnalysisModelInput`.
- `src/lib/ml-hit-predictor.ts`: app-side inference from the exported JSON artifact.

If `ml/artifacts/hit_model.json` exists, `scoreOutcomeChance()` uses it for 1+ hit probability. If the artifact is missing or invalid, the app uses the existing context-aware fallback model.

## Target Definition

Training row level: one hitter in one game.

Target column:

- `has_hit = 1` if the hitter recorded at least one hit.
- `has_hit = 0` otherwise.

The target is postgame, but all feature columns must be pregame values only.

## Feature Groups

Feature names are centralized in `ml/model_config.json`.

Batter features:

- AVG, OBP, SLG, OPS
- xBA, xwOBA
- strikeout rate, walk rate
- hard-hit rate
- split/outcome rate against pitcher handedness
- last-5 hit rate, hits per game, HR rate

Pitcher features:

- AVG allowed
- WHIP
- K rate, BB rate
- xBA allowed, xwOBA allowed
- hard-hit allowed
- starter handedness

Context features:

- lineup slot
- projected at-bats
- home/away
- park hit factor
- temperature and precipitation probability
- opponent defense OAA and fielding percentage
- batter contact quality minus pitcher contact allowed

## Anti-Leakage Rules

Feature generation must not use same-game boxscore outcomes. The Python pipeline rejects suspicious column names such as `actual_hits`, `same_game_hits`, `boxscore_hits`, and similar patterns unless the column is the target.

When building a historical training CSV, every feature should be calculated from data available before that game started. Season and rolling stats should be lagged to exclude the current game.

## Model

Baseline model: L2-regularized logistic regression.

Why this model:

- It is a proper binary classifier for hit/no-hit.
- Its coefficients are interpretable.
- It is easier to calibrate and debug than a complex model.
- It is a strong baseline before gradient boosting.

The training script optionally applies sigmoid calibration on the validation split.

## Evaluation

`ml/evaluate_model.py` reports:

- accuracy
- ROC AUC
- log loss
- Brier score
- calibration buckets
- threshold summary at 0.50

Calibration and Brier score matter because this app displays probabilities, not only rankings.

## Retraining

Install Python dependencies:

```bash
python -m pip install -r ml/requirements.txt
```

Train:

```bash
python ml/train_hit_model.py --input data/player_game_training.csv
```

The script exports:

```text
ml/artifacts/hit_model.json
```

The Next.js app loads that artifact automatically on the server. Restart the app after retraining so the in-memory artifact cache reloads.

## App Inference

The app computes the same feature names in `src/lib/ml-hit-features.ts`. `src/lib/ml-hit-predictor.ts` standardizes those features using the training scaler, applies the logistic-regression coefficients, applies optional calibration, then returns:

- probability of 1+ hit
- expected hits
- probability of 2+ hits
- top contributing features

The scorer adds an `ML model` explanation card when the artifact is active.

## Missing Data That Would Improve Accuracy

- True historical player-game training table with lagged pregame features.
- Reliable batter split stats vs RHP/LHP, lagged by game date.
- Bullpen quality and bullpen fatigue before each game.
- Team implied run totals and game total from betting markets.
- Confirmed historical lineup slot before first pitch.
- Park factors by handedness, not only venue dimensions.
- Rolling 7-game and 15-game features for hitter and pitcher.
- Opponent defensive alignment and fielder availability.

## Future Model Swaps

The feature contract and exported artifact path are intentionally separated from the app scorer. A future gradient boosting model can reuse the same feature table and export a different artifact shape, while keeping the current fallback model available.
