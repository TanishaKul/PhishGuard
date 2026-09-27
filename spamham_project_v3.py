# -*- coding: utf-8 -*-
"""
SMS Fraud (Smishing) Detection - v3
Dataset: UCI SMS Spam Collection (spam.csv, latin-1)

Framing: spam here is treated as SMS-based fraud (smishing). The model is a
triage system - it flags messages for review, and the operating threshold is
chosen from the cost of a missed fraud vs. the cost of a false alarm.

Model selection and the threshold both come from out-of-fold predictions on
the training split; the test split is touched exactly once, for reporting.

Run:  python spamham_project_v3.py --data spam.csv [--eda]
"""

import argparse
import json
import re
import sys
from pathlib import Path

import joblib
from link_risk import LINK_RE
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from scipy.special import expit
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedGroupKFold, cross_val_predict
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.preprocessing import MaxAbsScaler
from sklearn.svm import LinearSVC

RANDOM_STATE = 42

# Cost assumption, stated explicitly so it can be argued in the writeup.
# Letting a fraud SMS through is assumed 10x worse than wrongly flagging a real one.
COST_FALSE_NEGATIVE = 10.0
COST_FALSE_POSITIVE = 1.0

# Share of real SMS traffic assumed to be fraud when picking the threshold.
# Combined training data is mostly scams, far above real traffic, so costs are
# re-weighted to this rate; 0.126 is the spam rate of the UCI corpus.
DEFAULT_PREVALENCE = 0.126

# Probability at or above which a flagged message is HIGH rather than MEDIUM risk.
HIGH_RISK_PROBABILITY = 0.70


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

    # The Kaggle export is latin-1; re-saved copies are usually UTF-8, and
    # reading those as latin-1 garbles every "£" into "Â£".
    try:
        df = pd.read_csv(path, encoding="utf-8")
    except UnicodeDecodeError:
        df = pd.read_csv(path, encoding="latin-1")

    if {"v1", "v2"}.issubset(df.columns):
        # The Kaggle export mis-quotes ~50 messages, spilling their tail after a
        # comma into unnamed columns. Stitch it back instead of dropping it.
        # A normal DataFrame export may also contain an integer "Unnamed: 0"
        # index; that column is metadata, not part of the SMS text.
        unnamed = [c for c in df.columns if str(c).startswith("Unnamed")]
        index_columns = [
            c for c in unnamed
            if str(c) == "Unnamed: 0"
            and pd.to_numeric(df[c], errors="coerce").notna().all()
        ]
        spill = [c for c in unnamed if c not in index_columns]
        if spill and df[spill].notna().any().any():
            tails = df[spill].apply(lambda r: "".join("," + str(v) for v in r if pd.notna(v)), axis=1)
            print(f"Repaired {int((tails != '').sum())} messages split across extra columns.")
            df["v2"] = df["v2"].fillna("") + tails
        df = df[["v1", "v2"]].rename(columns={"v1": "label", "v2": "message"})
    elif {"label", "message"}.issubset(df.columns):
        # data/combined.csv (build_dataset.py) also carries a source column.
        df = df[[c for c in ("label", "message", "source") if c in df.columns]]
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

SUSPICIOUS_KEYWORDS = {
    "urgency": [
        "urgent",
        "immediately",
        "act now",
        "last chance",
        "hurry",
        "expires",
        "expire"
    ],

    "account_threat": [
        "suspended",
        "blocked",
        "deactivated",
        "locked",
        "verify your account",
        "confirm your account"
    ],

    "financial": [
        "bank",
        "account",
        "payment",
        "refund",
        "cash",
        "money",
        "prize",
        "reward",
        "winner",
        "won"
    ],

    "action_request": [
        "click",
        "click here",
        "verify",
        "confirm",
        "claim",
        "login",
        "update"
    ],

    "reward_scam": [
        "free",
        "congratulations",
        "you won",
        "lucky winner",
        "guaranteed",
        "risk free"
    ]
}


