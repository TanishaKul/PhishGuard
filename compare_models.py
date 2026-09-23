# -*- coding: utf-8 -*-
"""
Compare trained models on the same held-out messages.

    python compare_models.py fraud_model.joblib fraud_model_combined.joblib

Uses the template-grouped test split of --data (the same split training
uses), and reports per source: fraud caught and normal messages flagged.
eval/probes.csv holds a few hand-written modern examples; they are a quick
sanity check, not a benchmark.
"""

import argparse
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedGroupKFold

import spamham_project_v3 as sp


def test_split(data: Path) -> pd.DataFrame:
    df = sp.load_data(data)
    if "source" not in df.columns:
        df["source"] = data.stem
    groups = sp.template_groups(df["message"])
    splitter = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=sp.RANDOM_STATE)
    _, test_idx = next(splitter.split(df["message"], df["target"], groups))
    return df.iloc[test_idx]


def main():
    parser = argparse.ArgumentParser(description="Compare fraud models on the same test split")
    parser.add_argument("models", nargs="+", type=Path)
    parser.add_argument("--data", type=Path, default=Path("data/combined.csv"))
    parser.add_argument("--probes", type=Path, default=Path("eval/probes.csv"))
    args = parser.parse_args()

    try:
        models = {}
        for path in args.models:
            if path.name in models:
                raise ValueError(f"duplicate model filename: {path.name}")
            models[path.name] = joblib.load(path)
        test = test_split(args.data)
    except (OSError, ValueError, KeyError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print(f"\nTest split of {args.data}: {len(test)} messages "
          "(a model trained on this file never saw them; older models may have).\n")
    y = test["target"].to_numpy()
    rows = []
    for name, m in models.items():
        flagged = m["pipeline"].predict_proba(test["message"])[:, 1] >= m["threshold"]
        for source in sorted(test["source"].unique()):
            mask = (test["source"] == source).to_numpy()
            fraud, legit = mask & (y == 1), mask & (y == 0)
            rows.append({
                "model": name, "source": source,
                "fraud caught": f"{flagged[fraud].mean():.1%} of {fraud.sum()}" if fraud.any() else "-",
                "normal flagged": f"{flagged[legit].mean():.1%} of {legit.sum()}" if legit.any() else "-",
            })
    print(pd.DataFrame(rows).to_string(index=False))

    if args.probes.exists():
        probes = pd.read_csv(args.probes)
        print(f"\nProbes ({args.probes}):")
        table = probes[["label", "kind"]].copy()
        for name, m in models.items():
            p = m["pipeline"].predict_proba(probes["message"])[:, 1]
            verdict = np.where(p >= m["threshold"], "FRAUD", "legit")
            ok = (verdict == "FRAUD") == (probes["label"] == "spam")
            table[name] = [f"{v} {s:.2f}{'' if good else '  WRONG'}" for v, s, good in zip(verdict, p, ok)]
        print(table.to_string(index=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
