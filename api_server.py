# -*- coding: utf-8 -*-
"""
PHISHGUARD API: scores SMS messages with the trained model, with user accounts
and per-user scan history.

Public:
  GET    /api/health          model status (503 if no model is loaded)
  GET    /api/metrics         evaluation report saved at training time
  POST   /api/auth/register   {"email", "password"} -> sets session cookie
  POST   /api/auth/login      {"email", "password"} -> sets session cookie
  POST   /api/auth/forgot     {"email"} -> emails a reset link (always 202)
  POST   /api/auth/reset      {"token", "password"} -> new password, signs in
Signed in (session cookie):
  POST   /api/auth/logout
  GET    /api/auth/me
  POST   /api/scan            {"message": str, "threshold"?: float in (0, 1)}
  GET    /api/history         ?limit=1..500&offset=0
  DELETE /api/history         delete all of the user's scans
  DELETE /api/history/{id}
  POST   /api/scans/{id}/feedback   {"correctLabel": "fraud"|"legit", "note"?: str}
  DELETE /api/scans/{id}/feedback
Admins (python manage.py make-admin EMAIL):
  GET    /api/admin/stats
  GET    /api/admin/feedback  ?limit=1..500&offset=0

Configuration (environment): MODEL_PATH, MODEL_URL + required MODEL_SHA256
(download the model on startup when MODEL_PATH is missing), DATABASE_URL (see db.py),
ALLOWED_ORIGINS (comma-separated, added to localhost), COOKIE_SECURE=1 behind HTTPS,
COOKIE_SAMESITE=none when the frontend is on another site (requires COOKIE_SECURE=1),
APP_URL (frontend address used in reset links), SMTP_* (see mailer.py),
SCAN_RATE_LIMIT (scans per user per hour, default 600), and
APP_ENV=production (requires HTTPS model downloads and real SMTP).

Run: python api_server.py --port 8000
"""

import argparse
import copy
import os
import re
import sys

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Literal
from zoneinfo import ZoneInfo
from spamham_project_v3 import TextNormalizer, HandcraftedFeatures

IST = ZoneInfo("Asia/Kolkata")

# Models trained by older versions of spamham_project_v3.py (run as __main__)
# pickled these classes as __main__.X. Current training pickles them under
# the module name, so this only keeps those older model files loadable.
sys.modules["__main__"].TextNormalizer = TextNormalizer
sys.modules["__main__"].HandcraftedFeatures = HandcraftedFeatures
import joblib
from fastapi import BackgroundTasks, Cookie, Depends, FastAPI, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from pydantic import BaseModel
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

import auth
import mailer
import message_analysis
from scrub_messages import scrub
import spamham_project_v3 as sp
from db import AuthSession, Database, Feedback, PasswordReset, Scan, User

TRAIN_COMMAND = "python spamham_project_v3.py --data spam.csv"

# Concatenated SMS tops out around 1,600 characters; this leaves headroom
# without letting one request tie up the model.
MAX_MESSAGE_CHARS = 5000
MAX_BODY_BYTES = 64 * 1024
MAX_MODEL_BYTES = 100 * 1024 * 1024
# Generous enough for demos and batch testing; set SCAN_RATE_LIMIT to change it.
DEFAULT_SCAN_RATE_LIMIT = 600

LOCALHOST_ORIGINS = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"


def public_model_report(report: dict) -> dict:
    """Return a report safe for the unauthenticated metrics endpoint.

    Historical combined reports predate per-source error labels and may contain
    feedback text or private-derived feature names. For any combined/custom
    dataset, keep aggregate metrics but remove raw samples and indicator terms.
    """
    safe = copy.deepcopy(report)
    if safe.get("dataset") != "spam.csv":
        for group in ("falseNegatives", "falsePositives"):
            for item in safe.get("errorAnalysis", {}).get(group, []):
                item["message"] = "[redacted: report contains private or custom training data]"
        safe["topIndicators"] = []
    return safe