def _keyword_pattern(keyword: str) -> re.Pattern:
    # Whole-word match. Apostrophes count as word characters here so that
    # "won" does not fire on "won't" and "account" not on "accountant".
    return re.compile(rf"(?<![\w']){re.escape(keyword)}(?![\w'])", re.I)


KEYWORD_PATTERNS = {
    category: [(keyword, _keyword_pattern(keyword)) for keyword in keywords]
    for category, keywords in SUSPICIOUS_KEYWORDS.items()
}


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
            sum(len(matches) for matches in detect_suspicious_keywords(msg).values()),
        ]


class TextNormalizer(BaseEstimator, TransformerMixin):
    """Stateless normalisation step so it can live inside the Pipeline."""

    def fit(self, X, y=None):
        return self

    def transform(self, X):
        return [normalize_text(str(m)) for m in X]


def template_groups(messages: pd.Series) -> pd.Series:
    """Group key for near-duplicates: one spam template sent with different numbers or links.

    Splitting on this keeps every copy of a template on the same side, so the
    test split measures new messages rather than re-sent ones.
    """
    # The 40-character prefix groups copies whose tails differ (names, amounts,
    # sign-offs); links are collapsed first so a long URL cannot eat the prefix.
    return messages.map(lambda message: normalize_text(
        LINK_RE.sub(" <url> ", str(message).lower())
    )).str[:40]


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


# --------------------------------------------------------------------------
# Evaluation
# --------------------------------------------------------------------------
def optimal_threshold(y_true, y_score, prevalence=None) -> float:
    """Pick the threshold minimising expected cost under the stated cost matrix.

    Accuracy is the wrong objective at ~13% positives; this makes the
    fraud-vs-false-alarm trade-off an explicit, defensible choice. Call it on
    out-of-fold training scores, never on the test split.

    With `prevalence`, errors are re-weighted as if fraud made up that share
    of messages, so a scam-heavy training set does not push the threshold
    down to where normal traffic drowns in false alarms.
    """
    precision, recall, thresholds = precision_recall_curve(y_true, y_score)
    n_pos = y_true.sum()
    pos_rate = n_pos / len(y_true)
    w_pos, w_neg = ((prevalence / pos_rate, (1 - prevalence) / (1 - pos_rate))
                    if prevalence is not None else (1.0, 1.0))
    best_t, best_cost = 0.5, float("inf")

    for p, r, t in zip(precision[:-1], recall[:-1], thresholds):
        tp = r * n_pos
        fn = n_pos - tp
        fp = (tp / p - tp) if p > 0 else 0.0
        cost = COST_FALSE_NEGATIVE * w_pos * fn + COST_FALSE_POSITIVE * w_neg * fp
        if cost < best_cost:
            best_cost, best_t = cost, t

    return float(best_t)


def prevalence_adjusted_cost(y_true, y_score, threshold, prevalence=None):
    """Expected misclassification cost after reweighting to target prevalence."""
    y_true = np.asarray(y_true)
    predictions = np.asarray(y_score) >= threshold
    positives = y_true == 1
    negatives = ~positives
    false_negative = int(np.sum(positives & ~predictions))
    false_positive = int(np.sum(negatives & predictions))
    positive_rate = positives.mean() if len(y_true) else 0
    if prevalence is None or positive_rate <= 0 or positive_rate >= 1:
        return COST_FALSE_NEGATIVE * false_negative + COST_FALSE_POSITIVE * false_positive
    return (
        COST_FALSE_NEGATIVE * false_negative * prevalence / positive_rate
        + COST_FALSE_POSITIVE * false_positive * (1 - prevalence) / (1 - positive_rate)
    )


