"""Each person's **relay traffic**, per calendar month (2026-11-21): the bytes that pass through
Wysebee Cloud between their AI app and their devices — a usage statistic, which a deployment's
extension may limit (apps/cloud/extensions.py, ``may_call``).

**What counts** (apps/cloud/browser_links.py, apps/cloud/browser_recordings.py):

- a call's arguments, as sent to the device (their JSON);
- its result, as the device posts it (the body's bytes);
- a skill file a Mac downloads;
- a recording a browser uploads.

A poll's own status and the server's bookkeeping are not counted: only what the person's work
carries.

**Per calendar month, UTC** (``YYYY-MM``): one row per person and month in ``relay_traffic``,
added to in one statement (an upsert, so replicas never lose a count). A new month is a new
row, so the count starts over at 00:00 UTC on the 1st. Counting is best effort — a database
that cannot be written logs a warning and the device's work goes on.
"""

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud.models import RelayTraffic

logger = logging.getLogger("wysebee.cloud.traffic")


def month_of(now: datetime | None = None) -> str:
    """The calendar month a moment falls in, in UTC: ``2026-11``."""
    return (now or datetime.now(UTC)).astimezone(UTC).strftime("%Y-%m")


def next_month(now: datetime | None = None) -> datetime:
    """When the count starts over: the first instant of the next calendar month, UTC."""
    t = (now or datetime.now(UTC)).astimezone(UTC)
    return datetime(t.year + (t.month == 12), t.month % 12 + 1, 1, tzinfo=UTC)


def _upsert(user_id: str, n: int, at: datetime) -> Any:
    statement = insert(RelayTraffic).values(user_id=user_id, month=month_of(at), bytes=n, updated_at=at)
    return statement.on_conflict_do_update(
        index_elements=[RelayTraffic.user_id, RelayTraffic.month],
        set_={"bytes": RelayTraffic.bytes + n, "updated_at": at},
    )


async def add(session: AsyncSession, user_id: str | None, n: int, now: datetime | None = None) -> None:
    """``n`` more bytes for ``user_id`` this month, in the caller's transaction (committed with it)."""
    if user_id and n > 0:
        await session.execute(_upsert(user_id, n, now or datetime.now(UTC)))


async def add_now(state: Any, user_id: str | None, n: int, now: datetime | None = None) -> None:
    """``n`` more bytes for ``user_id`` this month, in a transaction of its own. Never raises."""
    if not user_id or n <= 0:
        return
    try:
        async with state.db.sessionmaker() as session:
            await session.execute(_upsert(user_id, n, now or datetime.now(UTC)))
            await session.commit()
    except Exception as exc:  # noqa: BLE001 — a count must never cost the device its work
        logger.warning("relay_traffic_count_failed: %s", type(exc).__name__)


async def used(session: AsyncSession, user_id: str, now: datetime | None = None) -> int:
    """``user_id``'s bytes this month (0 before any)."""
    row = await session.get(RelayTraffic, (user_id, month_of(now)))
    return row.bytes if row is not None else 0
