"""Alembic environment: async, URL from the app's settings, models from apps.cloud.models."""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from apps.cloud import models  # noqa: F401 — registers tables on Base.metadata
from apps.cloud.config import get_settings
from apps.cloud.db import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata
# Tests (and anyone scripting this) can pass a URL with `-x url=...` or config attributes.
database_url = config.attributes.get("url") or context.get_x_argument(as_dictionary=True).get("url") or get_settings().database_url


def run_migrations_offline() -> None:
    context.configure(url=database_url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def _run(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        # Several replicas starting at once (Azure scale-out) must not migrate
        # concurrently: the first takes the lock, the rest wait and find nothing to do.
        connection.exec_driver_sql("SELECT pg_advisory_xact_lock(727372)")
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(database_url, poolclass=pool.NullPool)
    async with engine.connect() as connection:
        await connection.run_sync(_run)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