class ApiError(Exception):
    def __init__(self, status, message, hint=None, headers=None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.hint = hint
        self.headers = headers


def _prepare_model_report(report, pipeline, feature_index):
    if not isinstance(report, dict):
        return None
    try:
        for group in ("falseNegatives", "falsePositives"):
            for item in report.get("errorAnalysis", {}).get(group, []):
                message = item.get("message")
                if isinstance(message, str) and not message.startswith("[redacted"):
                    drivers = sp.term_contributions(pipeline, message, k=4, index=feature_index)
                    item["fraudDrivers"] = drivers["fraud"]
                    item["legitimateDrivers"] = drivers["legitimate"]
        report["explanationMethod"] = "local_probability_effect"
        report.setdefault("indicatorMethod", "legacy_average_coefficient")
        report.setdefault("selectionMethod", "cv_pr_auc")
        return report
    except (AttributeError, KeyError, TypeError, ValueError):
        return None


class ModelState:
    pipeline = None
    threshold = None
    name = None
    report = None
    feature_index = None
    load_error = None

    def load(self, path: Path):
        url = os.environ.get("MODEL_URL")
        checksum = os.environ.get("MODEL_SHA256")
        if url and not checksum:
            self.load_error = "MODEL_SHA256 is required when MODEL_URL is set."
            print(f"[PhishGuard] {self.load_error}")
            return

        if url and path.exists() and checksum:
            try:
                verify_model_checksum(path, checksum)
            except (OSError, ValueError) as exc:
                self.load_error = f"Model checksum validation failed: {exc}"
                print(f"[PhishGuard] {self.load_error}")
                return

        if not path.exists() and url:
            try:
                download_model(url, path, checksum)
            except (OSError, ValueError) as exc:
                self.load_error = f"Could not download the model from MODEL_URL: {exc}"
                print(f"[PhishGuard] {self.load_error}")
                return
        if not path.exists():
            self.load_error = f"Model file {path} not found. Train it first: {TRAIN_COMMAND}"
            print(f"[PhishGuard] {self.load_error}")
            return

        try:
            data = joblib.load(path)
            pipeline = data["pipeline"]
            threshold = float(data["threshold"])
            name = str(data["model_name"])
            if not 0 < threshold < 1:
                raise ValueError(f"threshold must be between 0 and 1, got {threshold}")
            # Force feature-index construction and basic probability support now,
            # while errors can still be represented as an unavailable model.
            if not callable(getattr(pipeline, "predict_proba", None)):
                raise TypeError("pipeline does not implement predict_proba")
            feature_index = sp.feature_index(pipeline)
        except Exception as exc:
            # Invalid pickles and models produced by incompatible training code
            # must degrade to health 503 instead of crashing application startup.
            self.load_error = f"Could not load {path} ({exc}). Retrain it: {TRAIN_COMMAND}"
            print(f"[PhishGuard] {self.load_error}")
            return

        self.pipeline = pipeline
        self.threshold = threshold
        self.name = name
        # Error drivers stored by older training runs used raw fold-coefficient
        # averages. Recompute them with the current local-effect calculation.
        report = _prepare_model_report(data.get("report"), pipeline, feature_index)
        self.report = report
        self.feature_index = feature_index
        self.load_error = None
        print(f"[PhishGuard] Loaded {self.name} with threshold {self.threshold:.4f}")


def _validate_model_checksum(sha256: str | None):
    if not sha256 or not re.fullmatch(r"[0-9a-fA-F]{64}", sha256):
        raise ValueError("MODEL_SHA256 must contain exactly 64 hexadecimal characters")


def verify_model_checksum(path: Path, sha256: str):
    import hashlib

    _validate_model_checksum(sha256)
    if path.stat().st_size > MAX_MODEL_BYTES:
        raise ValueError(f"model exceeds the {MAX_MODEL_BYTES}-byte limit")
    digest = hashlib.sha256()
    with path.open("rb") as model_file:
        for chunk in iter(lambda: model_file.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != sha256.lower():
        raise ValueError("checksum does not match MODEL_SHA256")


def download_model(url: str, path: Path, sha256: str):
    import urllib.request

    _validate_model_checksum(sha256)
    if os.environ.get("APP_ENV", "development").lower() == "production" and not url.lower().startswith("https://"):
        raise ValueError("MODEL_URL must use HTTPS in production")

    # Log the endpoint without query parameters, which may carry signed secrets.
    safe_url = url.split("?", 1)[0]
    print(f"[PhishGuard] Downloading model from {safe_url}")
    request = urllib.request.Request(url, headers={"User-Agent": "PhishGuard/1.0"})
    with urllib.request.urlopen(request, timeout=120) as resp:
        declared_size = resp.headers.get("Content-Length")
        if declared_size and int(declared_size) > MAX_MODEL_BYTES:
            raise ValueError(f"model exceeds the {MAX_MODEL_BYTES}-byte limit")
        data = resp.read(MAX_MODEL_BYTES + 1)
    if len(data) > MAX_MODEL_BYTES:
        raise ValueError(f"model exceeds the {MAX_MODEL_BYTES}-byte limit")
    import hashlib
    if hashlib.sha256(data).hexdigest() != sha256.lower():
        raise ValueError("checksum does not match MODEL_SHA256")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f".{os.getpid()}.part")
    try:
        tmp.write_bytes(data)
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


class Credentials(BaseModel):
    email: str
    password: str


class ScanRequest(BaseModel):
    message: str
    threshold: float | None = None


class ForgotRequest(BaseModel):
    email: str


class ResetRequest(BaseModel):
    token: str
    password: str


class FeedbackRequest(BaseModel):
    correctLabel: Literal["fraud", "legit"]
    note: str | None = None


MAX_NOTE_CHARS = 500


def create_app(model_path: Path | None = None, database: Database | None = None,
               extra_origins: list[str] | None = None, cookie_secure: bool | None = None,
               mail=None, app_url: str | None = None, cookie_samesite: str | None = None) -> FastAPI:
    model_path = model_path or Path(os.environ.get("MODEL_PATH", "fraud_model.joblib"))
    database = database or Database()
    if extra_origins is None:
        extra_origins = [o.strip().rstrip("/") for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
    if cookie_secure is None:
        cookie_secure = os.environ.get("COOKIE_SECURE") == "1"
    cookie_samesite = (cookie_samesite or os.environ.get("COOKIE_SAMESITE", "lax")).lower()
    if cookie_samesite not in {"lax", "strict", "none"}:
        raise ValueError(f"COOKIE_SAMESITE must be lax, strict or none; got {cookie_samesite!r}")
    if cookie_samesite == "none" and not cookie_secure:
        # Browsers drop SameSite=None cookies that are not Secure, so sign-in would silently fail.
        raise ValueError("COOKIE_SAMESITE=none requires COOKIE_SECURE=1 (HTTPS)")
    raw_scan_limit = os.environ.get("SCAN_RATE_LIMIT", str(DEFAULT_SCAN_RATE_LIMIT))
    if not raw_scan_limit.isdigit() or int(raw_scan_limit) < 1:
        raise ValueError(f"SCAN_RATE_LIMIT must be a positive whole number of scans per hour; got {raw_scan_limit!r}")
    scan_rate_limit = int(raw_scan_limit)

    mail = mail or mailer.mailer_from_env()
    if isinstance(mail, mailer.DisabledMailer):
        # Forgot-password answers the same way whether or not mail was sent (so it
        # cannot reveal who has an account); say it loudly here instead.
        print("[PhishGuard] WARNING: APP_ENV=production but SMTP_HOST is not set. "
              "Password-reset emails will not be delivered until SMTP_* is configured.")
    app_url = (app_url or os.environ.get("APP_URL", "http://localhost:3001")).rstrip("/")

    model = ModelState()
    limiter = auth.LoginRateLimiter()
    login_ip_limiter = auth.LoginRateLimiter(max_failures=1_000, window_seconds=900)
    reset_limiter = auth.LoginRateLimiter(max_failures=3, window_seconds=3600)
    reset_ip_limiter = auth.LoginRateLimiter(max_failures=200, window_seconds=3600)
    register_limiter = auth.LoginRateLimiter(max_failures=200, window_seconds=3600)
    register_email_limiter = auth.LoginRateLimiter(max_failures=5, window_seconds=3600)
    scan_limiter = auth.LoginRateLimiter(max_failures=scan_rate_limit, window_seconds=3600)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        model.load(model_path)
        database.migrate()
        now = datetime.now(timezone.utc)
        with database.sessionmaker() as session:
            session.execute(delete(AuthSession).where(AuthSession.expires_at < now))
            session.execute(delete(PasswordReset).where(
                or_(PasswordReset.expires_at < now,
                    and_(PasswordReset.used_at.is_not(None), PasswordReset.used_at < now - timedelta(days=1)))
            ))
            session.commit()
        yield

    app = FastAPI(title="PhishGuard API", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")

    allowed_origins = [LOCALHOST_ORIGINS] + [re.escape(o) for o in extra_origins]
    if re.fullmatch(r"https?://[^/]+", app_url):
        allowed_origins.append(re.escape(app_url))
    origin_regex = "^(" + "|".join(allowed_origins) + ")$"
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
    async def validate_mutation_origin(request: Request, call_next):
        origin = request.headers.get("origin")
        if request.method in {"POST", "DELETE"} and origin and not re.fullmatch(origin_regex, origin):
            return error_response(ApiError(403, "This request origin is not allowed."))
        return await call_next(request)

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
    def client_key(request: Request) -> str:
        return request.client.host if request.client else "unknown"

    def enforce_rate_limit(limiter, key: str, message: str, hint: str):
        wait = limiter.reserve_failure(key)
        if wait:
            raise ApiError(429, message, hint, headers={"Retry-After": str(wait)})

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
                            httponly=True, samesite=cookie_samesite, secure=cookie_secure, path="/")

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
        return public_model_report(model.report)

    @app.post("/api/auth/register", status_code=201)
    def register(body: Credentials, request: Request, response: Response, db=Depends(get_db)):
        enforce_rate_limit(
            register_limiter, f"register|{client_key(request)}",
            "Too many account registrations.", "Try again later.",
        )
        email = auth.normalize_email(body.email)
        enforce_rate_limit(
            register_email_limiter, f"register-email|{email}",
            "Too many registration attempts for this email.", "Try again later.",
        )
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
        return {"email": user.email, "isAdmin": user.is_admin}

    @app.post("/api/auth/login")
    def login(body: Credentials, request: Request, response: Response, db=Depends(get_db)):
        email = auth.normalize_email(body.email)
        ip = client_key(request)
        wait = limiter.reserve_failure(f"login|{ip}|{email}")
        if wait:
            raise ApiError(429, "Too many failed sign-in attempts.",
                           f"Try again in {max(1, wait // 60)} minute(s).", headers={"Retry-After": str(wait)})
        ip_wait = login_ip_limiter.reserve_failure(f"login-ip|{ip}")
        if ip_wait:
            raise ApiError(429, "Too many sign-in attempts from this client.",
                           "Try again later.", headers={"Retry-After": str(ip_wait)})
        user = db.scalar(select(User).where(User.email == email))
        if not auth.verify_password(body.password, user.password_hash if user else auth.DUMMY_HASH) or user is None:
            raise ApiError(401, "Email or password is incorrect.")
        limiter.reset(f"login|{ip}|{email}")
        start_session(db, response, user)
        return {"email": user.email, "isAdmin": user.is_admin}

    @app.post("/api/auth/logout")
    def logout(response: Response, db=Depends(get_db),
               session_token: Annotated[str | None, Cookie(alias=auth.SESSION_COOKIE)] = None):
        if session_token:
            db.execute(delete(AuthSession).where(AuthSession.token_hash == auth.hash_token(session_token)))
            db.commit()
        response.delete_cookie(auth.SESSION_COOKIE, path="/", secure=cookie_secure,
                               httponly=True, samesite=cookie_samesite)
        return {"signedOut": True}

    @app.post("/api/auth/forgot", status_code=202)
    def forgot_password(body: ForgotRequest, request: Request, background_tasks: BackgroundTasks,
                        db=Depends(get_db)):
        email = auth.normalize_email(body.email)
        if not auth.EMAIL_RE.match(email):
            raise ApiError(400, "Enter a valid email address.")
        ip = client_key(request)
        wait = reset_limiter.reserve_failure(f"reset|{ip}|{email}")
        if wait:
            raise ApiError(429, "Too many reset requests for this email.",
                           f"Try again in {max(1, wait // 60)} minute(s).", headers={"Retry-After": str(wait)})
        ip_wait = reset_ip_limiter.reserve_failure(f"reset-ip|{ip}")
        if ip_wait:
            raise ApiError(429, "Too many reset requests from this client.",
                           "Try again later.", headers={"Retry-After": str(ip_wait)})

        # Same status and body whether or not the account exists or mail delivery
        # succeeds. Delivery failures are logged for operators, not returned as an
        # account-enumeration oracle.
        user = db.scalar(select(User).where(User.email == email))
        if user is not None:
            now = datetime.now(timezone.utc)
            db.execute(update(PasswordReset)
                       .where(PasswordReset.user_id == user.id, PasswordReset.used_at.is_(None))
                       .values(used_at=now))
            token, token_hash, expires = auth.new_reset_token()
            db.add(PasswordReset(token_hash=token_hash, user_id=user.id, expires_at=expires))
            db.commit()
            # Fragments are not sent in HTTP requests or written to web/proxy
            # access logs, unlike query-string bearer tokens.
            link = f"{app_url}/reset-password#token={token}"
            def deliver_reset_email():
                try:
                    mail.send(user.email, "Reset your PhishGuard password",
                              f"Someone asked to reset the password for {user.email}.\n\n"
                              f"Open this link within 1 hour to choose a new password:\n{link}\n\n"
                              "If this wasn't you, ignore this email; your password is unchanged.")
                except mailer.MailError as exc:
                    print(f"[PhishGuard] Reset email delivery failed: {exc}")

            background_tasks.add_task(deliver_reset_email)
        else:
            # Keep unknown-account response work comparable to the database and
            # background scheduling performed for a real account.
            background_tasks.add_task(lambda: None)
        return {"message": "If an account exists for that email, we've sent a reset link. It expires in 1 hour."}

    @app.post("/api/auth/reset")
    def reset_password(body: ResetRequest, response: Response, db=Depends(get_db)):
        now = datetime.now(timezone.utc)
        token_hash = auth.hash_token(body.token)
        row = db.get(PasswordReset, token_hash)
        if row is None or row.used_at is not None or _aware(row.expires_at) <= now:
            raise ApiError(400, "This reset link is invalid or has expired.", "Request a new one.")
        user = db.get(User, row.user_id)
        if user is None:
            raise ApiError(400, "This reset link is invalid or has expired.", "Request a new one.")
        problem = auth.validate_credentials(user.email, body.password)
        if problem:
            raise ApiError(400, problem)

        # Claim the token with one conditional UPDATE. On PostgreSQL a second
        # concurrent request re-evaluates the predicate after the first commit
        # and receives rowcount=0; SQLite serializes the write similarly.
        claimed = db.execute(
            update(PasswordReset)
            .where(PasswordReset.token_hash == token_hash,
                   PasswordReset.used_at.is_(None),
                   PasswordReset.expires_at > now)
            .values(used_at=now)
            .execution_options(synchronize_session=False)
        )
        if claimed.rowcount != 1:
            db.rollback()
            raise ApiError(400, "This reset link is invalid or has expired.", "Request a new one.")

        user.password_hash = auth.hash_password(body.password)
        # Consume every outstanding token for the account and revoke every
        # existing session before committing the new password.
        db.execute(update(PasswordReset)
                   .where(PasswordReset.user_id == user.id, PasswordReset.used_at.is_(None))
                   .values(used_at=now))
        db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
        db.commit()
        start_session(db, response, user)
        return {"email": user.email, "isAdmin": user.is_admin}

    @app.get("/api/auth/me")
    def me(user: User = Depends(current_user)):
        return {"email": user.email, "isAdmin": user.is_admin}

    def require_admin(user: User = Depends(current_user)) -> User:
        if not user.is_admin:
            raise ApiError(403, "Only admins can see this.",
                           "An admin can grant access with: python manage.py make-admin EMAIL")
        return user

    @app.get("/api/admin/stats")
    def admin_stats(admin: User = Depends(require_admin), db=Depends(get_db)):
        since = datetime.now(timezone.utc) - timedelta(days=7)
        recent = db.scalars(select(Scan.created_at).where(Scan.created_at >= since)).all()
        per_day: dict[str, int] = {}
        for created in recent:
            day = _aware(created).astimezone(IST).strftime("%Y-%m-%d")
            per_day[day] = per_day.get(day, 0) + 1
        wrong = db.scalar(select(func.count()).select_from(Feedback).join(Scan, Scan.id == Feedback.scan_id)
                          .where(or_(and_(Scan.prediction == "FRAUD", Feedback.correct_label == "legit"),
                                     and_(Scan.prediction == "LEGITIMATE", Feedback.correct_label == "fraud"))))
        return {
            "users": db.scalar(select(func.count()).select_from(User)),
            "scans": db.scalar(select(func.count()).select_from(Scan)),
            "fraudScans": db.scalar(select(func.count()).select_from(Scan).where(Scan.prediction == "FRAUD")),
            "feedback": db.scalar(select(func.count()).select_from(Feedback)),
            "reportedWrong": wrong,
            "scansByDay": [{"date": d, "count": c} for d, c in sorted(per_day.items())],
            "model": model.name,
        }

    @app.get("/api/admin/feedback")
    def admin_feedback(limit: Annotated[int, Query(ge=1, le=500)] = 100,
                       offset: Annotated[int, Query(ge=0)] = 0,
                       admin: User = Depends(require_admin), db=Depends(get_db)):
        rows = db.execute(select(Feedback, Scan).join(Scan, Scan.id == Feedback.scan_id)
                          .order_by(Feedback.created_at.desc(), Feedback.id.desc())
                          .limit(limit).offset(offset)).all()
        return {"items": [{
            "scanId": f"scan-{scan.id}",
            # Admins see messages with personal details scrubbed.
            "message": scrub(scan.message),
            "predicted": scan.prediction,
            "probability": scan.probability,
            "correctLabel": fb.correct_label,
            "wrong": (scan.prediction == "FRAUD") != (fb.correct_label == "fraud"),
            "note": fb.note,
            "createdAt": _timestamp(fb.created_at),
        } for fb, scan in rows]}

    @app.post("/api/scan")
    def scan(body: ScanRequest, request: Request, user: User = Depends(current_user), db=Depends(get_db)):
        require_model()
        enforce_rate_limit(
            scan_limiter, f"scan|{user.id}|{client_key(request)}",
            "Too many scans from this account.",
            f"The limit is {scan_rate_limit} scans per hour. Try again later.",
        )
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
        result["feedback"] = None
        return result

    @app.get("/api/history")
    def history(limit: Annotated[int, Query(ge=1, le=500)] = 100, offset: Annotated[int, Query(ge=0)] = 0,
                user: User = Depends(current_user), db=Depends(get_db)):
        total = db.scalar(select(func.count()).select_from(Scan).where(Scan.user_id == user.id))
        rows = list(db.scalars(select(Scan).where(Scan.user_id == user.id)
                               .order_by(Scan.created_at.desc(), Scan.id.desc()).limit(limit).offset(offset)))
        labels = dict(db.execute(select(Feedback.scan_id, Feedback.correct_label)
                                 .where(Feedback.scan_id.in_([r.id for r in rows]))).all())
        return {"total": total, "items": [_history_item(r, labels.get(r.id)) for r in rows]}

    @app.delete("/api/history")
    def clear_history(user: User = Depends(current_user), db=Depends(get_db)):
        deleted = db.execute(delete(Scan).where(Scan.user_id == user.id)).rowcount
        db.commit()
        return {"deleted": deleted}

    def own_scan(db, user: User, scan_id: int) -> Scan:
        row = db.get(Scan, scan_id)
        if row is None or row.user_id != user.id:
            raise ApiError(404, f"Scan {scan_id} not found.")
        return row

    @app.post("/api/scans/{scan_id}/feedback")
    def give_feedback(scan_id: int, body: FeedbackRequest, user: User = Depends(current_user), db=Depends(get_db)):
        own_scan(db, user, scan_id)
        note = (body.note or "").strip() or None
        if note and len(note) > MAX_NOTE_CHARS:
            raise ApiError(413, f"Note is {len(note)} characters; the limit is {MAX_NOTE_CHARS}.")
        row = db.scalar(select(Feedback).where(Feedback.scan_id == scan_id))
        if row is None:
            row = Feedback(scan_id=scan_id, user_id=user.id, correct_label=body.correctLabel, note=note)
            db.add(row)
        else:
            row.correct_label, row.note = body.correctLabel, note
        try:
            db.commit()
        except IntegrityError:
            # Another request may have inserted the one-per-scan row after our
            # SELECT. Convert the race into the intended idempotent update.
            db.rollback()
            row = db.scalar(select(Feedback).where(Feedback.scan_id == scan_id))
            if row is None:
                raise
            row.correct_label, row.note = body.correctLabel, note
            db.commit()
        return {"scanId": f"scan-{scan_id}", "correctLabel": row.correct_label, "note": row.note}

    @app.delete("/api/scans/{scan_id}/feedback")
    def remove_feedback(scan_id: int, user: User = Depends(current_user), db=Depends(get_db)):
        own_scan(db, user, scan_id)
        deleted = db.execute(delete(Feedback).where(Feedback.scan_id == scan_id)).rowcount
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
    # ISO-8601 in IST (+05:30) so every viewer sees the same wall-clock time.
    return _aware(dt).astimezone(IST).isoformat(timespec="seconds")


def _history_item(row: Scan, feedback: str | None = None) -> dict:
    result = dict(row.result, id=f"scan-{row.id}", timestamp=_timestamp(row.created_at), feedback=feedback)
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
        "feedback": feedback,
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

    try:
        app = create_app(model_path=args.model, extra_origins=args.allow_origin)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    uvicorn.run(app, host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
