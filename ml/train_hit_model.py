"""Train and export the MLB 1+ hit logistic-regression model.

Usage:
    python ml/train_hit_model.py --input data/player_game_training.csv

The exported JSON artifact is consumed directly by src/lib/ml-hit-predictor.ts.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from evaluate_model import evaluate_probabilities
from features import (
    CONFIG,
    FEATURE_NAMES,
    SOURCE_PROBABILITY,
    TARGET,
    prepare_training_frame,
    split_time_ordered,
)


def build_candidate_models():
    return {
        "logistic_regression": Pipeline(
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
        ),
        "random_forest": RandomForestClassifier(
            n_estimators=300,
            max_depth=8,
            min_samples_leaf=10,
            random_state=42,
            class_weight="balanced_subsample",
        ),
        "gradient_boosting": HistGradientBoostingClassifier(
            learning_rate=0.05,
            max_depth=6,
            max_iter=250,
            min_samples_leaf=20,
            random_state=42,
        ),
    }


def fit_logistic_candidate(base_pipeline, x_train, y_train, x_validation, y_validation, calibrate: bool):
    base_pipeline.fit(x_train, y_train)

    if calibrate:
        calibrated = CalibratedClassifierCV(base_pipeline, method="sigmoid", cv="prefit")
        calibrated.fit(x_validation, y_validation)
        model = calibrated
    else:
        model = base_pipeline

    probabilities = model.predict_proba(x_validation)[:, 1]
    metrics = evaluate_probabilities(y_validation, probabilities)
    return model, metrics


def fit_tree_candidate(model, x_train, y_train, x_validation, y_validation):
    model.fit(x_train, y_train)
    probabilities = model.predict_proba(x_validation)[:, 1]
    metrics = evaluate_probabilities(y_validation, probabilities)
    return model, metrics


def logit_probability(probabilities):
    clipped = np.clip(np.asarray(probabilities, dtype=float), 0.001, 0.999)
    return np.log(clipped / (1 - clipped)).reshape(-1, 1)


def fit_source_probability_calibration(train, validation):
    """Calibrate the app's own saved probabilities when resolved feedback exists.

    Early local training exports can have sparse feature snapshots, but they often
    still include the probability the app actually showed. A one-dimensional
    Platt calibrator lets runtime predictions learn from that feedback without
    treating missing feature columns as meaningful baseball signal.
    """

    if SOURCE_PROBABILITY not in train.columns or SOURCE_PROBABILITY not in validation.columns:
        return None

    train_rows = train.dropna(subset=[SOURCE_PROBABILITY, TARGET])
    validation_rows = validation.dropna(subset=[SOURCE_PROBABILITY, TARGET])

    if (
        len(train_rows) < 30
        or len(validation_rows) < 10
        or train_rows[TARGET].nunique() < 2
        or train_rows[SOURCE_PROBABILITY].nunique() < 2
    ):
        return None

    baseline_metrics = evaluate_probabilities(
        validation_rows[TARGET],
        validation_rows[SOURCE_PROBABILITY],
    )
    calibrator = LogisticRegression(C=1000.0, solver="lbfgs", max_iter=1000)
    calibrator.fit(logit_probability(train_rows[SOURCE_PROBABILITY]), train_rows[TARGET])

    validation_probabilities = calibrator.predict_proba(
        logit_probability(validation_rows[SOURCE_PROBABILITY])
    )[:, 1]
    metrics = evaluate_probabilities(validation_rows[TARGET], validation_probabilities)

    if (
        metrics["log_loss"] > baseline_metrics["log_loss"] + 0.0001
        or metrics["brier_score"] > baseline_metrics["brier_score"] + 0.0001
    ):
        return {
            "accepted": False,
            "reason": "calibrated validation metrics did not improve raw saved probabilities",
            "baselineMetrics": baseline_metrics,
            "candidateMetrics": metrics,
        }

    return {
        "accepted": True,
        "method": "platt_logit",
        "sourceColumn": SOURCE_PROBABILITY,
        "intercept": float(calibrator.intercept_[0]),
        "slope": float(calibrator.coef_[0][0]),
        "trainingRows": int(len(train_rows)),
        "validationRows": int(len(validation_rows)),
        "metrics": metrics,
    }


def extract_feature_importance(model_name: str, model):
    if model_name == "logistic_regression":
        pipeline = model.calibrated_classifiers_[0].estimator if hasattr(model, "calibrated_classifiers_") else model
        logistic = pipeline.named_steps["logistic"]
        return dict(
            sorted(
                zip(FEATURE_NAMES, map(lambda value: abs(float(value)), logistic.coef_[0])),
                key=lambda item: item[1],
                reverse=True,
            )
        )

    if hasattr(model, "feature_importances_"):
        return dict(
            sorted(
                zip(FEATURE_NAMES, map(float, model.feature_importances_)),
                key=lambda item: item[1],
                reverse=True,
            )
        )

    return {}


def train_model(frame, calibrate: bool = True):
    """Train multiple candidates, compare validation metrics, and keep a runtime-safe export."""

    if len(frame) < 30:
        raise ValueError(
            "Not enough training rows to train safely. Collect at least 30 resolved hit rows; "
            "the app will continue using the context scoring fallback or existing artifact."
        )
    if frame[TARGET].nunique() < 2:
        raise ValueError(
            "Training target has only one class. Collect both hit and no-hit outcomes before training."
        )

    train, validation = split_time_ordered(frame)
    x_train = train[FEATURE_NAMES]
    y_train = train[TARGET]
    x_validation = validation[FEATURE_NAMES]
    y_validation = validation[TARGET]

    candidates = {}

    for name, candidate in build_candidate_models().items():
        if name == "logistic_regression":
            model, metrics = fit_logistic_candidate(
                candidate,
                x_train,
                y_train,
                x_validation,
                y_validation,
                calibrate=calibrate,
            )
        else:
            model, metrics = fit_tree_candidate(candidate, x_train, y_train, x_validation, y_validation)

        candidates[name] = {
            "model": model,
            "metrics": metrics,
            "feature_importance": extract_feature_importance(name, model),
        }

    best_model_name = min(
        candidates.keys(),
        key=lambda name: (
            candidates[name]["metrics"]["log_loss"],
            candidates[name]["metrics"]["brier_score"],
        ),
    )

    return {
        "train": train,
        "validation": validation,
        "best_model_name": best_model_name,
        "candidates": candidates,
        "runtime_model_name": "logistic_regression",
        "runtime_model": candidates["logistic_regression"]["model"],
        "runtime_metrics": candidates["logistic_regression"]["metrics"],
        "source_probability_calibration": fit_source_probability_calibration(train, validation),
    }


def export_artifact(model, metrics: dict, train, output_path: Path) -> None:
    """Export coefficients and scaler stats as app-friendly JSON."""

    if hasattr(model, "calibrated_classifiers_"):
        calibrated = model.calibrated_classifiers_[0]
        pipeline = calibrated.estimator
        calibrator = calibrated.calibrators[0]
        calibration = {
            "method": "platt",
            "intercept": float(-calibrator.b_),
            "slope": float(-calibrator.a_),
        }
    else:
        pipeline = model
        calibration = None

    scaler = pipeline.named_steps["scaler"]
    logistic = pipeline.named_steps["logistic"]
    coefficients = logistic.coef_[0]

    artifact = {
        "modelType": "regularized_logistic_regression",
        "version": f"hit-logreg-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
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


def export_training_summary(result: dict, output_path: Path) -> None:
    summary = {
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "bestValidationModel": result["best_model_name"],
        "runtimeModel": result["runtime_model_name"],
        "trainingRows": int(len(result["train"])),
        "validationRows": int(len(result["validation"])),
        "sourceProbabilityCalibration": result["source_probability_calibration"],
        "candidates": {
            name: {
                "metrics": payload["metrics"],
                "featureImportance": dict(list(payload["feature_importance"].items())[:15]),
            }
            for name, payload in result["candidates"].items()
        },
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(summary, indent=2))


def export_calibration_artifact(metrics: dict, source_probability_calibration: dict | None, output_path: Path) -> None:
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "runtimeModel": "logistic_regression",
        "brierScore": metrics.get("brier_score"),
        "logLoss": metrics.get("log_loss"),
        "accuracy": metrics.get("accuracy"),
        "rocAuc": metrics.get("roc_auc"),
        "calibration": metrics.get("calibration", []),
        "sourceProbabilityCalibration": source_probability_calibration,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="CSV with pregame player-game features.")
    parser.add_argument("--output", default=CONFIG["artifactPath"], help="Artifact JSON path.")
    parser.add_argument("--no-calibration", action="store_true", help="Disable sigmoid calibration.")
    args = parser.parse_args()

    frame = prepare_training_frame(args.input)
    result = train_model(frame, calibrate=not args.no_calibration)
    artifact_path = Path(args.output)
    export_artifact(result["runtime_model"], result["runtime_metrics"], result["train"], artifact_path)
    export_training_summary(result, artifact_path.with_name("hit_model_training_summary.json"))
    export_calibration_artifact(
        result["runtime_metrics"],
        result["source_probability_calibration"],
        artifact_path.with_name("calibration.json"),
    )

    print("Validation model comparison:")
    for name, payload in result["candidates"].items():
        metrics = payload["metrics"]
        print(
            f"- {name}: log_loss={metrics['log_loss']:.4f} "
            f"brier={metrics['brier_score']:.4f} accuracy={metrics['accuracy']:.4f}"
        )

    if result["best_model_name"] != result["runtime_model_name"]:
        print(
            f"Best validation model was {result['best_model_name']}, but the exported runtime artifact remains "
            f"{result['runtime_model_name']} because the web app currently consumes coefficient-based JSON inference."
        )

    print(json.dumps(result["runtime_metrics"], indent=2))
    print(f"Saved runtime artifact to {args.output}")
    print(f"Saved training summary to {artifact_path.with_name('hit_model_training_summary.json')}")
    print(f"Saved calibration artifact to {artifact_path.with_name('calibration.json')}")


if __name__ == "__main__":
    main()