def evaluate(name, model, X_test, y_test, threshold, prevalence=None):
    """Score the held-out split at a threshold fixed beforehand."""
    scores = model.predict_proba(X_test)[:, 1]
    preds = (scores >= threshold).astype(int)

    print(f"\n{'=' * 60}\n{name}  (threshold = {threshold:.4f})\n{'=' * 60}")
    print(classification_report(y_test, preds, target_names=["legit", "fraud"], digits=4))

    tn, fp, fn, tp = (int(v) for v in confusion_matrix(y_test, preds).ravel())
    raw_expected_cost = COST_FALSE_NEGATIVE * fn + COST_FALSE_POSITIVE * fp
    expected_cost = prevalence_adjusted_cost(y_test, scores, threshold, prevalence)
    metrics = {
        "prAuc": float(average_precision_score(y_test, scores)),
        "rocAuc": float(roc_auc_score(y_test, scores)),
        "precision": float(precision_score(y_test, preds, zero_division=0)),
        "recall": float(recall_score(y_test, preds)),
        "f1": float(f1_score(y_test, preds)),
        "accuracy": float(accuracy_score(y_test, preds)),
        "expectedCost": float(expected_cost),
        "rawExpectedCost": float(raw_expected_cost),
        "confusionMatrix": {"tn": tn, "fp": fp, "fn": fn, "tp": tp, "total": tn + fp + fn + tp},
    }
    print(f"Confusion: TN={tn}  FP={fp}  FN={fn}  TP={tp}")
    print(f"ROC-AUC : {metrics['rocAuc']:.4f}")
    print(f"PR-AUC  : {metrics['prAuc']:.4f}")
    print(f"Expected cost at target prevalence: {expected_cost:.1f} "
          f"(raw-count cost: {raw_expected_cost:.1f})")
    return metrics


#risk metor
def get_risk_level(probability, threshold):
    """Risk bands anchored on the operating threshold.

    Anything below the threshold is LOW, so a FRAUD verdict is never shown with
    a LOW risk label.
    """
    if probability < threshold:
        return "LOW"
    elif probability < max(HIGH_RISK_PROBABILITY, threshold):
        return "MEDIUM"
    else:
        return "HIGH"


def detect_suspicious_keywords(message):
    """Detect suspicious keywords (whole words only) and return their categories."""

    detected = {}

    for category, patterns in KEYWORD_PATTERNS.items():
        matches = [keyword for keyword, pattern in patterns if pattern.search(message)]

        if matches:
            detected[category] = matches

    return detected


def explain_prediction(message):
    """Human-readable rule-based indicators found in the message.

    These are keyword/entity rules, independent of the model's score; the
    model's own reasons come from term_contributions().
    """

    reasons = []

    detected = detect_suspicious_keywords(message)

    for category, keywords in detected.items():

        if category == "urgency":
            reasons.append(
                f"Urgency language detected: {', '.join(keywords)}"
            )

        elif category == "account_threat":
            reasons.append(
                f"Account/security warning detected: {', '.join(keywords)}"
            )

        elif category == "financial":
            reasons.append(
                f"Financial/reward-related terms detected: {', '.join(keywords)}"
            )

        elif category == "action_request":
            reasons.append(
                f"Suspicious action request detected: {', '.join(keywords)}"
            )

        elif category == "reward_scam":
            reasons.append(
                f"Prize/reward language detected: {', '.join(keywords)}"
            )

    if URL_RE.search(message):
        reasons.append("Contains a URL/link")

    if EMAIL_RE.search(message):
        reasons.append("Contains an email address")

    if PHONE_RE.search(message):
        reasons.append("Contains a phone number")

    if CURRENCY_RE.search(message):
        reasons.append("Contains currency information")

    if "!" in message:
        reasons.append("Uses exclamation marks")

    if not reasons:
        reasons.append("No major rule-based suspicious indicators detected.")

    return reasons


