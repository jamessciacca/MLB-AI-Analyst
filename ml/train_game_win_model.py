"""Train and export the MLB game winner logistic-regression model.

Usage:
    python ml/train_game_win_model.py --input data/game_win_training.csv

The exported JSON artifact is consumed by src/lib/game-win-predictor.ts.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from evaluate_model import evaluate_probabilities
from game_win_features import CONFIG, FEATURE_NAMES, TARGET, prepare_training_frame, split_time_ordered


def train_model(frame, calibrate: bool = True):
    train, validation = split_time_ordered(frame)
    x_train = train[FEATURE_NAMES]
    y_train = train[TARGET]
    x_validation = validation[FEATURE_NAMES]
    y_validation = validation[TARGET]

    base_pipeline = Pipeline(
        steps=[
            ("scaler", StandardScaler()),
            (
                "logistic",
                LogisticRegression(
                    C=0.8,
                    penalty="l2",
                    solver="lbfgs",
                    max_iter=2000,
                    class_weight="balanced",
                ),
            ),
        ]
    )
    base_pipeline.fit(x_train, y_train)

    if calibrate:
        model = CalibratedClassifierCV(base_pipeline, method="sigmoid", cv="prefit")
        model.fit(x_validation, y_validation)
    else:
        model = base_pipeline

    probabilities = model.predict_proba(x_validation)[:, 1]
    metrics = evaluate_probabilities(y_validation, probabilities)
    return model, metrics, train, validation


def export_artifact(model, metrics: dict, train, output_path: Path) -> None:
    if hasattr(model, "calibrated_classifiers_"):
        calibrated = model.calibrated_classifiers_[0]
        pipeline = calibrated.estimator
        calibrator = calibrated.calibrators[0]
        calibration = {
            "method": "platt",
            "intercept": float(calibrator.a_),
            "slope": float(calibrator.b_),
        }
    else:
        pipeline = model
        calibration = None

    scaler = pipeline.named_steps["scaler"]
    logistic = pipeline.named_steps["logistic"]
    coefficients = logistic.coef_[0]

    artifact = {
        "modelType": "regularized_logistic_regression",
        "version": f"game-win-logreg-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "target": TARGET,
        "featureNames": FEATURE_NAMES,
        "intercept": float(logistic.intercept_[0]),
        "coefficients": dict(zip(FEATURE_NAMES, map(float, coefficients))),
        "standardization": {
            "mean": dict(zip(FEATURE_NAMES, map(float, scaler.mean_))),
            "scale": dict(zip(FEATURE_NAMES, map(float, np.where(scaler.scale_ == 0, 1, scaler.scale_)))),
        },
        "calibration": calibration,
        "metrics": metrics,
        "trainingRows": int(len(train)),
        "config": {
            "modelName": CONFIG["modelName"],
            "positiveClass": CONFIG["positiveClass"],
        },
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(artifact, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="CSV with pregame game-level features.")
    parser.add_argument("--output", default=CONFIG["artifactPath"], help="Artifact JSON path.")
    parser.add_argument("--no-calibration", action="store_true", help="Disable sigmoid calibration.")
    args = parser.parse_args()

    frame = prepare_training_frame(args.input)
    model, metrics, train, _validation = train_model(frame, calibrate=not args.no_calibration)
    export_artifact(model, metrics, train, Path(args.output))

    print(json.dumps(metrics, indent=2))
    print(f"Saved model artifact to {args.output}")


if __name__ == "__main__":
    main()
