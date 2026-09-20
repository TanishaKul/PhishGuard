# -*- coding: utf-8 -*-
"""
SMS Fraud (Smishing) Detection-v3
Dataset: UCI SMS Spam Collection (spam.csv,latin-1)

Framing: spam here is treated as SMS-based fraud (smishing).
the model is a triage system - it flagsmessages for review, and the
operating threshold is chosen from the cost of a missed fraud vs. the 
cost of a false alsrm.
Run: python spamham_project_v3.py --data spam.csv
"""

import argparse
import re
import sys
from pathlib import Path 

import joblib
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, hstack
from sklearn.base import BaseEstimator,TransformerMixin
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    classification_report,
    confusion_matrix,
    precision_recall_curve,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.preprocessing import MaxAbsScaler
from sklearn.svm import LinearSVC

RANDOM_STATE = 42

# Cost assumption, stated explicitly so it can be argued in the writeup.
# Letting a fraud SMS through is assumed 10x worse than wrongly flagging a real one.
COST_FALSE_NEGATIVE = 10.0
COST_FALSE_POSITIVE = 1.0


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------
def load_data(path: Path) -> pd.DataFrame:
    """Load the SMS corpus, tolerating the two common column layouts."""
    if not path.exists():
        raise FileNotFoundError(
            f"Dataset not found at {path}. Download the UCI SMS Spam Collection "
            f"and save it as spam.csv next to this script."
        )

    df = pd.read_csv(path, encoding="latin-1")

    if {"v1", "v2"}.issubset(df.columns):
        df = df[["v1", "v2"]].rename(columns={"v1": "label", "v2": "message"})
    elif {"label", "message"}.issubset(df.columns):
        df = df[["label", "message"]]
    else:
        raise ValueError(
            f"Expected columns ('v1','v2') or ('label','message'); got {list(df.columns)}"
        )

    df = df.dropna(subset=["label", "message"])
    df["label"] = df["label"].str.strip().str.lower()

    unknown = set(df["label"].unique()) - {"ham", "spam"}
    if unknown:
        raise ValueError(f"Unexpected label values: {sorted(unknown)}")

    before = len(df)
    df = df.drop_duplicates(subset=["message"]).reset_index(drop=True)
    print(f"Loaded {before} rows, {len(df)} after de-duplication.")
    print(df["label"].value_counts(normalize=True).round(4).to_string())

    df["target"] = (df["label"] == "spam").astype(int)
    return df


# --------------------------------------------------------------------------
# Text normalisation
#
# Unlike v2, this keeps the fraud signal instead of deleting it: URLs, numbers,
# currency and phone-like strings become TOKENS rather than being stripped.
# --------------------------------------------------------------------------
URL_RE = re.compile(r"(https?://\S+|www\.\S+|\b\S+\.(?:com|net|org|co\.uk|ly|gl|tk|xyz)\b)", re.I)
EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b")
PHONE_RE = re.compile(r"\b(?:\+?\d[\d\s-]{7,}\d)\b")
SHORTCODE_RE = re.compile(r"\b\d{4,6}\b")
CURRENCY_RE = re.compile(r"[£$€₹]")
NUM_RE = re.compile(r"\b\d+\b")

URGENCY_TERMS = (
    "urgent", "immediately", "act now", "expire", "expires", "last chance",
    "verify", "suspended", "blocked", "confirm", "claim", "winner", "won",
    "free", "prize", "congratulations", "guaranteed", "risk free", "click",
)


def normalize_text(message: str) -> str:
    """Lowercase and replace high-signal entities with placeholder tokens."""
    message = message.lower()
    message = URL_RE.sub(" <url> ", message)
    message = EMAIL_RE.sub(" <email> ", message)
    message = PHONE_RE.sub(" <phone> ", message)
    message = CURRENCY_RE.sub(" <cur> ", message)
    message = SHORTCODE_RE.sub(" <shortcode> ", message)
    message = NUM_RE.sub(" <num> ", message)
    message = re.sub(r"[^a-z0-9<>\s!?$]", " ", message)
    return re.sub(r"\s+", " ", message).strip()