# --------------------------------------------------------------------------
# Model explanations
#
# Every candidate is linear in the FeatureUnion output, so the decision score
# is sum(x_i * w_i) and each product is an exact share of it.
# --------------------------------------------------------------------------
def linear_coefficients(clf):
    """Per-feature weights of a fitted classifier (fraud-positive), or None."""
    if hasattr(clf, "calibrated_classifiers_"):
        # Calibration trains one base model per fold; average their weights.
        coefs = [linear_coefficients(c.estimator) for c in clf.calibrated_classifiers_]
        return None if any(c is None for c in coefs) else np.mean(coefs, axis=0)
    if hasattr(clf, "coef_"):
        return np.asarray(clf.coef_[0]).ravel()
    if hasattr(clf, "feature_log_prob_"):
        return clf.feature_log_prob_[1] - clf.feature_log_prob_[0]
    return None


def local_effect_coefficients(clf, X):
    """Per-feature local probability effects for the message matrix ``X``.

    A calibrated ensemble averages sigmoid-transformed fold decisions. Its
    exact local derivative therefore weights each fold coefficient by that
    fold's sigmoid slope at the current message. Averaging raw coefficients
    can even reverse a feature's displayed direction.
    """
    if not hasattr(clf, "calibrated_classifiers_"):
        coefficients = linear_coefficients(clf)
        return None if coefficients is None else np.asarray(coefficients).reshape(1, -1)

    effects = None
    calibrated = clf.calibrated_classifiers_
    for classifier in calibrated:
        coefficients = linear_coefficients(classifier.estimator)
        if coefficients is None:
            return None
        decision = np.asarray(classifier.estimator.decision_function(X))
        if decision.ndim > 1:
            decision = decision[:, 1]
        calibrator = classifier.calibrators[0]
        probability = expit(calibrator.a_ * decision + calibrator.b_)
        slope = probability * (1.0 - probability)
        contribution = slope[:, None] * coefficients[None, :]
        effects = contribution if effects is None else effects + contribution
    return effects / len(calibrated)


def feature_index(pipeline):
    """(names, kinds) for every column the FeatureUnion produces, in order."""
    features = pipeline.named_steps["features"]
    word = features.transformer_list[0][1].named_steps["tfidf"].get_feature_names_out()
    char = features.transformer_list[1][1].get_feature_names_out()
    manual = HandcraftedFeatures.feature_names
    names = np.concatenate([word, [f"'{c}'" for c in char], manual])
    kinds = np.array(["word"] * len(word) + ["char"] * len(char) + ["signal"] * len(manual))
    return names, kinds


def term_contributions(pipeline, message, k=8, index=None):
    """Features that locally raised or lowered this message's fraud score."""
    names, kinds = index if index is not None else feature_index(pipeline)
    x = pipeline.named_steps["features"].transform([message]).tocsr()
    effects = local_effect_coefficients(pipeline.named_steps["clf"], x)
    if effects is None:
        return {"fraud": [], "legitimate": []}

    contrib = x.data * effects[0][x.indices]
    order = np.argsort(contrib)

    def pick(positions):
        return [
            {
                "term": str(names[x.indices[i]]),
                "kind": str(kinds[x.indices[i]]),
                "weight": round(float(contrib[i]), 4),
            }
            for i in positions
        ]

    return {
        "fraud": pick([i for i in order[::-1] if contrib[i] > 0][:k]),
        "legitimate": pick([i for i in order if contrib[i] < 0][:k]),
    }


def predict_risk(model, message, threshold):
    probability = model.predict_proba([message])[0][1]

    risk_score = probability * 100
    risk_level = get_risk_level(probability, threshold)

    prediction = "FRAUD" if probability >= threshold else "LEGITIMATE"
    reasons = explain_prediction(message)
    drivers = term_contributions(model, message, k=5)
    print("\n==============================")
    print("       SMS FRAUD DETECTOR")
    print("==============================")
    print("Message:", message)
    print("Prediction:", prediction)
    print(f"Risk Score: {risk_score:.2f}%")
    print("Risk Level:", risk_level)
    print("\nWhy was this flagged?")
    for reason in reasons:
        print("  •", reason)
    print("Model drivers toward fraud:", ", ".join(d["term"] for d in drivers["fraud"]) or "none")

    print("==============================")


