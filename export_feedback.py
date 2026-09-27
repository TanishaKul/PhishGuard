# -*- coding: utf-8 -*-
"""
Turn reviewed user feedback ("this result was wrong/right") into training data.
Because feedback is untrusted, the command requires an explicit acknowledgement.

    DATABASE_URL=postgresql://localhost/phishguard \
        python export_feedback.py --include-unreviewed --seed 42

Writes data/raw/feedback_messages.csv (replacing it each run), with personal
details scrubbed the same way as scrub_messages.py. build_dataset.py picks
it up on its next run.
"""

import argparse
import random
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
    parser.add_argument("--seed", type=int, default=42,
                        help="stable scrub seed so repeated reviewed exports are reproducible")
    parser.add_argument(
        "--include-unreviewed", action="store_true",
        help="confirm that all feedback has been manually reviewed for poisoning and residual personal data",
    )
    args = parser.parse_args()
    if not args.include_unreviewed:
        print("error: feedback is untrusted until reviewed; pass --include-unreviewed only after review",
              file=sys.stderr)
        return 2

    db = Database()
    try:
        with db.sessionmaker() as session:
            rows = session.execute(
                select(Scan.id, Scan.message, Feedback.correct_label, Feedback.created_at)
                .join(Feedback, Feedback.scan_id == Scan.id)
                .order_by(Feedback.created_at.desc())
            ).all()
    except SQLAlchemyError as exc:
        print(f"error: could not read feedback from {db.url.split('@')[-1]}: {exc}", file=sys.stderr)
        return 1

    df = pd.DataFrame(rows, columns=["scan_id", "message", "correct_label", "reviewed_at"])
    scrub_rng = random.Random(args.seed)
    df = pd.DataFrame({
        "label": df["correct_label"].map({"fraud": "spam", "legit": "ham"}),
        "message": df["message"].map(lambda message: scrub(message, scrub_rng)),
        # Retained for human review/audit; build_dataset ignores extra columns.
        "source_scan_id": "scan-" + df["scan_id"].astype(str),
        "reviewed_at": df["reviewed_at"].astype(str),
    })
    args.out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False)
    print(f"Wrote {len(df)} messages ({df['label'].value_counts().to_dict()}) to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
