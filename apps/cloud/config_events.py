"""``GET /api/v1/configs/events``: a live feed of a person's changes.

The website keeps this open while signed in, so an edit made in one tab (or by the cloud
itself: a pairing, a Mac's folders, a task the AI app saved) shows up in the others within a
second instead of on the next poll.

**Server-sent events** (``text/event-stream``)::

    event: hello            data: {"revision": 1041}
    id: 1043
    event: changes          data: {"revision": 1043, "changes": []}
    event: activity         data: {"unread": 3}
    : ping

A ``changes`` frame says the person's revision moved (apps/cloud/changes.py): one of their
agents or tasks was saved or deleted. It names nothing (``changes`` is always empty since
cloud items went, migration 0065): the client reads again what it shows, with its own
token's rights. Its ``id`` is the revision, so a client resumes with ``Last-Event-ID`` (or
``?since=``) and misses nothing.

``activity``: the person's unread notifications (apps/cloud/notifications.py) changed since
the stream opened — sent with the new count, never the notifications themselves.

**Auth** is the usual Bearer token. Browsers read this with ``fetch`` streaming, not
``EventSource``, which cannot send a header. The stream ends at the token's expiry (or
after ``config_events_max_seconds``, under Azure Container Apps' ingress limits); the
client reconnects with a fresh token and its cursor. A ping every
``config_events_heartbeat_seconds`` keeps proxies from closing an idle stream and lets
the client notice a dead one.

**Across replicas**: every write ``pg_notify``s :data:`~apps.cloud.changes.NOTIFY_CHANNEL`
inside its transaction (Postgres delivers it on commit, to every listener). Each replica
runs one :class:`ChangeHub` holding a dedicated connection that ``LISTEN``s and wakes
the streams of the person who changed something. That connection must reach Postgres
directly — not through PgBouncer in transaction mode, which drops ``LISTEN``. If it
cannot listen, streams still notice changes on their next heartbeat.
"""

import asyncio
import contextlib
import json
import logging
import time
from collections.abc import AsyncIterator, Iterator
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.engine import make_url

from apps.cloud.auth import User, current_user
from apps.cloud.config import Settings
from apps.cloud.changes import NOTIFY_CHANNEL, head as head_of
from apps.cloud.notifications import unread_of

logger = logging.getLogger("wysebee.cloud.config_events")

router = APIRouter(prefix="/v1", tags=["Cloud items"])

RECONNECT_MAX_SECONDS = 30.0


def frame(event: str, data: dict[str, Any], event_id: int | None = None) -> str:
    head = f"id: {event_id}\n" if event_id is not None else ""
    return f"{head}event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"


class ChangeHub:
    """This replica's listener: wakes the open streams of whoever changed something."""

    def __init__(self, settings: Settings) -> None:
        self._enabled = settings.config_events_listen
        url = make_url(settings.database_url)
        self._dsn = url.set(drivername="postgresql").render_as_string(hide_password=False)
        self._subscribers: dict[str, set[asyncio.Event]] = {}
        self._task: asyncio.Task[None] | None = None
        self.listening = False

    def start(self) -> None:
        if self._enabled and self._task is None:
            self._task = asyncio.create_task(self._run(), name="config-change-hub")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    @contextlib.contextmanager
    def subscribe(self, user_id: str) -> Iterator[asyncio.Event]:
        event = asyncio.Event()
        self._subscribers.setdefault(user_id, set()).add(event)
        try:
            yield event
        finally:
            subs = self._subscribers.get(user_id)
            if subs is not None:
                subs.discard(event)
                if not subs:
                    del self._subscribers[user_id]

    def wake(self, user_id: str | None = None) -> None:
        """Wake one person's streams, or everyone's (after a reconnect, when notices
        may have been missed)."""
        groups = self._subscribers.values() if user_id is None else [self._subscribers.get(user_id, set())]
        for subs in groups:
            for event in subs:
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
                            user_id = json.loads(notice.payload)["u"]
                        except (ValueError, KeyError, TypeError):
                            continue
                        self.wake(user_id)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — keep listening whatever happened
                logger.warning("change hub disconnected: %s", exc)
            finally:
                self.listening = False
            await asyncio.sleep(delay)
            delay = min(delay * 2, RECONNECT_MAX_SECONDS)


def _cursor(since: int | None, last_event_id: str | None) -> int | None:
    if last_event_id and last_event_id.strip().isdigit():
        return int(last_event_id.strip())
    return since


async def _unread(request: Request, user: User) -> int:
    async with request.app.state.db.sessionmaker() as session:
        return await unread_of(session, user.sub)


async def _head(request: Request, user: User) -> int:
    """The person's revision, in one short-lived session — a stream holds no database
    connection while it waits."""
    async with request.app.state.db.sessionmaker() as session:
        return await head_of(session, user.sub)


@router.get("/configs/events")
async def config_events(
    request: Request,
    since: int | None = None,
    user: User = Depends(current_user),
    last_event_id: str | None = Header(default=None),
) -> StreamingResponse:
    settings: Settings = request.app.state.settings
    hub: ChangeHub = request.app.state.change_hub
    started = time.monotonic()
    lifetime = settings.config_events_max_seconds
    if user.expires_at:
        lifetime = min(lifetime, user.expires_at - time.time())
    deadline = started + max(lifetime, 0)
    start_cursor = _cursor(since, last_event_id)

    async def stream() -> AsyncIterator[str]:
        cursor = start_cursor
        with hub.subscribe(user.sub) as woken:
            head = await _head(request, user)
            # The page reads its count when it loads: only a change from here is sent.
            unread = await _unread(request, user)
            yield frame("hello", {"revision": head})
            if cursor is None:
                cursor = head
            while True:
                # Cleared before reading, so a change committing meanwhile wakes the next wait.
                woken.clear()
                head = await _head(request, user)
                if head > cursor:
                    cursor = head
                    yield frame("changes", {"revision": cursor, "changes": []}, cursor)
                now_unread = await _unread(request, user)
                if now_unread != unread:
                    unread = now_unread
                    yield frame("activity", {"unread": unread})
                remaining = deadline - time.monotonic()
                if remaining <= 0 or await request.is_disconnected():
                    return
                try:
                    await asyncio.wait_for(
                        woken.wait(), timeout=min(settings.config_events_heartbeat_seconds, remaining)
                    )
                except TimeoutError:
                    if await request.is_disconnected():
                        return
                    yield ": ping\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
