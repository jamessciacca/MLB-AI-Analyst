"""Feature preparation for the MLB game winner model.

Target is binary: 1 when the home team wins, 0 when the away team wins.
All feature columns are expected to be known before first pitch.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

import pandas as pd

CONFIG_PATH = Path(__file__).with_name("game_win_model_config.json")
CONFIG = json.loads(CONFIG_PATH.read_text())
FEATURE_NAMES: list[str] = CONFIG["featureNames"]
DEFAULTS: dict[str, float] = CONFIG["defaults"]
TARGET = CONFIG["target"]

LEAKAGE_COLUMN_HINTS = {
    "final",
    "postgame",
    "actual",
    "result",
    "home_score",
    "away_score",
    "runs_scored",
}


def assert_no_leakage_columns(columns: Iterable[str]) -> None:
    leaked = [
        column
        for column in columns
        if column != TARGET and any(hint in column.lower() for hint in LEAKAGE_COLUMN_HINTS)
    ]
    if leaked:
        raise ValueError(f"Potential leakage columns found: {', '.join(leaked)}")


def prepare_training_frame(path: str | Path) -> pd.DataFrame:
    frame = pd.read_csv(path)
    assert_no_leakage_columns(frame.columns)

    if "date" not in frame.columns:
        raise ValueError("Training data must include a date column for time split.")
    if TARGET not in frame.columns:
        raise ValueError(f"Training data must include target column {TARGET!r}.")

    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame = frame.dropna(subset=["date", TARGET]).sort_values("date")

    for feature in FEATURE_NAMES:
        if feature not in frame.columns:
            frame[feature] = DEFAULTS[feature]
        frame[feature] = pd.to_numeric(frame[feature], errors="coerce").fillna(DEFAULTS[feature])

    frame[TARGET] = pd.to_numeric(frame[TARGET], errors="coerce").fillna(0).clip(0, 1).astype(int)
    return frame[["date", TARGET, *FEATURE_NAMES]]


def split_time_ordered(frame: pd.DataFrame, validation_fraction: float = 0.2):
    if not 0 < validation_fraction < 0.5:
        raise ValueError("validation_fraction should be between 0 and 0.5.")

    split_index = max(1, int(len(frame) * (1 - validation_fraction)))
    train = frame.iloc[:split_index].copy()
    validation = frame.iloc[split_index:].copy()

    if validation.empty:
        raise ValueError("Not enough rows to create a validation split.")

    return train, validation
