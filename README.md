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

Place `spam.csv` beside the scripts, then train. This writes `fraud_model.joblib`
and `model_report.json` (metrics, model comparison, threshold curve, error
analysis), which the API serves:

```bash
python spamham_project_v3.py --data spam.csv          # add --eda to regenerate the plots
```

Model selection and the decision threshold both come from 5-fold out-of-fold
predictions on the training split; the test split is only used for reporting.

`spamham_project_v2.py` is the original Colab export and still reads the
dataset from Google Drive; to run it locally, drop the `google.colab` mount
lines and point the path at `spam.csv`.

## Web app

```bash
python api_server.py --port 8000                       # Python API (binds 127.0.0.1)
cd frontend && npm install && npx next dev -p 3001     # Next.js UI
```

- `GET /api/health`, `GET /api/metrics`, `POST /api/scan` (`{"message": "...", "threshold"?: 0-1}`).
- Messages over 5,000 characters return 413, malformed input 400/415, and a
  missing model 503 with the command to train it.
- The UI has no offline mode: every score, metric and explanation comes from the
  API, and it shows the API's error if the API is down. Scan history is kept in
  the browser's localStorage.
- Point the UI at another API with `NEXT_PUBLIC_API_URL` or on the Settings page.
  Allow extra browser origins with `--allow-origin https://example.com`.

## Note on the dataset

The UCI SMS Spam Collection was gathered around 2012 and is UK-centric, so
held-out scores here are optimistic relative to current SMS fraud.

## Author

Arsh (ArshPunisher)
