"""Feature preparation for the MLB 1+ hit model.

The training target is binary: 1 if the hitter recorded at least one hit in
that game, 0 otherwise. Every feature in this module is expected to be known
before first pitch. The model intentionally rejects columns that look like
same-game outcomes unless they are the explicit target column.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

import pandas as pd

CONFIG_PATH = Path(__file__).with_name("model_config.json")
CONFIG = json.loads(CONFIG_PATH.read_text())
FEATURE_NAMES: list[str] = CONFIG["featureNames"]
DEFAULTS: dict[str, float] = CONFIG["defaults"]
TARGET = CONFIG["target"]

LEAKAGE_COLUMN_HINTS = {
    "game_hits",
    "postgame",
    "actual_hits",
    "result_hits",
    "same_game_hits",
    "boxscore_hits",
}


def assert_no_leakage_columns(columns: Iterable[str]) -> None:
    """Fail fast if a training file includes suspicious postgame feature names."""

    leaked = [
        column
        for column in columns
        if column != TARGET and any(hint in column.lower() for hint in LEAKAGE_COLUMN_HINTS)
    ]
    if leaked:
        raise ValueError(f"Potential leakage columns found: {', '.join(leaked)}")


def prepare_training_frame(path: str | Path) -> pd.DataFrame:
    """Load a player-game CSV and return a clean model frame.

    Required columns:
    - date: sortable game date used for time-based train/validation split
    - has_hit: 1 if hitter got 1+ hit, else 0

    Feature columns may be missing while the data pipeline matures. Missing
    features are filled with documented league-average defaults from
    ml/model_config.json.
    """

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
    """Use older games for training and newer games for validation."""

    if not 0 < validation_fraction < 0.5:
        raise ValueError("validation_fraction should be between 0 and 0.5.")

    split_index = max(1, int(len(frame) * (1 - validation_fraction)))
    train = frame.iloc[:split_index].copy()
    validation = frame.iloc[split_index:].copy()

    if validation.empty:
        raise ValueError("Not enough rows to create a validation split.")

    return train, validation
