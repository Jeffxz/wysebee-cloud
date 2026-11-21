"""PostgreSQL access: one async engine per process, a session per request."""

import asyncio
from collections.abc import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from apps.cloud.config import Settings


class Base(DeclarativeBase):
    """Declarative base for ORM models."""


class Database:
    def __init__(self, settings: Settings) -> None:
        # Creating the engine does not connect; the first query does.
        self.engine: AsyncEngine = create_async_engine(
            settings.database_url,
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            # Azure (and any proxy) drops idle connections; check before reuse.
            pool_pre_ping=True,
            pool_recycle=1800,
            echo=settings.db_echo,
            connect_args={"connect_timeout": 5},
        )
        self.sessionmaker = async_sessionmaker(self.engine, expire_on_commit=False)

    async def ping(self) -> None:
        async with self.engine.connect() as conn:
            await conn.execute(text("SELECT 1"))

    async def migration_revision(self) -> str | None:
        """The schema's Alembic revision; None before the first migration."""
        async with self.engine.connect() as conn:
            exists = await conn.scalar(text("SELECT to_regclass('alembic_version') IS NOT NULL"))
            if not exists:
                return None
            return await conn.scalar(text("SELECT version_num FROM alembic_version"))

    async def session(self) -> AsyncIterator[AsyncSession]:
        async with self.sessionmaker() as session:
            yield session

    async def dispose(self) -> None:
        await self.engine.dispose()


def raise_if_cancelled(exc: BaseException) -> None:
    """For a background loop that skips a round on any error: a cancel that landed mid-query
    comes back from psycopg as a query-cancelled error, an ordinary Exception. Raise it as the
    cancel it is, or the loop sleeps on and the app's shutdown waits for it for ever."""
    task = asyncio.current_task()
    if task is not None and task.cancelling():
        raise asyncio.CancelledError from exc