def top_indicators(pipeline, X_train, y_train, k=20, private_texts=()):
    """Highest average local word-feature effects across the training messages."""
    word_branch = pipeline.named_steps["features"].transformer_list[0][1]
    names = word_branch.named_steps["tfidf"].get_feature_names_out()
    transformed = pipeline.named_steps["features"].transform(X_train).tocsr()
    effects = local_effect_coefficients(pipeline.named_steps["clf"], transformed)
    if effects is None:
        return []
    word_coefs = np.asarray(effects[:, :len(names)]).mean(axis=0)
    private_tokens = {
        token for text in private_texts for token in normalize_text(str(text)).split()
    }
    ranked = np.argsort(word_coefs)[::-1]
    # Never fall back to private-derived terms: a smaller public indicator list
    # is preferable to disclosing vocabulary learned from user feedback.
    order = np.asarray([i for i in ranked if str(names[i]) not in private_tokens], dtype=int)

    print(f"\nTop {k} fraud indicators:")
    print("  " + ", ".join(names[i] for i in order[:k]))
    print(f"Top {k} legitimate indicators:")
    print("  " + ", ".join(names[i] for i in order[-k:]))

    # How many training messages of each class contain the term.
    present = word_branch.transform(X_train) > 0
    y = np.asarray(y_train)
    fraud_docs = np.asarray(present[y == 1].sum(axis=0)).ravel()
    legit_docs = np.asarray(present[y == 0].sum(axis=0)).ravel()

    def row(i, kind):
        return {"term": str(names[i]), "weight": round(float(word_coefs[i]), 4), "type": kind,
                "fraudDocs": int(fraud_docs[i]), "legitDocs": int(legit_docs[i])}

    return [row(i, "fraud") for i in order[:k]] + [row(i, "legitimate") for i in order[::-1][:k]]


def threshold_curve(y_true, y_score):
    """Test-split confusion counts across a grid of thresholds, for the simulator."""
    y_true = np.asarray(y_true)
    curve = []
    for t in np.round(np.arange(0.01, 0.991, 0.01), 2):
        pred = y_score >= t
        curve.append({
            "threshold": float(t),
            "tp": int(np.sum(pred & (y_true == 1))),
            "fp": int(np.sum(pred & (y_true == 0))),
            "fn": int(np.sum(~pred & (y_true == 1))),
            "tn": int(np.sum(~pred & (y_true == 0))),
        })
    return curve


def per_source_metrics(model, X_test, y_test, sources, threshold):
    """Fraud recall and false-alarm rate for each data source in the test split."""
    flagged = model.predict_proba(X_test)[:, 1] >= threshold
    y = np.asarray(y_test)
    rows = []
    for source in sorted(set(sources)):
        mask = np.asarray(sources) == source
        fraud, legit = mask & (y == 1), mask & (y == 0)
        rows.append({
            "source": source,
            "fraudCount": int(fraud.sum()),
            "recall": float(flagged[fraud].mean()) if fraud.any() else None,
            "legitCount": int(legit.sum()),
            "falseAlarmRate": float(flagged[legit].mean()) if legit.any() else None,
        })
        print(f"  {source:10s} fraud {int(fraud.sum()):5d} recall "
              f"{rows[-1]['recall'] if rows[-1]['recall'] is not None else float('nan'):.3f}   "
              f"legit {int(legit.sum()):5d} false alarms "
              f"{rows[-1]['falseAlarmRate'] if rows[-1]['falseAlarmRate'] is not None else float('nan'):.3f}")
    return rows


