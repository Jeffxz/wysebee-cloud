"""``POST /v1/events``: the site's usage events, kept in Postgres and forwarded to Mixpanel.

Until 2026-11-15 the landing page (ui/cloud analytics.ts) and the web app (ui/app telemetry.ts)
posted their events straight to Mixpanel. Now both post them here, and each one is:

1. **Kept** in ``usage_events`` (:class:`~apps.cloud.models.UsageEvent`), so they can be
   searched with SQL: by person, event name, time, page, or ``properties @> '{…}'``.
2. **Forwarded to Mixpanel** after the answer, when ``WYSEBEE_MIXPANEL_TOKEN`` names a project,
   with the properties the pages used to send (``distinct_id``, ``$insert_id``, ``session_id``,
   ``page``, ``surface``…), so the reports there carry on. A failure there is logged and the
   batch is not sent again; the rows are kept all the same.

**Who**: the signed-in person's Auth0 ``sub``, read from their token, never from the body. Before
sign-in the landing page posts without a token and gives the random ``anonymous_id`` it keeps in
the browser; Mixpanel gets it as ``$device_id``, so a later signed-in event with the same id
joins the two. A token that is given must be valid (401).

**What is kept**: what the page did — the event's name, its few properties (a click's label, a
count), the masked route, the app version and language. The pages mask names, typed text, emails,
URLs and ids before anything is sent (telemetry.ts: ``redact``, ``pageName``,
``data-track-private``); this route also drops ``$``-prefixed properties and the names it sets
itself, and keeps no properties at all over 8 KB. Neither the person's address nor their name or
email is stored; the address goes to Mixpanel as ``ip`` (for the country, as the pages' own posts
gave it).

**Limits**: at most :data:`MAX_EVENTS` events a batch, and ``events_batches_per_minute`` batches a
minute for each person or, before sign-in, each address (429). Kept ``events_retention_days``
(13 months) by when they happened (:func:`purge_often`), and deleted with the account.
``WYSEBEE_EVENTS_ENABLED=false`` turns it all off (404; the pages then send nothing).
"""

import asyncio
import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud.auth import User, current_user
from apps.cloud.browser_links import _client_address
from apps.cloud.config import Settings
from apps.cloud.db import raise_if_cancelled
from apps.cloud.deps import get_session
from apps.cloud.models import UsageEvent

logger = logging.getLogger("wysebee.cloud.usage_events")

router = APIRouter(prefix="/v1", tags=["Usage events"])

# Mixpanel's /track takes at most 50 events a request.
MAX_EVENTS = 50
# The largest an event's properties may be, serialised (as the pages' own limit).
PROPS_MAX_BYTES = 8 * 1024
# Names this route sets for Mixpanel: a page's properties cannot.
OWNED = frozenset({
    "token", "distinct_id", "user_id", "time", "ip", "session_id", "app_version", "surface", "language", "page",
})
# A page's clock is believed within these bounds of when its batch arrived.
PAST = timedelta(days=7)
FUTURE = timedelta(hours=1)
MIXPANEL_HOST = "https://api.mixpanel.com"

_bearer = HTTPBearer(auto_error=False)


class EventIn(BaseModel):
    event: str = Field(min_length=1, max_length=100, description="What happened: \"Click\", \"Page Viewed\"…")
    time: int | None = Field(default=None, description="When, in milliseconds since 1970 (the page's clock); null = on arrival")
    insert_id: str | None = Field(default=None, max_length=64, description="The page's id for the event (Mixpanel's $insert_id)")
    session_id: str | None = Field(default=None, max_length=64, description="One page load, or one visit")
    page: str | None = Field(default=None, max_length=200, description="The route with names and ids masked")
    properties: dict[str, Any] = Field(default_factory=dict, description="The event's own properties; none kept over 8 KB")


class EventBatch(BaseModel):
    surface: Literal["web", "landing"] = Field(description="\"web\": the web app at /app/; \"landing\": the front page")
    anonymous_id: str | None = Field(default=None, min_length=8, max_length=64, description="The browser's random id; needed without a token")
    app_version: str | None = Field(default=None, max_length=32)
    language: str | None = Field(default=None, max_length=35)
    events: list[EventIn] = Field(min_length=1, max_length=MAX_EVENTS)