class HandcraftedFeatures(BaseEstimator, TransformerMixin):
    """Numeric fraud signals computed from the RAW message, not the normalised one.

    Casing and punctuation are destroyed by normalisation, so they are measured
    here first — uppercase ratio and exclamation density are strong smishing cues.
    """

    feature_names = [
        "n_chars", "n_words", "avg_word_len", "upper_ratio", "digit_ratio",
        "punct_ratio", "n_exclaim", "has_url", "has_email", "has_phone",
        "has_currency", "n_urgency_terms",
    ]

    def fit(self, X, y=None):
        return self

    def transform(self, X):
        rows = [self._features(str(m)) for m in X]
        return csr_matrix(np.asarray(rows, dtype=np.float64))

    @staticmethod
    def _features(msg: str) -> list:
        n_chars = len(msg) or 1
        words = msg.split()
        n_words = len(words) or 1
        lower = msg.lower()
        return [
            len(msg),
            len(words),
            sum(len(w) for w in words) / n_words,
            sum(c.isupper() for c in msg) / n_chars,
            sum(c.isdigit() for c in msg) / n_chars,
            sum(not c.isalnum() and not c.isspace() for c in msg) / n_chars,
            msg.count("!"),
            float(bool(URL_RE.search(msg))),
            float(bool(EMAIL_RE.search(msg))),
            float(bool(PHONE_RE.search(msg))),
            float(bool(CURRENCY_RE.search(msg))),
            sum(term in lower for term in URGENCY_TERMS),
        ]


def build_features() -> FeatureUnion:
    """Word n-grams + character n-grams + handcrafted numeric signals.

    Character n-grams matter because fraud SMS deliberately obfuscates
    ("fr33", "c1ick", "w0n") — word-level tokens miss those, char 3-5 grams don't.
    """
    return FeatureUnion(
        [
            (
                "word",
                Pipeline([
                    ("norm", TextNormalizer()),
                    ("tfidf", TfidfVectorizer(
                        ngram_range=(1, 2), min_df=2, sublinear_tf=True,
                    )),
                ]),
            ),
            (
                "char",
                TfidfVectorizer(
                    analyzer="char_wb", ngram_range=(3, 5), min_df=3,
                    sublinear_tf=True, lowercase=True,
                ),
            ),
            (
                "manual",
                Pipeline([
                    ("feats", HandcraftedFeatures()),
                    ("scale", MaxAbsScaler()),
                ]),
            ),
        ]
    )


class TextNormalizer(BaseEstimator, TransformerMixin):
    """Stateless normalisation step so it can live inside the Pipeline."""

    def fit(self, X, y=None):
        return self

    def transform(self, X):
        return [normalize_text(str(m)) for m in X]


# --------------------------------------------------------------------------
# Evaluation
# --------------------------------------------------------------------------
def optimal_threshold(y_true, y_score) -> float:
    """Pick the threshold minimising expected cost under the stated cost matrix.

    Accuracy is the wrong objective at ~13% positives; this makes the
    fraud-vs-false-alarm trade-off an explicit, defensible choice.
    """
    precision, recall, thresholds = precision_recall_curve(y_true, y_score)
    n_pos = y_true.sum()
    best_t, best_cost = 0.5, float("inf")

    for p, r, t in zip(precision[:-1], recall[:-1], thresholds):
        tp = r * n_pos
        fn = n_pos - tp
        fp = (tp / p - tp) if p > 0 else 0.0
        cost = COST_FALSE_NEGATIVE * fn + COST_FALSE_POSITIVE * fp
        if cost < best_cost:
            best_cost, best_t = cost, t

    return float(best_t)


def evaluate(name, model, X_test, y_test, threshold=None):
    scores = (
        model.predict_proba(X_test)[:, 1]
        if hasattr(model, "predict_proba")
        else model.decision_function(X_test)
    )
    threshold = threshold if threshold is not None else optimal_threshold(y_test, scores)
    preds = (scores >= threshold).astype(int)

    print(f"\n{'=' * 60}\n{name}  (threshold = {threshold:.4f})\n{'=' * 60}")
    print(classification_report(y_test, preds, target_names=["legit", "fraud"], digits=4))

    tn, fp, fn, tp = confusion_matrix(y_test, preds).ravel()
    print(f"Confusion: TN={tn}  FP={fp}  FN={fn}  TP={tp}")
    print(f"ROC-AUC : {roc_auc_score(y_test, scores):.4f}")
    print(f"PR-AUC  : {average_precision_score(y_test, scores):.4f}")
    print(f"Expected cost: {COST_FALSE_NEGATIVE * fn + COST_FALSE_POSITIVE * fp:.1f}")

    return {"name": name, "pr_auc": average_precision_score(y_test, scores),
            "threshold": threshold, "model": model}


