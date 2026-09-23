# -*- coding: utf-8 -*-
"""
Password hashing, login sessions and login rate limiting (standard library only).
"""

import base64
import hashlib
import hmac
import re
import secrets
import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone

SESSION_COOKIE = "pg_session"
SESSION_TTL = timedelta(days=7)

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 256
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# scrypt cost parameters (~50 ms per hash on a laptop).
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P)
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        candidate = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt),
                                   n=int(n), r=int(r), p=int(p))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(candidate, base64.b64decode(digest))


# A valid hash to verify against when the email is unknown, so a login attempt
# takes the same time whether or not the account exists.
DUMMY_HASH = hash_password(secrets.token_hex(8))


def new_session_token() -> tuple[str, str, datetime]:
    """(token for the cookie, its SHA-256 for the database, expiry)."""
    token = secrets.token_urlsafe(32)
    return token, hash_token(token), datetime.now(timezone.utc) + SESSION_TTL


RESET_TTL = timedelta(hours=1)


def new_reset_token() -> tuple[str, str, datetime]:
    """(token for the emailed link, its SHA-256 for the database, expiry)."""
    token = secrets.token_urlsafe(32)
    return token, hash_token(token), datetime.now(timezone.utc) + RESET_TTL


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def normalize_email(email: str) -> str:
    return email.strip().lower()


def validate_credentials(email: str, password: str) -> str | None:
    """A user-facing reason the credentials are unacceptable, or None."""
    if len(email) > 254 or not EMAIL_RE.match(email):
        return "Enter a valid email address."
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
    if len(password) > MAX_PASSWORD_LENGTH:
        return f"Password must be at most {MAX_PASSWORD_LENGTH} characters."
    return None


class LoginRateLimiter:
    """Bounded, atomic per-key failure limiter for one process."""

    def __init__(self, max_failures: int = 5, window_seconds: int = 900,
                 max_keys: int = 10_000):
        self.max_failures = max_failures
        self.window = window_seconds
        self.max_keys = max_keys
        self._failures: dict[str, deque] = {}
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> deque:
        attempts = self._failures.get(key)
        if attempts is None:
            return deque()
        while attempts and now - attempts[0] > self.window:
            attempts.popleft()
        if not attempts:
            self._failures.pop(key, None)
            attempts = deque()
        return attempts

    def _prune_all(self, now: float) -> None:
        for key in list(self._failures):
            self._prune(key, now)

    def retry_after(self, key: str) -> int | None:
        """Seconds until the key may try again, or None if it is not blocked."""
        now = time.monotonic()
        with self._lock:
            attempts = self._prune(key, now)
            if len(attempts) < self.max_failures:
                return None
            return max(1, int(self.window - (now - attempts[0])))

    def reserve_failure(self, key: str) -> int | None:
        """Atomically record one attempt and return a retry delay when blocked.

        Reserving before password verification closes the check-then-record
        race. A successful login resets the key, so legitimate users are not
        penalized for earlier failures.
        """
        now = time.monotonic()
        with self._lock:
            self._prune_all(now)
            attempts = self._prune(key, now)
            if key not in self._failures and len(self._failures) >= self.max_keys:
                # Bound memory under unique-key flooding. This key is allowed
                # once; the oldest idle key is evicted first.
                oldest = min(self._failures, key=lambda k: self._failures[k][0])
                self._failures.pop(oldest, None)
            self._failures.setdefault(key, deque()).append(now)
            if len(attempts) > self.max_failures:
                return max(1, int(self.window - (now - attempts[0])))
            return None

    def reset(self, key: str):
        with self._lock:
            self._failures.pop(key, None)
