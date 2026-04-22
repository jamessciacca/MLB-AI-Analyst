"""Evaluation helpers for the MLB hit model."""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss, roc_auc_score


def calibration_table(y_true, probabilities, buckets: int = 10) -> list[dict[str, float]]:
    """Return calibration buckets: predicted rate vs observed hit rate."""

    frame = pd.DataFrame({"target": y_true, "probability": probabilities})
    frame["bucket"] = pd.cut(frame["probability"], bins=np.linspace(0, 1, buckets + 1), include_lowest=True)
    table = []

    for bucket, group in frame.groupby("bucket", observed=False):
        if group.empty:
            continue
        table.append(
            {
                "bucket": str(bucket),
                "count": int(len(group)),
                "avg_probability": float(group["probability"].mean()),
                "observed_rate": float(group["target"].mean()),
            }
        )

    return table


def threshold_summary(y_true, probabilities, threshold: float = 0.5) -> dict[str, int | float]:
    """Simple confusion-style summary for a configurable decision threshold."""

    predicted = np.asarray(probabilities) >= threshold
    truth = np.asarray(y_true) == 1

    return {
        "threshold": threshold,
        "true_positive": int(np.sum(predicted & truth)),
        "false_positive": int(np.sum(predicted & ~truth)),
        "true_negative": int(np.sum(~predicted & ~truth)),
        "false_negative": int(np.sum(~predicted & truth)),
    }


def evaluate_probabilities(y_true, probabilities) -> dict:
    """Compute probability-quality metrics, not just classification accuracy."""

    y_true = np.asarray(y_true)
    probabilities = np.asarray(probabilities)
    predicted = probabilities >= 0.5

    metrics = {
        "accuracy": float(accuracy_score(y_true, predicted)),
        "log_loss": float(log_loss(y_true, probabilities, labels=[0, 1])),
        "brier_score": float(brier_score_loss(y_true, probabilities)),
        "calibration": calibration_table(y_true, probabilities),
        "threshold_50": threshold_summary(y_true, probabilities, 0.5),
    }

    if len(np.unique(y_true)) > 1:
        metrics["roc_auc"] = float(roc_auc_score(y_true, probabilities))
    else:
        metrics["roc_auc"] = float("nan")

    return metrics