async def caller(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> User | None:
    """The signed-in person when a token is given (which must be valid), else nobody."""
    if credentials is None:
        return None
    return await current_user(request, credentials)


def clean(props: dict[str, Any]) -> dict[str, Any]:
    """A page's properties without ``$`` keys or the names set here, and none at all when too large."""
    kept = {k: v for k, v in props.items() if not k.startswith("$") and k not in OWNED}
    return kept if len(json.dumps(kept, separators=(",", ":"), default=str)) <= PROPS_MAX_BYTES else {}


def occurred(ms: int | None, now: datetime) -> datetime:
    """When the page says it happened, unless its clock is out by more than :data:`PAST` /
    :data:`FUTURE`: then on arrival."""
    if ms is None:
        return now
    try:
        when = datetime.fromtimestamp(ms / 1000, UTC)
    except (OverflowError, OSError, ValueError):
        return now
    return when if now - PAST <= when <= now + FUTURE else now


def to_mixpanel(row: UsageEvent, token: str, address: str) -> dict[str, Any]:
    """One stored event as Mixpanel's /track takes it, with the properties the pages used to send."""
    props: dict[str, Any] = {
        **row.properties,
        "token": token,
        "time": int(row.occurred_at.timestamp() * 1000),
        "$insert_id": row.insert_id,
        "surface": row.surface,
        "ip": address,
    }
    for name in ("session_id", "page", "app_version", "language"):
        value = getattr(row, name)
        if value:
            props[name] = value
    if row.anonymous_id:
        props["$device_id"] = row.anonymous_id
    if row.user_id:
        props["distinct_id"] = props["$user_id"] = props["user_id"] = row.user_id
    else:
        props["distinct_id"] = f"$device:{row.anonymous_id}"
    return {"event": row.event, "properties": props}


async def forward(http: httpx.AsyncClient, settings: Settings, events: list[dict[str, Any]]) -> None:
    """Send a batch on to Mixpanel's /track. Never raises: a failure is logged and dropped."""
    host = (settings.mixpanel_api_host or MIXPANEL_HOST).rstrip("/")
    try:
        # ip=0: the server's own address is not the person's; each event names theirs as `ip`.
        r = await http.post(f"{host}/track", params={"ip": "0", "verbose": "1"}, json=events)
        if r.status_code >= 400:
            logger.warning("Mixpanel refused %d events: %s %s", len(events), r.status_code, r.text[:200])
    except httpx.HTTPError as exc:
        logger.warning("Mixpanel unreachable, %d events not forwarded: %s", len(events), exc)


@router.post("/events", status_code=204, response_class=Response, responses={
    401: {"description": "A token was given and is not valid"},
    404: {"description": "Usage events are off here (WYSEBEE_EVENTS_ENABLED=false)"},
    422: {"description": "Not a batch, or neither a token nor an anonymous_id"},
    429: {"description": "Too many batches this minute"},
})
async def post_events(
    batch: EventBatch,
    request: Request,
    background: BackgroundTasks,
    user: User | None = Depends(caller),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Keep a page's batch of usage events, then forward it to Mixpanel."""
    settings: Settings = request.app.state.settings
    if not settings.events_enabled:
        raise HTTPException(status_code=404, detail="Usage events are off here.")
    if user is None and not batch.anonymous_id:
        raise HTTPException(status_code=422, detail="Sign in, or give an anonymous_id.")
    address = _client_address(request)
    if not request.app.state.event_batches.allow(f"user:{user.sub}" if user else f"address:{address}"):
        raise HTTPException(status_code=429, detail="Too many usage events; try again in a minute.")
    now = datetime.now(UTC)
    rows = [
        UsageEvent(
            occurred_at=occurred(e.time, now), received_at=now, event=e.event,
            user_id=user.sub if user else None, anonymous_id=batch.anonymous_id, session_id=e.session_id,
            insert_id=e.insert_id or f"{now.timestamp():.6f}-{i}", surface=batch.surface, page=e.page,
            app_version=batch.app_version, language=batch.language, properties=clean(e.properties),
        )
        for i, e in enumerate(batch.events)
    ]
    session.add_all(rows)
    await session.commit()
    if settings.mixpanel_token:
        events = [to_mixpanel(row, settings.mixpanel_token, address) for row in rows]
        # After answering, so a slow Mixpanel never holds up the page.
        background.add_task(forward, request.app.state.events_http, settings, events)
    return Response(status_code=204)


async def purge(session: AsyncSession, settings: Settings, now: datetime | None = None) -> int:
    """Delete events older than ``events_retention_days`` (0: none); how many went."""
    if settings.events_retention_days <= 0:
        return 0
    cutoff = (now or datetime.now(UTC)) - timedelta(days=settings.events_retention_days)
    result = await session.execute(delete(UsageEvent).where(UsageEvent.occurred_at < cutoff))
    await session.commit()
    return result.rowcount or 0


async def purge_often(db: Any, settings: Settings) -> None:
    """:func:`purge` every ``events_purge_seconds``. Never raises: a database outage just skips a round."""
    while True:
        try:
            async with db.sessionmaker() as session:
                removed = await purge(session, settings)
            if removed:
                logger.info("deleted %d usage events past their keeping time", removed)
        except Exception as exc:  # noqa: BLE001
            raise_if_cancelled(exc)
            logger.warning("usage event purge skipped: %s", exc)
        await asyncio.sleep(settings.events_purge_seconds)