def error_analysis(messages, y_test, model, threshold, n=10, sources=None):
    """What the model gets wrong on the held-out split — judges ask this every single time."""
    scores = model.predict_proba(messages)[:, 1]
    preds = (scores >= threshold).astype(int)

    fn_idx = np.where((y_test == 1) & (preds == 0))[0]
    fp_idx = np.where((y_test == 0) & (preds == 1))[0]
    index = feature_index(model)

    source_values = ["public"] * len(messages) if sources is None else list(sources)
    private_sources = {"user", "feedback"}

    def item(i, actual, predicted):
        drivers = term_contributions(model, messages[i], k=4, index=index)
        source = source_values[i]
        return {
            "message": ("[redacted private feedback message]"
                        if source in private_sources else messages[i]),
            "source": source,
            "score": round(float(scores[i]), 4),
            "actual": actual,
            "predicted": predicted,
            "fraudDrivers": drivers["fraud"],
            "legitimateDrivers": drivers["legitimate"],
        }

    print(f"\nMissed fraud ({len(fn_idx)} total), worst {min(n, len(fn_idx))}:")
    missed = fn_idx[np.argsort(scores[fn_idx])][:n]
    for i in missed:
        print(f"  [{scores[i]:.3f}] {messages[i][:110]}")

    print(f"\nFalse alarms ({len(fp_idx)} total), worst {min(n, len(fp_idx))}:")
    alarms = fp_idx[np.argsort(-scores[fp_idx])][:n]
    for i in alarms:
        print(f"  [{scores[i]:.3f}] {messages[i][:110]}")

    return {
        "falseNegativesCount": int(len(fn_idx)),
        "falsePositivesCount": int(len(fp_idx)),
        "falseNegatives": [item(i, "FRAUD", "LEGITIMATE") for i in missed],
        "falsePositives": [item(i, "LEGITIMATE", "FRAUD") for i in alarms],
    }


