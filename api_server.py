# -*- coding: utf-8 -*-
"""
PHISHGUARD API: scores SMS messages with the trained model, with user accounts
and per-user scan history.

Public:
  GET    /api/health          model status (503 if no model is loaded)
  GET    /api/metrics         evaluation report saved at training time
  POST   /api/auth/register   {"email", "password"} -> sets session cookie
  POST   /api/auth/login      {"email", "password"} -> sets session cookie
Signed in (session cookie):
  POST   /api/auth/logout
  GET    /api/auth/me
  POST   /api/scan            {"message": str, "threshold"?: float in (0, 1)}
  GET    /api/history         ?limit=1..500&offset=0
  DELETE /api/history         delete all of the user's scans
  DELETE /api/history/{id}

Configuration (environment): MODEL_PATH, DATABASE_URL (see db.py),
ALLOWED_ORIGINS (comma-separated, added to localhost), COOKIE_SECURE=1 behind HTTPS.

Run: python api_server.py --port 8000
"""

import argparse
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

import joblib
from fastapi import Cookie, Depends, FastAPI, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

import auth
import message_analysis
import spamham_project_v3 as sp
from db import AuthSession, Database, Scan, User

TRAIN_COMMAND = "python spamham_project_v3.py --data spam.csv"

# Concatenated SMS tops out around 1,600 characters; this leaves headroom
# without letting one request tie up the model.
MAX_MESSAGE_CHARS = 5000
MAX_BODY_BYTES = 64 * 1024

LOCALHOST_ORIGINS = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"