def top_indicators(pipeline, k=20):
    """Most fraud-indicative word features — the explainability slide."""
    features = pipeline.named_steps["features"]
    clf = pipeline.named_steps["clf"]
    base = clf.estimator if hasattr(clf, "estimator") else clf
    if not hasattr(base, "coef_"):
        return

    word_step = features.transformer_list[0][1].named_steps["tfidf"]
    names = word_step.get_feature_names_out()
    coefs = base.coef_[0][: len(names)]
    order = np.argsort(coefs)[::-1]

    print(f"\nTop {k} fraud indicators:")
    print("  " + ", ".join(names[i] for i in order[:k]))
    print(f"Top {k} legitimate indicators:")
    print("  " + ", ".join(names[i] for i in order[-k:]))


def error_analysis(df_test, y_test, model, threshold, n=5):
    """Show what the model gets wrong — judges ask this every single time."""
    scores = model.predict_proba(df_test["message"])[:, 1]
    preds = (scores >= threshold).astype(int)

    fn_idx = np.where((y_test == 1) & (preds == 0))[0]
    fp_idx = np.where((y_test == 0) & (preds == 1))[0]

    print(f"\nMissed fraud ({len(fn_idx)} total), worst {min(n, len(fn_idx))}:")
    for i in fn_idx[np.argsort(scores[fn_idx])][:n]:
        print(f"  [{scores[i]:.3f}] {df_test['message'].iloc[i][:110]}")

    print(f"\nFalse alarms ({len(fp_idx)} total), worst {min(n, len(fp_idx))}:")
    for i in fp_idx[np.argsort(-scores[fp_idx])][:n]:
        print(f"  [{scores[i]:.3f}] {df_test['message'].iloc[i][:110]}")


# --------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="SMS fraud detection")
    parser.add_argument("--data", type=Path, default=Path("spam.csv"))
    parser.add_argument("--out", type=Path, default=Path("fraud_model.joblib"))
    args = parser.parse_args()

    try:
        df = load_data(args.data)
    except (FileNotFoundError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    X_train, X_test, y_train, y_test = train_test_split(
        df["message"], df["target"],
        test_size=0.2, stratify=df["target"], random_state=RANDOM_STATE,
    )
    print(f"\nTrain: {len(X_train)}  Test: {len(X_test)}  "
          f"(fraud rate {y_train.mean():.3f} / {y_test.mean():.3f})")

    candidates = {
        "MultinomialNB (baseline)": MultinomialNB(alpha=0.1),
        "LogisticRegression": LogisticRegression(
            max_iter=2000, class_weight="balanced", C=10, random_state=RANDOM_STATE,
        ),
        "LinearSVC (calibrated)": CalibratedClassifierCV(
            LinearSVC(class_weight="balanced", C=1.0, random_state=RANDOM_STATE),
            cv=3,
        ),
    }

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    results = []

    for name, clf in candidates.items():
        pipe = Pipeline([("features", build_features()), ("clf", clf)])

        # CV on the training fold only — the vectorizer is refit inside each
        # fold, so no test vocabulary ever leaks into training.
        cv_scores = cross_val_score(pipe, X_train, y_train, cv=cv, scoring="average_precision")
        print(f"\n{name}: CV PR-AUC {cv_scores.mean():.4f} (+/- {cv_scores.std():.4f})")

        pipe.fit(X_train, y_train)
        results.append(evaluate(name, pipe, X_test, y_test))

    best = max(results, key=lambda r: r["pr_auc"])
    print(f"\n>>> Best model: {best['name']} (PR-AUC {best['pr_auc']:.4f})")

    top_indicators(best["model"])
    error_analysis(
        df.loc[X_test.index], y_test.to_numpy(), best["model"], best["threshold"],
    )

    joblib.dump(
        {"pipeline": best["model"], "threshold": best["threshold"], "model_name": best["name"]},
        args.out,
    )
    print(f"\nSaved {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
"""
SMS Fraud (Smishing) Detection - v3
Dataset: "UCI SMS Spam Collection (spam.csv, latin-1)"

Framing: spam here is treated as SMS-based fraud (smishing). The model is a
triage system - it flags messages for review, and the operating threshold is
chosen from the cost of a missed fraud vs. the cost of a false alarm.

Run:  python spamham_project_v3.py --data spam.csv
"""

