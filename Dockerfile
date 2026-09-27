# PhishGuard API. The model file is not baked in: mount it at $MODEL_PATH, or
# set MODEL_URL (and MODEL_SHA256) to download it on startup.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MODEL_PATH=/models/fraud_model.joblib
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py alembic.ini ./
COPY migrations ./migrations

RUN useradd --create-home app \
    && mkdir -p /models /app/data \
    && chown -R app:app /models /app/data
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen(f\"http://127.0.0.1:{os.environ.get('PORT', '8000')}/api/health\", timeout=3)"]
CMD ["sh", "-c", "python api_server.py --host 0.0.0.0 --port ${PORT:-8000}"]
