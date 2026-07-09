"""Compare baseline vs context-aware hit feature sets on the same training file.

Usage:
    python ml/evaluate_hit_game_context.py --input data/player_game_training.csv
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from sklearn.calibration import CalibratedClassifierCV
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from evaluate_model import evaluate_probabilities
from features import FEATURE_NAMES, TARGET, prepare_training_frame

GAME_CONTEXT_FEATURES = [
    "hitter_team_win_probability",
    "opponent_team_win_probability",
    "win_probability_gap",
    "hitter_team_is_favorite",
    "hitter_team_is_underdog",
    "hitter_team_implied_runs",
    "opponent_team_implied_runs",
    "game_total_runs",
    "run_total_gap",
    "hitter_team_share_of_total_runs",
    "game_competitiveness_score",
    "blowout_risk_score",
    "offensive_suppression_risk",
    "offensive_support_score",
    "hit_context_boost",
    "hit_context_penalty",
    "expected_plate_appearance_environment",
    "hitter_team_run_support_index",
]
BASELINE_FEATURES = [feature for feature in FEATURE_NAMES if feature not in GAME_CONTEXT_FEATURES]
CORE_METRICS = ("accuracy", "log_loss", "brier_score", "roc_auc")


def split_train_calibration_test(frame, test_fraction: float = 0.2, calibration_fraction: float = 0.2):
    """Time-ordered split into train, calibration, and test sets.

    The newest rows are held out for final evaluation. The preceding slice is used
    only for probability calibration, which keeps the test metrics more honest than
    calibrating and scoring on the same rows.
    """

    if len(frame) < 30:
        raise ValueError("Need at least 30 rows to run baseline vs context evaluation.")
    if not 0 < test_fraction < 0.4:
        raise ValueError("test_fraction should be between 0 and 0.4.")
    if not 0 < calibration_fraction < 0.3:
        raise ValueError("calibration_fraction should be between 0 and 0.3.")

    total_rows = len(frame)
    test_start = max(1, int(total_rows * (1 - test_fraction)))
    calibration_start = max(1, int(total_rows * (1 - test_fraction - calibration_fraction)))

    if calibration_start >= test_start:
        raise ValueError("Calibration split must start before test split.")

    train = frame.iloc[:calibration_start].copy()
    calibration = frame.iloc[calibration_start:test_start].copy()
    test = frame.iloc[test_start:].copy()

    if train.empty or calibration.empty or test.empty:
        raise ValueError("Train/calibration/test split produced an empty slice.")

    return train, calibration, test


def fit_and_score(train, calibration, evaluation, features):
    pipeline = Pipeline(
        steps=[
            ("scaler", StandardScaler()),
            (
                "logistic",
                LogisticRegression(
                    C=1.0,
                    penalty="l2",
                    solver="lbfgs",
                    max_iter=2000,
                    class_weight="balanced",
                ),
            ),
        ]
    )
    pipeline.fit(train[features], train[TARGET])
    calibrated = CalibratedClassifierCV(pipeline, method="sigmoid", cv="prefit")
    calibrated.fit(calibration[features], calibration[TARGET])
    probabilities = calibrated.predict_proba(evaluation[features])[:, 1]
    return probabilities


def slice_metrics(evaluation, probabilities, label, mask):
    subset = evaluation.loc[mask]
    if subset.empty:
        return {"label": label, "count": 0}
    subset_probs = probabilities[mask]
    metrics = evaluate_probabilities(subset[TARGET], subset_probs)
    return {"label": label, "count": int(len(subset)), **metrics}


def metric_delta(baseline_metrics, context_metrics):
    return {
        "accuracy_gain": context_metrics["accuracy"] - baseline_metrics["accuracy"],
        "log_loss_change": context_metrics["log_loss"] - baseline_metrics["log_loss"],
        "brier_score_change": context_metrics["brier_score"] - baseline_metrics["brier_score"],
        "roc_auc_gain": context_metrics["roc_auc"] - baseline_metrics["roc_auc"],
    }


def compact_metric_view(metrics):
    return {name: metrics[name] for name in CORE_METRICS}


def summarize_winner(delta):
    wins = []

    if delta["accuracy_gain"] > 0:
        wins.append("accuracy")
    if delta["roc_auc_gain"] > 0:
        wins.append("roc_auc")
    if delta["log_loss_change"] < 0:
        wins.append("log_loss")
    if delta["brier_score_change"] < 0:
        wins.append("brier_score")

    return wins


def write_output(path: str | None, payload: dict) -> None:
    if not path:
        return

    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="CSV with pregame player-game features.")
    parser.add_argument(
        "--output",
        help="Optional JSON output path. Example: data/evaluation/hit_context_eval.json",
    )
    args = parser.parse_args()

    frame = prepare_training_frame(args.input)
    train, calibration, test = split_train_calibration_test(frame)
    baseline_probs = fit_and_score(train, calibration, test, BASELINE_FEATURES)
    context_probs = fit_and_score(train, calibration, test, FEATURE_NAMES)
    baseline_metrics = evaluate_probabilities(test[TARGET], baseline_probs)
    context_metrics = evaluate_probabilities(test[TARGET], context_probs)

    segments = {
        "favorites": test["hitter_team_is_favorite"] >= 0.5,
        "underdogs": test["hitter_team_is_underdog"] >= 0.5,
        "high_blowout_risk": test["blowout_risk_score"] >= 0.6,
        "low_blowout_risk": test["blowout_risk_score"] <= 0.35,
        "low_team_total": test["hitter_team_implied_runs"] <= 3.8,
        "high_team_total": test["hitter_team_implied_runs"] >= 4.8,
    }

    output = {
        "input": args.input,
        "split": {
            "train_rows": int(len(train)),
            "calibration_rows": int(len(calibration)),
            "test_rows": int(len(test)),
        },
        "baseline_features": BASELINE_FEATURES,
        "context_features": GAME_CONTEXT_FEATURES,
        "baseline_metrics": baseline_metrics,
        "context_metrics": context_metrics,
        "metric_delta": metric_delta(baseline_metrics, context_metrics),
        "summary": {
            "winning_metrics_for_context_model": summarize_winner(
                metric_delta(baseline_metrics, context_metrics)
            ),
            "baseline_compact": compact_metric_view(baseline_metrics),
            "context_compact": compact_metric_view(context_metrics),
        },
        "segment_breakdown": {
            name: {
                "baseline": slice_metrics(test, baseline_probs, name, mask),
                "context": slice_metrics(test, context_probs, name, mask),
                "delta": metric_delta(
                    slice_metrics(test, baseline_probs, name, mask),
                    slice_metrics(test, context_probs, name, mask),
                )
                if int(mask.sum()) > 0
                else {"accuracy_gain": 0, "log_loss_change": 0, "brier_score_change": 0, "roc_auc_gain": 0},
            }
            for name, mask in segments.items()
        },
    }

    write_output(args.output, output)
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
