# -*- coding: utf-8 -*-
"""
Prepare your own SMS messages for training: removes personal details and
writes data/raw/user_messages.csv, which build_dataset.py picks up.

    python scrub_messages.py inbox.txt --label ham      # one message per line
    python scrub_messages.py scams.csv --label spam      # CSV with a text/message/body column
    python scrub_messages.py mixed.csv                   # CSV that already has a label column

Labels: ham = legitimate, spam = scam/fraud. Rows are appended to the output
file, so run it once per source file.

What gets replaced (with random values of the same shape, so an OTP still
looks like an OTP): digit runs (codes, account and phone numbers, amounts
keep their currency sign), email addresses, and the path/query of links
(the domain is kept, because it matters for fraud detection).

Names, addresses and other free text cannot be detected reliably, so the
script prints every scrubbed message: read them before training.
"""

import argparse
import csv
import random
import re
import sys
from pathlib import Path

import pandas as pd

OUT = Path("data/raw/user_messages.csv")
TEXT_COLUMNS = ("message", "text", "body", "sms", "content")
LABELS = {"ham": "ham", "legit": "ham", "legitimate": "ham", "0": "ham",
          "spam": "spam", "scam": "spam", "fraud": "spam", "smishing": "spam", "1": "spam"}

EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b")
LINK_RE = re.compile(r"\b((?:https?://)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(/[^\s]*)?", re.I)
DIGITS_RE = re.compile(r"\d")

_rng = random.Random()


def scrub(text: str) -> str:
    text = EMAIL_RE.sub(lambda m: f"user{_rng.randint(100, 999)}@example.com", text)
    # Keep the domain, drop the path (it often carries a personal token).
    text = LINK_RE.sub(lambda m: m.group(1) + ("/xxxx" if m.group(2) else ""), text)
    return DIGITS_RE.sub(lambda m: str(_rng.randint(0, 9)), text)


def read_messages(path: Path, label: str | None) -> pd.DataFrame:
    if path.suffix.lower() == ".csv":
        df = pd.read_csv(path, dtype=str)
        cols = {c.lower(): c for c in df.columns}
        text_col = next((cols[c] for c in TEXT_COLUMNS if c in cols), None)
        if text_col is None:
            raise ValueError(f"{path}: no text column; expected one of {TEXT_COLUMNS}, got {list(df.columns)}")
        if label is None:
            if "label" not in cols:
                raise ValueError(f"{path}: no 'label' column; pass --label ham or --label spam")
            labels = df[cols["label"]].astype(str).str.strip().str.lower().map(LABELS)
            bad = df[cols["label"]][labels.isna()].unique()
            if len(bad):
                raise ValueError(f"{path}: unknown labels {list(bad)[:5]}; use ham or spam")
        else:
            labels = pd.Series(label, index=df.index)
        return pd.DataFrame({"label": labels, "message": df[text_col]})

    if label is None:
        raise ValueError("Text files have no labels; pass --label ham or --label spam")
    lines = path.read_text(encoding="utf-8").splitlines()
    return pd.DataFrame({"label": label, "message": lines})


def main():
    parser = argparse.ArgumentParser(description="Scrub personal details from SMS messages for training")
    parser.add_argument("input", type=Path)
    parser.add_argument("--label", choices=sorted(set(LABELS)), help="label for every message in the file")
    parser.add_argument("--out", type=Path, default=OUT)
    parser.add_argument("--quiet", action="store_true", help="do not print scrubbed messages")
    args = parser.parse_args()

    try:
        df = read_messages(args.input, LABELS[args.label] if args.label else None)
    except (OSError, ValueError, UnicodeDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    df["message"] = df["message"].fillna("").astype(str).str.strip()
    df = df[df["message"].str.len() >= 5]
    df["message"] = df["message"].map(scrub)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    new_file = not args.out.exists()
    df.to_csv(args.out, mode="a", header=new_file, index=False, quoting=csv.QUOTE_MINIMAL)

    if not args.quiet:
        for _, row in df.iterrows():
            print(f"[{row['label']}] {row['message']}")
    print(f"\nAdded {len(df)} messages ({df['label'].value_counts().to_dict()}) to {args.out}."
          f"\nCheck the lines above for names or addresses before training.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
