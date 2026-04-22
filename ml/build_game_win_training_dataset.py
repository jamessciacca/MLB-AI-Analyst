"""Create a starter CSV schema for historical game-win model training.

This intentionally does not scrape postgame box score features. Use this as the
landing file for a pregame feature assembly job, then train with:

    python ml/train_game_win_model.py --input data/game_win_training.csv
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

from game_win_features import FEATURE_NAMES, TARGET


BASE_COLUMNS = [
    "game_id",
    "date",
    "away_team",
    "home_team",
    "away_probable_starter",
    "home_probable_starter",
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="data/game_win_training.csv")
    args = parser.parse_args()

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with output_path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow([*BASE_COLUMNS, *FEATURE_NAMES, TARGET])

    print(f"Wrote empty training schema to {output_path}")
    print("Populate rows with pregame-known features only; target is 1 for home win, 0 for away win.")


if __name__ == "__main__":
    main()
