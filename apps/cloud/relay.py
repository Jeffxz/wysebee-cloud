"""Waking waiters across replicas — Postgres ``LISTEN``/``NOTIFY`` on :data:`NOTIFY_CHANNEL`
— for the browser link's queue (apps/cloud/browser_links.py), and this site's public address.

(It was once a relay to the person's desktops; its tables went with migration 0062.)
"""

import asyncio
import contextlib
import json
import logging
from collections.abc import Iterator

import psycopg
from fastapi import Request
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud.config import Settings

logger = logging.getLogger("wysebee.cloud.relay")

NOTIFY_CHANNEL = "wysebee_relay"
RECONNECT_MAX_SECONDS = 30.0
# Without LISTEN, waiters look again this often.
RECHECK_SECONDS = 1.0


class RelayHub:
    """This replica's listener for :data:`NOTIFY_CHANNEL`: wakes whoever waits on a key."""

    def __init__(self, settings: Settings) -> None:
        self._enabled = settings.config_events_listen
        url = make_url(settings.database_url)
        self._dsn = url.set(drivername="postgresql").render_as_string(hide_password=False)
        self._waiters: dict[str, set[asyncio.Event]] = {}
        self._task: asyncio.Task[None] | None = None
        self.listening = False

    def start(self) -> None:
        if self._enabled and self._task is None:
            self._task = asyncio.create_task(self._run(), name="relay-hub")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    @contextlib.contextmanager
    def subscribe(self, key: str) -> Iterator[asyncio.Event]:
        event = asyncio.Event()
        self._waiters.setdefault(key, set()).add(event)
        try:
            yield event
        finally:
            waiters = self._waiters.get(key)
            if waiters is not None:
                waiters.discard(event)
                if not waiters:
                    del self._waiters[key]

    def wake(self, key: str | None = None) -> None:
        """Wake one key's waiters, or everyone's (after a reconnect)."""
        groups = self._waiters.values() if key is None else [self._waiters.get(key, set())]
        for waiters in groups:
            for event in waiters:
                event.set()

    async def _run(self) -> None:
        delay = 1.0
        while True:
            try:
                async with await psycopg.AsyncConnection.connect(self._dsn, autocommit=True) as conn:
                    await conn.execute(f"LISTEN {NOTIFY_CHANNEL}")
                    self.listening = True
                    delay = 1.0
                    self.wake()
                    async for notice in conn.notifies():
                        try:
                            key = json.loads(notice.payload)["k"]
                        except (ValueError, KeyError, TypeError):
                            continue
                        self.wake(key)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — keep listening whatever happened
                logger.warning("relay hub disconnected: %s", exc)
            finally:
                self.listening = False
            await asyncio.sleep(delay)
            delay = min(delay * 2, RECONNECT_MAX_SECONDS)


async def _notify(session: AsyncSession, keys: list[str]) -> None:
    """Announce ``keys`` to every replica when this transaction commits."""
    for key in keys:
        await session.execute(
            text("SELECT pg_notify(:channel, :payload)"),
            {"channel": NOTIFY_CHANNEL, "payload": json.dumps({"k": key})},
        )


async def _wait(event: asyncio.Event, timeout: float) -> bool:
    """True when woken within ``timeout``."""
    try:
        await asyncio.wait_for(event.wait(), timeout=max(timeout, 0))
    except TimeoutError:
        return False
    return True


def public_base(request: Request) -> str:
    settings: Settings = request.app.state.settings
    if settings.public_url:
        return settings.public_url.rstrip("/")
    proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip() or request.url.scheme
    host = (
        request.headers.get("x-forwarded-host", "").split(",")[0].strip()
        or request.headers.get("host")
        or request.url.netloc
    )
    return f"{proto}://{host}"
