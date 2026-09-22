# -*- coding: utf-8 -*-
"""
Turn user feedback ("this result was wrong/right") into training data.

    DATABASE_URL=postgresql://localhost/phishguard python export_feedback.py

Writes data/raw/feedback_messages.csv (replacing it each run), with personal
details scrubbed the same way as scrub_messages.py. build_dataset.py picks
it up on its next run.
"""

import argparse
import sys
from pathlib import Path

import pandas as pd
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from db import Database, Feedback, Scan
from scrub_messages import scrub

OUT = Path("data/raw/feedback_messages.csv")


def main():
    parser = argparse.ArgumentParser(description="Export scan feedback as training data")
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()

    db = Database()
    try:
        with db.sessionmaker() as session:
            rows = session.execute(
                select(Scan.message, Feedback.correct_label).join(Feedback, Feedback.scan_id == Scan.id)
            ).all()
    except SQLAlchemyError as exc:
        print(f"error: could not read feedback from {db.url.split('@')[-1]}: {exc}", file=sys.stderr)
        return 1

    df = pd.DataFrame(rows, columns=["message", "correct_label"])
    df = pd.DataFrame({
        "label": df["correct_label"].map({"fraud": "spam", "legit": "ham"}),
        "message": df["message"].map(scrub),
    })
    args.out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False)
    print(f"Wrote {len(df)} messages ({df['label'].value_counts().to_dict()}) to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
