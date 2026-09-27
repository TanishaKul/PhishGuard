# AI Fraud Detection

SMS fraud (smishing) detection: a trained scikit-learn model, a FastAPI
service with accounts and scan history, and a Next.js web app that explains
each verdict.

## Contents

| Path | What it does |
|---|---|
| `spamham_project_v3.py` | Training pipeline: entity-preserving normalisation, word + char TF-IDF and 12 handcrafted features, template-grouped CV, cost-based threshold, evaluation report |
| `build_dataset.py` | Merges UCI with recent public smishing datasets into `data/combined.csv` |
| `scrub_messages.py`, `export_feedback.py` | Add your own messages / users' corrections to the training data |
| `compare_models.py` | Compares models on the same held-out messages |
| `eda.py` | Class-balance, length and word-cloud plots (`spamham_project_v3.py --eda`) |
| `api_server.py`, `message_analysis.py`, `link_risk.py` | FastAPI app: scoring, explanations, link checks |
| `db.py`, `auth.py`, `mailer.py`, `migrations/`, `manage.py` | Database, accounts, email, schema migrations, admin CLI |
| `frontend/` | Next.js web app |
| `tests/` | API and rule tests (`pytest`) |

## Usage

```bash
pip install -r requirements-dev.txt      # add requirements-eda.txt for the plots
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
| `COOKIE_SAMESITE` | `lax` | `none` only for direct cross-site calls (needs `COOKIE_SECURE=1`) |
| `MODEL_URL`, `MODEL_SHA256` | unset | download the model on startup; a 64-hex checksum is mandatory with `MODEL_URL` |
| `APP_URL` | `http://localhost:3001` | web app address used in reset links |
| `APP_ENV` | `development` | set to `production` to require SMTP and HTTPS model downloads |
| `SMTP_HOST` … `MAIL_FROM` | unset | send real email; production fails closed without SMTP |
| `SCAN_RATE_LIMIT` | `600` | scans each user may run per hour |
| `API_PROXY_TARGET` (web) | unset | proxy `/api/*` to this API; pair with `NEXT_PUBLIC_API_URL=` |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | where the frontend finds the API |

- Accounts use email + password (scrypt-hashed), with an httpOnly session
  cookie that lasts 7 days. Repeated failed sign-ins are blocked for 15 minutes.
- Bad input gets 400/411/413/415, missing sign-in 401, and a missing model or
  database 503, each with a message saying what to do.
- The UI has no offline mode: every score, metric and explanation comes from the API.

### Docker

```bash
docker compose up --build            # Postgres + API + web app at http://localhost:3000
```

Mounts `./fraud_model.joblib` into the API (set `MODEL_FILE` to use another).
`API_PORT` / `WEB_PORT` change the loopback-only published ports.

### Admin and feedback

```bash
python manage.py make-admin you@example.com    # then sign in again to see the Admin page
python export_feedback.py --include-unreviewed --seed 42
python scrub_messages.py inbox.txt --label ham # your own messages -> data/raw/user_messages.csv
python build_dataset.py && python spamham_project_v3.py --data data/combined.csv --out fraud_model_new.joblib
python compare_models.py fraud_model.joblib fraud_model_new.joblib
```

`export_feedback.py` refuses to run without `--include-unreviewed`. Review
its labels and residual text first; conflicting labels are quarantined by
`build_dataset.py`, and repeated non-UCI campaigns are capped.

In development, password-reset emails print to the API console unless
`SMTP_HOST` (plus `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`) is
set. With `APP_ENV=production`, missing SMTP fails closed and never logs a
live reset token.

### Deploying (Render + Vercel)

1. Upload the trained model somewhere with a public HTTPS URL (e.g. a GitHub
   release asset) and note its SHA-256 (`shasum -a 256 fraud_model.joblib`).
2. Vercel: import the repo with root directory `frontend`, set
   `NEXT_PUBLIC_API_URL=` (empty), and deploy once to obtain the public web URL.
3. Render: *New → Blueprint* on this repo. Fill in `MODEL_URL`,
   `MODEL_SHA256`, `APP_URL` (the Vercel URL), and the SMTP variables. The
   blueprint's free Postgres plan is intended for demos; use a durable plan
   before relying on accounts, history or feedback.
4. In Vercel, set `API_PROXY_TARGET=https://<your-api>.onrender.com` and
   redeploy. The web app then proxies `/api/*` to the API, so the session
   cookie is first-party and no CORS setup is needed.
5. Sign up in the deployed app, then run `python manage.py make-admin EMAIL`
   with `DATABASE_URL` set to the Render database's external URL.

To call the API directly from another site instead of proxying, set
`ALLOWED_ORIGINS=https://your-app.example`, `COOKIE_SAMESITE=none` and
`COOKIE_SECURE=1` on the API. Some browsers block such cross-site cookies,
which is why the proxy is the default. Behind a load balancer, set uvicorn's
`FORWARDED_ALLOW_IPS` so login rate limiting sees real client addresses.

### Tests

```bash
pytest                                                 # SQLite
TEST_DATABASE_URL=postgresql://localhost/phishguard_test pytest   # Postgres (createdb first)
```

## Security and data notes

- `MODEL_URL` downloads are bounded to 100 MB and require an exact SHA-256;
  joblib artifacts execute Python when loaded, so the model host is trusted.
- Feedback is untrusted. Export requires an explicit review acknowledgement,
  conflicting labels are quarantined, and combined/custom model reports redact
  raw error samples and private-derived indicator terms.
- Password-reset links place tokens in URL fragments, which browsers do not send
  to web/proxy access logs. Production refuses console delivery without SMTP.
- Registration, sign-in, reset, and scan routes have bounded per-process limits.
  Use a shared rate-limit store before running multiple API replicas.

## Note on the dataset

The UCI SMS Spam Collection was gathered around 2012 and is UK-centric, so
held-out scores here are optimistic relative to current SMS fraud.

## Author

Arsh (ArshPunisher)
