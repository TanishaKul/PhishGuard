# -*- coding: utf-8 -*-
"""
Admin tasks against the app database (DATABASE_URL, see db.py).

    python manage.py make-admin you@example.com
    python manage.py remove-admin you@example.com
    python manage.py migrate
"""

import argparse
import sys

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from auth import normalize_email
from db import Database, User


def set_admin(db: Database, email: str, value: bool) -> int:
    with db.sessionmaker() as session:
        user = session.scalar(select(User).where(User.email == normalize_email(email)))
        if user is None:
            print(f"error: no account with email {email}; sign up in the app first", file=sys.stderr)
            return 1
        user.is_admin = value
        session.commit()
    print(f"{user.email} is {'now' if value else 'no longer'} an admin.")
    return 0


def main():
    parser = argparse.ArgumentParser(description="PhishGuard admin tasks")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("make-admin", "remove-admin"):
        sub.add_parser(name).add_argument("email")
    sub.add_parser("migrate", help="apply database migrations")
    args = parser.parse_args()

    db = Database()
    try:
        if args.command == "migrate":
            db.migrate()
            print("Database is up to date.")
            return 0
        return set_admin(db, args.email, args.command == "make-admin")
    except SQLAlchemyError as exc:
        print(f"error: database {db.url.split('@')[-1]} unavailable: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
