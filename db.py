# -*- coding: utf-8 -*-
"""
Database models and session handling for the API.

DATABASE_URL selects the database, e.g.
    postgresql+psycopg://user:pass@localhost:5432/phishguard
It defaults to a local SQLite file for development.
"""

import os
from pathlib import Path
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    event,
    false,
    text,
)
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

DEFAULT_DATABASE_URL = "sqlite:///data/phishguard.db"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def database_url() -> str:
    return normalize_url(os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL))


def normalize_url(url: str) -> str:
    # Postgres URLs usually come as postgres:// or postgresql://; SQLAlchemy
    # needs the installed driver (psycopg 3) named explicitly.
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuthSession(Base):
    __tablename__ = "sessions"

    # SHA-256 of the cookie token; the raw token is never stored.
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Scan(Base):
    __tablename__ = "scans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    message: Mapped[str] = mapped_column(Text)
    prediction: Mapped[str] = mapped_column(String(16))
    probability: Mapped[float] = mapped_column(Float)
    risk_level: Mapped[str] = mapped_column(String(8))
    threshold: Mapped[float] = mapped_column(Float)
    model_name: Mapped[str] = mapped_column(String(100))
    # Full API response, so history shows exactly what the model returned.
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class PasswordReset(Base):
    __tablename__ = "password_resets"

    # SHA-256 of the emailed token; the raw token is never stored.
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Feedback(Base):
    """A user's verdict on one of their scans; feeds future training data."""

    __tablename__ = "feedback"
    __table_args__ = (UniqueConstraint("scan_id", name="uq_feedback_scan"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scan_id: Mapped[int] = mapped_column(ForeignKey("scans.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # What the message really was: "fraud" or "legit".
    correct_label: Mapped[str] = mapped_column(String(8))
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Database:
    def __init__(self, url: str | None = None):
        self.url = normalize_url(url) if url else database_url()
        parsed = make_url(self.url)
        connect_args = {}
        engine_options = {"pool_pre_ping": True}

        if parsed.get_backend_name() == "sqlite":
            # SQLAlchemy uses one connection per thread for file-backed SQLite.
            # An in-memory database must instead share one connection so the
            # migration connection and request threads see the same schema.
            memory_database = parsed.database in {None, "", ":memory:"}
            connect_args["check_same_thread"] = False
            if memory_database:
                engine_options["poolclass"] = StaticPool
            elif parsed.database:
                os.makedirs(os.path.dirname(parsed.database) or ".", exist_ok=True)

        self.engine = create_engine(self.url, connect_args=connect_args, **engine_options)
        if parsed.get_backend_name() == "sqlite":
            @event.listens_for(self.engine, "connect")
            def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
                cursor = dbapi_connection.cursor()
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.close()

        self.sessionmaker = sessionmaker(self.engine, expire_on_commit=False)

    def migrate(self):
        """Bring the schema up to date with Alembic (migrations/)."""
        from alembic import command
        from alembic.config import Config
        from sqlalchemy import inspect

        config = Config(str(Path(__file__).with_name("alembic.ini")))
        config.set_main_option("script_location", str(Path(__file__).with_name("migrations")))
        with self.engine.begin() as connection:
            # Serialize Alembic when multiple API workers start concurrently.
            if connection.dialect.name == "postgresql":
                connection.execute(text("SELECT pg_advisory_xact_lock(724198231)"))

            config.attributes["connection"] = connection
            inspector = inspect(connection)
            tables = set(inspector.get_table_names())
            if "users" in tables and "alembic_version" not in tables:
                # Compatibility with databases created by Base.metadata.create_all
                # before Alembic. Stamp only after verifying the complete 0001 shape;
                # a partial/custom "users" table must fail instead of being skipped.
                required_tables = {"users", "sessions", "scans"}
                later_schema_objects = {"feedback", "password_resets"}
                required_columns = {
                    "users": {"id", "email", "password_hash", "created_at"},
                    "sessions": {"token_hash", "user_id", "created_at", "expires_at"},
                    "scans": {
                        "id", "user_id", "message", "prediction", "probability",
                        "risk_level", "threshold", "model_name", "result", "created_at",
                    },
                }
                user_columns = {column["name"] for column in inspector.get_columns("users")}
                shape_matches = (
                    required_tables <= tables
                    and not (later_schema_objects & tables)
                    and "is_admin" not in user_columns
                    and all(
                        required_columns[table] <= {column["name"] for column in inspector.get_columns(table)}
                        for table in required_tables
                    )
                )
                if not shape_matches:
                    raise RuntimeError(
                        "Unversioned database does not match migration 0001; "
                        "back it up and stamp/upgrade it explicitly."
                    )
                command.stamp(config, "0001")
            command.upgrade(config, "head")
