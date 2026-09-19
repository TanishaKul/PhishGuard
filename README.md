# AI Fraud Detection

Message classification pipeline (spam / ham) built as the base model for
fraudulent-message detection. Originally developed in Google Colab.

## Contents

- `spamham_project_v2.py` — data loading, cleaning and exploratory analysis:
  - loads the `spam.csv` dataset (latin-1 encoded)
  - drops duplicates and inspects the class balance
  - plots spam vs. ham counts and message-length distributions
  - generates word clouds for the most common spam and ham terms
  - normalises text (lowercasing, URL/punctuation stripping, stop-word removal)

- `spamham_project_v3.py` — the full classification pipeline:
  - entity-preserving normalisation (URLs, phone numbers, currency and
    shortcodes become tokens instead of being stripped)
  - word (1-2) and character (3-5) n-gram TF-IDF, plus 12 handcrafted fraud
    features (uppercase ratio, urgency terms, link presence, ...)
  - stratified split and cross-validation inside a Pipeline, so the vectorizer
    never sees the test fold
  - evaluated on PR-AUC, precision and recall rather than accuracy, since the
    positive class is only ~13% of the data
  - decision threshold chosen to minimise expected cost, assuming a missed
    fraud is 10x more costly than a false alarm
  - prints top fraud indicators and a worked error analysis, saves the model

## Setup

```bash
pip install -r requirements.txt
python -c "import nltk; nltk.download('stopwords')"
```

## Usage

Place `spam.csv` beside the scripts, then:

```bash
python spamham_project_v3.py --data spam.csv
```

`spamham_project_v2.py` is the original Colab export and still reads the
dataset from Google Drive; to run it locally, drop the `google.colab` mount
lines and point the path at `spam.csv`.

## Note on the dataset

The UCI SMS Spam Collection was gathered around 2012 and is UK-centric, so
held-out scores here are optimistic relative to current SMS fraud.

## Author

Arsh (ArshPunisher)