class ApiError(Exception):
    def __init__(self, status, message, hint=None, headers=None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.hint = hint
        self.headers = headers


class ModelState:
    pipeline = None
    threshold = None
    name = None
    report = None
    feature_index = None
    load_error = None

    def load(self, path: Path):
        if not path.exists():
            self.load_error = f"Model file {path} not found. Train it first: {TRAIN_COMMAND}"
            print(f"[PhishGuard] {self.load_error}")
            return
        try:
            data = joblib.load(path)
        except Exception as exc:
            # Typically a model pickled by an older script version.
            self.load_error = f"Could not load {path} ({exc}). Retrain it: {TRAIN_COMMAND}"
            print(f"[PhishGuard] {self.load_error}")
            return
        self.pipeline = data["pipeline"]
        self.threshold = float(data["threshold"])
        self.name = data["model_name"]
        self.report = data.get("report")
        self.feature_index = sp.feature_index(self.pipeline)
        print(f"[PhishGuard] Loaded {self.name} with threshold {self.threshold:.4f}")


class Credentials(BaseModel):
    email: str
    password: str


class ScanRequest(BaseModel):
    message: str
    threshold: float | None = None


def create_app(model_path: Path | None = None, database: Database | None = None,
               extra_origins: list[str] | None = None, cookie_secure: bool | None = None) -> FastAPI:
    model_path = model_path or Path(os.environ.get("MODEL_PATH", "fraud_model.joblib"))
    database = database or Database()
    if extra_origins is None:
        extra_origins = [o.strip().rstrip("/") for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
    if cookie_secure is None:
        cookie_secure = os.environ.get("COOKIE_SECURE") == "1"

    model = ModelState()
    limiter = auth.LoginRateLimiter()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        model.load(model_path)
        database.migrate()
        yield

    app = FastAPI(title="PhishGuard API", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")

    origin_regex = "^(" + "|".join([LOCALHOST_ORIGINS] + [re.escape(o) for o in extra_origins]) + ")$"
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=origin_regex,
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type"],
    )

    # ---------------------------------------------------------------- errors
    def error_response(err: ApiError) -> JSONResponse:
        body = {"error": err.message}
        if err.hint:
            body["hint"] = err.hint
        return JSONResponse(body, status_code=err.status, headers=err.headers)

    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, err: ApiError):
        return error_response(err)

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(request: Request, err: StarletteHTTPException):
        message = {404: f"No endpoint at {request.method} {request.url.path}.",
                   405: f"{request.method} is not allowed on {request.url.path}."}.get(err.status_code, str(err.detail))
        return error_response(ApiError(err.status_code, message))

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, err: RequestValidationError):
        first = err.errors()[0]
        loc = [str(p) for p in first.get("loc", []) if p != "body"]
        if first.get("type") == "json_invalid":
            return error_response(ApiError(400, "Request body is not valid JSON."))
        if not loc:
            return error_response(ApiError(400, "Request body must be a JSON object."))
        field = ".".join(loc)
        if first.get("type") == "missing":
            return error_response(ApiError(400, f"Field '{field}' is required."))
        return error_response(ApiError(400, f"Field '{field}' is invalid: {first.get('msg', 'bad value')}."))

    @app.exception_handler(SQLAlchemyError)
    async def handle_db_error(request: Request, err: SQLAlchemyError):
        print(f"[PhishGuard] Database error: {err!r}")
        return error_response(ApiError(503, "The database is unavailable.",
                                       "Check DATABASE_URL and that the database server is running."))

    @app.middleware("http")
    async def limit_body(request: Request, call_next):
        length = request.headers.get("content-length")
        has_body = (length not in (None, "0")) or "transfer-encoding" in request.headers
        if request.method == "POST" and has_body:
            content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
            if content_type != "application/json":
                return error_response(ApiError(415, f"Unsupported Content-Type '{content_type or 'none'}'.",
                                               "Send the body as application/json."))
            if length is None:
                return error_response(ApiError(411, "Content-Length header is required."))
            if not length.isdigit():
                return error_response(ApiError(400, "Content-Length header is not a number."))
            if int(length) > MAX_BODY_BYTES:
                return error_response(ApiError(413, f"Request body is {length} bytes; the limit is "
                                                    f"{MAX_BODY_BYTES} bytes.", "Scan one SMS at a time."))
        return await call_next(request)

    # ---------------------------------------------------------- dependencies
    def get_db():
        with database.sessionmaker() as session:
            yield session

    def require_model():
        if model.pipeline is None:
            raise ApiError(503, "The fraud model is not loaded.", model.load_error)

    def current_user(db=Depends(get_db),
                     session_token: Annotated[str | None, Cookie(alias=auth.SESSION_COOKIE)] = None) -> User:
        if not session_token:
            raise ApiError(401, "You are not signed in.", "Sign in to scan messages.")
        row = db.get(AuthSession, auth.hash_token(session_token))
        if row is None or _aware(row.expires_at) <= datetime.now(timezone.utc):
            raise ApiError(401, "Your session has expired.", "Sign in again.")
        user = db.get(User, row.user_id)
        if user is None:
            raise ApiError(401, "Your account no longer exists.")
        return user

    def start_session(db, response: Response, user: User):
        token, token_hash, expires = auth.new_session_token()
        db.add(AuthSession(token_hash=token_hash, user_id=user.id, expires_at=expires))
        db.commit()
        response.set_cookie(auth.SESSION_COOKIE, token, max_age=int(auth.SESSION_TTL.total_seconds()),
                            httponly=True, samesite="lax", secure=cookie_secure, path="/")

    # ------------------------------------------------------------- endpoints
    @app.get("/api/health")
    def health():
        if model.pipeline is None:
            return JSONResponse({"status": "model_unavailable", "error": model.load_error}, status_code=503)
        return {"status": "active", "model": model.name, "threshold": model.threshold,
                "hasReport": model.report is not None}

    @app.get("/api/metrics")
    def metrics():
        require_model()
        if model.report is None:
            raise ApiError(503, "The loaded model has no saved evaluation report.",
                           f"Retrain it: {TRAIN_COMMAND}")
        return model.report

    @app.post("/api/auth/register", status_code=201)
    def register(body: Credentials, response: Response, db=Depends(get_db)):
        email = auth.normalize_email(body.email)
        problem = auth.validate_credentials(email, body.password)
        if problem:
            raise ApiError(400, problem)
        user = User(email=email, password_hash=auth.hash_password(body.password))
        db.add(user)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise ApiError(409, "An account with this email already exists.", "Sign in instead.")
        start_session(db, response, user)
        return {"email": user.email}

    @app.post("/api/auth/login")
    def login(body: Credentials, request: Request, response: Response, db=Depends(get_db)):
        email = auth.normalize_email(body.email)
        key = f"{request.client.host if request.client else '-'}|{email}"
        wait = limiter.retry_after(key)
        if wait:
            raise ApiError(429, "Too many failed sign-in attempts.",
                           f"Try again in {max(1, wait // 60)} minute(s).", headers={"Retry-After": str(wait)})
        user = db.scalar(select(User).where(User.email == email))
        if not auth.verify_password(body.password, user.password_hash if user else auth.DUMMY_HASH) or user is None:
            limiter.record_failure(key)
            raise ApiError(401, "Email or password is incorrect.")
        limiter.reset(key)
        start_session(db, response, user)
        return {"email": user.email}

    @app.post("/api/auth/logout")
    def logout(response: Response, db=Depends(get_db),
               session_token: Annotated[str | None, Cookie(alias=auth.SESSION_COOKIE)] = None):
        if session_token:
            db.execute(delete(AuthSession).where(AuthSession.token_hash == auth.hash_token(session_token)))
            db.commit()
        response.delete_cookie(auth.SESSION_COOKIE, path="/")
        return {"signedOut": True}

    @app.get("/api/auth/me")
    def me(user: User = Depends(current_user)):
        return {"email": user.email}

    @app.post("/api/scan")
    def scan(body: ScanRequest, user: User = Depends(current_user), db=Depends(get_db)):
        require_model()
        message = body.message.strip()
        if not message:
            raise ApiError(400, "Field 'message' is empty.", "Paste the SMS text to scan.")
        if len(message) > MAX_MESSAGE_CHARS:
            raise ApiError(413, f"Message is {len(message)} characters; the limit is {MAX_MESSAGE_CHARS}.",
                           "Scan one SMS at a time.")
        threshold = model.threshold if body.threshold is None else body.threshold
        if not 0 < threshold < 1:
            raise ApiError(400, f"Field 'threshold' must be between 0 and 1 (exclusive); got {threshold}.")

        try:
            result = message_analysis.analyze(model.pipeline, message, threshold, model.feature_index)
        except Exception as exc:
            print(f"[PhishGuard] Inference failed: {exc!r}")
            raise ApiError(500, "The model failed to score this message.",
                           "Check the API server log; retraining may be required.")

        row = Scan(user_id=user.id, message=message, prediction=result["prediction"],
                   probability=result["probability"], risk_level=result["riskLevel"],
                   threshold=threshold, model_name=model.name, result=result)
        db.add(row)
        db.commit()
        result["id"] = f"scan-{row.id}"
        result["timestamp"] = _timestamp(row.created_at)
        return result

    @app.get("/api/history")
    def history(limit: Annotated[int, Query(ge=1, le=500)] = 100, offset: Annotated[int, Query(ge=0)] = 0,
                user: User = Depends(current_user), db=Depends(get_db)):
        total = db.scalar(select(func.count()).select_from(Scan).where(Scan.user_id == user.id))
        rows = db.scalars(select(Scan).where(Scan.user_id == user.id)
                          .order_by(Scan.created_at.desc(), Scan.id.desc()).limit(limit).offset(offset))
        return {"total": total, "items": [_history_item(r) for r in rows]}

    @app.delete("/api/history")
    def clear_history(user: User = Depends(current_user), db=Depends(get_db)):
        deleted = db.execute(delete(Scan).where(Scan.user_id == user.id)).rowcount
        db.commit()
        return {"deleted": deleted}

    @app.delete("/api/history/{scan_id}")
    def delete_scan(scan_id: int, user: User = Depends(current_user), db=Depends(get_db)):
        row = db.get(Scan, scan_id)
        if row is None or row.user_id != user.id:
            raise ApiError(404, f"Scan {scan_id} not found.")
        db.delete(row)
        db.commit()
        return {"deleted": 1}

    return app


