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

```bash
pip install -r requirements-dev.txt
python -c "import nltk; nltk.download('stopwords')"
```

### Train

On the UCI corpus alone (place `spam.csv` in the repo root):

```bash
python spamham_project_v3.py --data spam.csv          # add --eda to regenerate the plots
```

On UCI plus recent public smishing datasets (IMC25, NCSU, Mendeley; add
`data/raw/smishtank.csv` yourself if you want Smishtank, which is
non-commercial only):

```bash
python build_dataset.py --download                    # writes data/combined.csv
python spamham_project_v3.py --data data/combined.csv --out fraud_model_combined.joblib
```

Each run writes the model plus `model_report.json` (metrics, per-source
results, model comparison, threshold curve, error analysis), which the API
serves. Train and test are split by message template so re-sent campaigns
cannot leak, and the model and threshold come from cross-validation on the
training split only. `--prevalence` (default 0.126) sets the share of real
traffic assumed to be fraud when choosing the threshold.

**Known gap:** none of the public datasets contain modern legitimate messages
(OTPs, bank alerts, delivery updates), so all normal messages are 2012 UCI
chat. The combined model catches ~98% of modern scams but also flags most
modern transactional messages. Adding real legitimate messages is the next
step before either model is fit for real traffic.

`spamham_project_v2.py` is the original Colab export and still reads the
dataset from Google Drive; to run it locally, drop the `google.colab` mount
lines and point the path at `spam.csv`.

## Web app

```bash
createdb phishguard                                    # or leave DATABASE_URL unset for SQLite
DATABASE_URL=postgresql://localhost/phishguard python api_server.py --port 8000
cd frontend && npm install && npx next dev -p 3001
```

Open http://localhost:3001, create an account, and scan messages. Scan
history is stored per user in the database. API docs: http://localhost:8000/api/docs

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `sqlite:///data/phishguard.db` | Postgres or SQLite URL |
| `MODEL_PATH` | `fraud_model.joblib` | e.g. `fraud_model_combined.joblib` |
| `ALLOWED_ORIGINS` | localhost only | extra frontend origins, comma-separated |
| `COOKIE_SECURE` | off | set to `1` when served over HTTPS |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | where the frontend finds the API |

- Accounts use email + password (scrypt-hashed), with an httpOnly session
  cookie that lasts 7 days. Repeated failed sign-ins are blocked for 15 minutes.
- Bad input gets 400/411/413/415, missing sign-in 401, and a missing model or
  database 503, each with a message saying what to do.
- The UI has no offline mode: every score, metric and explanation comes from the API.

### Tests

```bash
pytest                                                 # SQLite
TEST_DATABASE_URL=postgresql://localhost/phishguard_test pytest   # Postgres (createdb first)
```

## Note on the dataset

The UCI SMS Spam Collection was gathered around 2012 and is UK-centric, so
held-out scores here are optimistic relative to current SMS fraud.

## Author

Arsh (ArshPunisher)
