from alembic import context
from sqlalchemy import create_engine

from db import Base, database_url

target_metadata = Base.metadata


def run_migrations_offline():
    context.configure(url=database_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    # Database.migrate() passes its own connection; the CLI builds one from DATABASE_URL.
    connection = context.config.attributes.get("connection")
    if connection is not None:
        _run(connection)
        return
    with create_engine(database_url()).connect() as connection:
        _run(connection)


def _run(connection):
    context.configure(connection=connection, target_metadata=target_metadata,
                      render_as_batch=connection.dialect.name == "sqlite")
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