def _aware(dt: datetime) -> datetime:
    # SQLite returns naive datetimes; they were stored as UTC.
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _timestamp(dt: datetime) -> str:
    return _aware(dt).astimezone().strftime("%Y-%m-%d %H:%M:%S")


def _history_item(row: Scan) -> dict:
    result = dict(row.result, id=f"scan-{row.id}", timestamp=_timestamp(row.created_at))
    return {
        "id": result["id"],
        "timestamp": result["timestamp"],
        "message": row.message,
        "prediction": row.prediction,
        "riskLevel": row.risk_level,
        "riskScore": result["riskScore"],
        "probability": row.probability,
        "confidence": round(max(row.probability, 1 - row.probability) * 100, 1),
        "reasonsCount": len(result.get("reasons", [])),
        "topReason": (result.get("reasons") or [None])[0],
        "detectedCategories": [s["category"] for s in result.get("detectedSignals", [])],
        "result": result,
    }


def main():
    import uvicorn

    parser = argparse.ArgumentParser(description="PhishGuard API")
    parser.add_argument("--port", type=int, default=8000, help="Port to serve on (default: 8000)")
    parser.add_argument("--host", default="127.0.0.1",
                        help="Interface to bind (default: 127.0.0.1; use 0.0.0.0 to expose)")
    parser.add_argument("--model", type=Path, default=None, help="model file (default: $MODEL_PATH or fraud_model.joblib)")
    parser.add_argument("--allow-origin", action="append", default=None,
                        help="Extra CORS origin to allow (repeatable); localhost is always allowed")
    args = parser.parse_args()

    app = create_app(model_path=args.model, extra_origins=args.allow_origin)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
