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
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

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


class Database:
    def __init__(self, url: str | None = None):
        self.url = normalize_url(url) if url else database_url()
        connect_args = {}
        if self.url.startswith("sqlite"):
            path = self.url.removeprefix("sqlite:///")
            if path and path != ":memory:":
                os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            connect_args = {"check_same_thread": False}
        self.engine = create_engine(self.url, pool_pre_ping=True, connect_args=connect_args)
        self.sessionmaker = sessionmaker(self.engine, expire_on_commit=False)

    def migrate(self):
        """Bring the schema up to date with Alembic (migrations/)."""
        from alembic import command
        from alembic.config import Config
        from sqlalchemy import inspect

        config = Config(str(Path(__file__).with_name("alembic.ini")))
        config.set_main_option("script_location", str(Path(__file__).with_name("migrations")))
        with self.engine.begin() as connection:
            config.attributes["connection"] = connection
            tables = set(inspect(connection).get_table_names())
            if "users" in tables and "alembic_version" not in tables:
                # Created by create_all before migrations existed: it matches 0001.
                command.stamp(config, "0001")
            command.upgrade(config, "head")