# --------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="SMS fraud detection")
    parser.add_argument("--data", type=Path, default=Path("spam.csv"))
    parser.add_argument("--out", type=Path, default=Path("fraud_model.joblib"))
    parser.add_argument("--prevalence", type=float, default=DEFAULT_PREVALENCE,
                        help="share of real traffic assumed to be fraud when picking the threshold")
    parser.add_argument("--eda", action="store_true",
                        help="also regenerate the EDA plots beside the output model")
    args = parser.parse_args()
    if not 0 < args.prevalence < 1:
        print(f"error: --prevalence must be between 0 and 1; got {args.prevalence}", file=sys.stderr)
        return 1

    try:
        df = load_data(args.data)
    except (FileNotFoundError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.eda:
        from eda import run_eda
        run_eda(args.data, output_dir=args.out.parent)

    # One fold of a 5-way stratified group split = a ~20% test set with no
    # template shared with training.
    groups = template_groups(df["message"])
    splitter = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    train_idx, test_idx = next(splitter.split(df["message"], df["target"], groups))
    X_train, X_test = df["message"].iloc[train_idx], df["message"].iloc[test_idx]
    y_train, y_test = df["target"].iloc[train_idx], df["target"].iloc[test_idx]
    groups_train = groups.iloc[train_idx]
    sources_train = (df["source"].iloc[train_idx] if "source" in df.columns
                     else pd.Series([args.data.stem] * len(train_idx), index=X_train.index))
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

    cv = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    results = []

    for name, clf in candidates.items():
        pipe = Pipeline([("features", build_features()), ("clf", clf)])

        # Out-of-fold scores on the training split only — the vectorizer is
        # refit inside each fold, and both the model choice and the threshold
        # come from these, so the test split never influences a decision.
        oof = cross_val_predict(pipe, X_train, y_train, groups=groups_train, cv=cv,
                                method="predict_proba")[:, 1]
        cv_pr_auc = float(average_precision_score(y_train, oof))
        threshold = optimal_threshold(y_train.to_numpy(), oof, args.prevalence)
        cv_cost = prevalence_adjusted_cost(y_train.to_numpy(), oof, threshold, args.prevalence)
        print(f"\n{name}: CV PR-AUC {cv_pr_auc:.4f}, target-prevalence cost {cv_cost:.1f}, "
              f"cost-optimal threshold {threshold:.4f}")

        pipe.fit(X_train, y_train)
        results.append({
            "name": name,
            "model": pipe,
            "threshold": threshold,
            "cvPrAuc": cv_pr_auc,
            "cvExpectedCost": cv_cost,
            "test": evaluate(name, pipe, X_test, y_test, threshold, args.prevalence),
        })

    best = min(results, key=lambda r: (r["cvExpectedCost"], -r["cvPrAuc"]))
    print(f"\n>>> Best model by target-prevalence CV cost: {best['name']} "
          f"(cost {best['cvExpectedCost']:.1f}, PR-AUC {best['cvPrAuc']:.4f})")


    predict_risk(
    best["model"],
    "URGENT! Your account has been blocked. Click here to verify immediately.",
    best["threshold"]
)

    predict_risk(
    best["model"],
    "Congratulations! You won a free prize. Click this link to claim.",
    best["threshold"]
)

    predict_risk(
    best["model"],
    "Hey, are we still meeting at 6 pm today?",
    best["threshold"]
)

    sources_test = (df["source"].iloc[test_idx].tolist() if "source" in df.columns
                    else [args.data.stem] * len(test_idx))
    print("\nPer-source results on the test split:")
    by_source = per_source_metrics(best["model"], X_test, y_test, sources_test, best["threshold"])

    report = {
        "dataset": str(args.data.name),
        "bySource": by_source,
        "metrics": {
            "modelName": best["name"],
            "threshold": best["threshold"],
            **best["test"],
            "costFnWeight": COST_FALSE_NEGATIVE,
            "costFpWeight": COST_FALSE_POSITIVE,
            "assumedPrevalence": args.prevalence,
            "trainSamples": int(len(X_train)),
            "testSamples": int(len(X_test)),
            "fraudRateTrain": float(y_train.mean()),
            "fraudRateTest": float(y_test.mean()),
        },
        "comparisons": [
            {
                "name": r["name"],
                "cvPrAuc": r["cvPrAuc"],
                "cvExpectedCost": r["cvExpectedCost"],
                "threshold": r["threshold"],
                "testPrAuc": r["test"]["prAuc"],
                "testRocAuc": r["test"]["rocAuc"],
                "precision": r["test"]["precision"],
                "recall": r["test"]["recall"],
                "f1": r["test"]["f1"],
                "expectedCost": r["test"]["expectedCost"],
                "isBest": r is best,
            }
            for r in results
        ],
        "thresholdCurve": threshold_curve(y_test, best["model"].predict_proba(X_test)[:, 1]),
        "topIndicators": top_indicators(
            best["model"], X_train, y_train,
            private_texts=X_train[sources_train.isin({"user", "feedback"})].tolist(),
        ),
        "indicatorMethod": "average_local_probability_effect",
        "selectionMethod": "target_prevalence_cv_cost",
        "errorAnalysis": error_analysis(
            X_test.tolist(), y_test.to_numpy(), best["model"], best["threshold"],
            sources=sources_test,
        ),
        "keywordCategories": SUSPICIOUS_KEYWORDS,
    }

    joblib.dump(
        {"pipeline": best["model"], "threshold": best["threshold"],
         "model_name": best["name"], "report": report},
        args.out,
    )
    report_path = args.out.with_name("model_report.json")
    report_path.write_text(json.dumps(report, indent=2))
    print(f"\nSaved {args.out} and {report_path}")
    return 0


if __name__ == "__main__":
    # Run through the importable module rather than __main__, so the pickled
    # TextNormalizer/HandcraftedFeatures reference `spamham_project_v3.*` and
    # the model loads from any script without patching __main__.
    import spamham_project_v3
    sys.exit(spamham_project_v3.main())
