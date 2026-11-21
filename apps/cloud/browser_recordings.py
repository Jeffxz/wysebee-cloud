"""Browser recordings: the scenario videos an agent films with ``browser_record``.

The Wysebee Agent extension films a tab while the agent runs a scenario (``browser_record``
start … stop, an op like any other: apps/cloud/browser_links.py), saves the WebM to the
person's Downloads, and **uploads it here itself**, with its link's secret — the video never
passes through a browser call. The person lists and replays them with their own sign-in.

- ``POST /browser-links/{id}/recordings?name=&started_at=&duration_ms=&origin=&call_id=``
  (also under ``/agent-links``) — the extension's: ``Authorization: Bearer <secret>`` as for
  ``/poll``, the raw WebM as the body (``Content-Type: video/webm``), at most
  ``WYSEBEE_RECORDING_MAX_BYTES`` (413 above). Only a claimed link whose type lists
  ``browser_record`` may upload, and a person keeps at most ``WYSEBEE_RECORDING_MAX_COUNT``
  (409 ``too_many_recordings``) and no more than their storage quota (apps/cloud/storage.py;
  409 ``storage_full``, before or during the upload). 201 with the recording (its ``id`` first
  among them).
- ``GET /browser-recordings?agent_id=&limit=`` — the person's, newest first:
  ``{"recordings": [...]}``.
- ``GET /browser-recordings/{id}`` — one.
- ``GET /browser-recordings/{id}/video`` — the WebM, streamed; a ``Range: bytes=…`` request
  gets that part (206), so a player can seek.
- ``DELETE /browser-recordings/{id}`` — gone, video and row (204).

The video is in the recording store (apps/cloud/recording_storage.py), the row in
``browser_recordings`` (migration 0082). Recordings outlive the link (unpairing keeps them)
and the agent (``agent_id`` cleared); they count towards the person's storage
(apps/cloud/storage.py) and go with their account (apps/cloud/account_deletion.py).
Errors are the browser link's: ``{"detail", "code"}``.
"""

import logging
import re
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, Path, Query, Request
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import func, select

from apps.cloud import agent_types, storage, traffic
from apps.cloud.auth import User, current_user
from apps.cloud.browser_links import PREFIXES, LinkId, Refused, _extension_link
from apps.cloud.config import Settings
from apps.cloud.models import BrowserRecording
from apps.cloud.recording_storage import (
    CONTENT_TYPE,
    AzureBlobRecordingStore,
    FileRecordingStore,
    RecordingStore,
    TooLarge,
)

logger = logging.getLogger(__name__)

OP = "browser_record"
MAX_NAME = 120
MAX_ORIGIN = 255
# A day: no recording is longer (the extension stops one after 15 minutes).
MAX_DURATION_MS = 24 * 3600 * 1000
CALL_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
RecordingId = Path(pattern=r"^[0-9a-f]{32}$")
RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")
UUID_TEXT = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

GONE = "That recording is not there any more."
NOT_A_RECORDER = "This device cannot upload recordings."
NOT_CLAIMED = "This browser is not paired with a Wysebee account yet."
STORAGE_FULL = "Your Wysebee storage is full: delete some recordings or files in Wysebee first."


def make_recording_store(settings: Settings) -> RecordingStore:
    """The asset store's kind and account, a container (or folder) of their own."""
    if settings.asset_store == "azure":  # pragma: no cover - needs Azure
        if not settings.asset_account_url:
            raise RuntimeError("WYSEBEE_ASSET_STORE=azure needs WYSEBEE_ASSET_AZURE_ACCOUNT_URL (or WYSEBEE_BACKUP_AZURE_ACCOUNT_URL).")
        return AzureBlobRecordingStore.from_account_url(settings.asset_account_url, settings.recording_azure_container)
    return FileRecordingStore(settings.recording_dir)


def _out(r: BrowserRecording) -> dict[str, Any]:
    return {
        "id": r.id,
        "name": r.name,
        "agent_id": r.agent_id,
        "link_id": r.link_id,
        "started_at": r.started_at.isoformat(),
        "duration_ms": r.duration_ms,
        "origin": r.origin,
        "call_id": r.call_id,
        "size": r.size,
        "content_type": CONTENT_TYPE,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _bad(field: str, what: str) -> Refused:
    return Refused(422, "invalid_recording", f"'{field}' {what}")


def _started(value: str) -> datetime:
    try:
        when = datetime.fromisoformat(value.strip())
    except ValueError:
        raise _bad("started_at", "must be a date and time, such as 2026-11-19T10:00:00Z.") from None
    return when if when.tzinfo else when.replace(tzinfo=UTC)


def _duration(value: str) -> int:
    if not value.strip().isdigit() or int(value) > MAX_DURATION_MS:
        raise _bad("duration_ms", f"must be a whole number of milliseconds, 0 to {MAX_DURATION_MS}.")
    return int(value)


# --- the extension's upload --------------------------------------------------------------------

uploads = APIRouter()


@uploads.post("/{link_id}/recordings", status_code=201)
async def upload(
    request: Request,
    link_id: str = LinkId,
    name: str = Query(default=""),
    started_at: str = Query(default=""),
    duration_ms: str = Query(default=""),
    origin: str | None = Query(default=None),
    call_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """One scenario video, the request's body, from the extension the link is."""
    state = request.app.state
    s: Settings = state.settings
    store: RecordingStore = state.recording_store
    title = re.sub(r"\s+", " ", name).strip()
    if len(title) > MAX_NAME:
        raise _bad("name", f"is at most {MAX_NAME} characters.")
    started, duration = _started(started_at), _duration(duration_ms)
    origin = (origin or "").strip() or None
    if origin is not None and len(origin) > MAX_ORIGIN:
        raise _bad("origin", f"is at most {MAX_ORIGIN} characters.")
    if call_id is not None and not CALL_ID.match(call_id):
        raise _bad("call_id", "is a browser call's id.")
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type != CONTENT_TYPE:
        raise Refused(415, "not_webm", "A recording is sent as video/webm.")
    too_big = Refused(413, "too_big", f"A recording is at most {s.recording_max_bytes} bytes.")
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > s.recording_max_bytes:
        raise too_big
    # Who it is — checked, then the database let go of for the length of the upload.
    async with state.db.sessionmaker() as session, session.begin():
        link = await _extension_link(session, request, link_id)
        if link.user_id is None:
            raise Refused(409, "not_claimed", NOT_CLAIMED)
        kind = await agent_types.by_id(session, link.agent_type_id)
        if kind is None or OP not in kind.ops:
            raise Refused(422, "invalid_op", NOT_A_RECORDER)
        held = await session.scalar(select(func.count()).select_from(BrowserRecording).where(BrowserRecording.user_id == link.user_id))
        if held >= s.recording_max_count:
            raise Refused(409, "too_many_recordings", f"At most {s.recording_max_count} recordings are kept: delete some in Wysebee first.")
        # Within the person's storage quota: a device sends these, so it is held to what is left.
        left = await storage.room_left(session, state, link.user_id)
        user_id, agent_id = link.user_id, link.agent_id
    full = Refused(409, "storage_full", STORAGE_FULL)
    if left <= 0 or (declared.isdigit() and int(declared) > left):
        raise full
    recording_id = uuid.uuid4().hex
    try:
        size = await store.write(user_id, recording_id, request.stream(), min(s.recording_max_bytes, left))
    except TooLarge:
        raise (full if left < s.recording_max_bytes else too_big) from None
    if size == 0:
        await store.delete(user_id, recording_id)
        raise Refused(422, "empty_recording", "The recording was empty.")
    try:
        async with state.db.sessionmaker() as session, session.begin():
            row = BrowserRecording(
                id=recording_id, user_id=user_id, link_id=link_id, agent_id=agent_id, name=title or "scenario",
                started_at=started, duration_ms=duration, origin=origin, call_id=call_id, size=size,
                created_at=datetime.now(UTC),
            )
            session.add(row)
            await session.flush()
            out = _out(row)
    except BaseException:
        await store.delete(user_id, recording_id)
        raise
    # The video came through the relay from the device (apps/cloud/traffic.py).
    await traffic.add_now(request.app.state, user_id, size)
    logger.info("browser recording stored (%d bytes)", size)
    return out


# --- the person's ------------------------------------------------------------------------------

mine = APIRouter(prefix="/v1/browser-recordings", tags=["Browser recordings"])


async def _own(state: Any, user_id: str, recording_id: str) -> BrowserRecording:
    async with state.db.sessionmaker() as session:
        row = await session.scalar(select(BrowserRecording).where(BrowserRecording.id == recording_id, BrowserRecording.user_id == user_id))
    if row is None:
        raise Refused(404, "recording_gone", GONE)
    return row


@mine.get("")
async def list_recordings(
    request: Request,
    agent_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    user: User = Depends(current_user),
) -> dict[str, Any]:
    """The person's recordings, newest first; ``agent_id``: only that agent's."""
    if agent_id and not UUID_TEXT.match(agent_id):
        return {"recordings": []}  # no agent has that id
    query = select(BrowserRecording).where(BrowserRecording.user_id == user.sub)
    if agent_id:
        query = query.where(BrowserRecording.agent_id == agent_id)
    query = query.order_by(BrowserRecording.created_at.desc(), BrowserRecording.id).limit(limit)
    async with request.app.state.db.sessionmaker() as session:
        rows = (await session.scalars(query)).all()
    return {"recordings": [_out(r) for r in rows]}


@mine.get("/{recording_id}")
async def get_recording(request: Request, recording_id: str = RecordingId, user: User = Depends(current_user)) -> dict[str, Any]:
    return _out(await _own(request.app.state, user.sub, recording_id))


def _part(header: str | None, size: int) -> tuple[int, int] | None:
    """The one byte range a ``Range`` header asks for, as (start, end inclusive); None for
    the whole video (no header, or one this does not serve: several ranges, other units).
    :class:`ValueError` when it asks for nothing there is."""
    m = RANGE.match((header or "").strip())
    if m is None:
        return None
    first, last = m.groups()
    if not first and not last:
        return None
    if not first:  # the last N bytes
        n = int(last)
        if n == 0 or size == 0:
            raise ValueError
        return max(size - n, 0), size - 1
    start = int(first)
    end = min(int(last), size - 1) if last else size - 1
    if start >= size or end < start:
        raise ValueError
    return start, end


@mine.get("/{recording_id}/video")
async def video(request: Request, recording_id: str = RecordingId, user: User = Depends(current_user)) -> Response:
    """The WebM itself, or the part a ``Range`` asks for."""
    state = request.app.state
    store: RecordingStore = state.recording_store
    row = await _own(state, user.sub, recording_id)
    size = await store.size(user.sub, recording_id)
    if size is None:
        raise Refused(404, "recording_gone", GONE)
    slug = re.sub(r"[^\w.-]+", "-", row.name).strip("-.")[:80] or "scenario"
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Disposition": f"inline; filename*=UTF-8''{quote(slug)}.webm",
        "Cache-Control": "private, max-age=3600",
    }
    try:
        part = _part(request.headers.get("range"), size)
    except ValueError:
        return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{size}"})
    start, end = part if part is not None else (0, size - 1)
    length = max(end - start + 1, 0)
    headers["Content-Length"] = str(length)
    if part is not None:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"

    async def body() -> AsyncIterator[bytes]:
        async for piece in store.read(user.sub, recording_id, start, length):
            yield piece

    return StreamingResponse(body(), status_code=206 if part is not None else 200, media_type=CONTENT_TYPE, headers=headers)


@mine.delete("/{recording_id}", status_code=204)
async def delete_recording(request: Request, recording_id: str = RecordingId, user: User = Depends(current_user)) -> Response:
    state = request.app.state
    await _own(state, user.sub, recording_id)
    await state.recording_store.delete(user.sub, recording_id)
    async with state.db.sessionmaker() as session, session.begin():
        row = await session.get(BrowserRecording, recording_id)
        if row is not None and row.user_id == user.sub:
            await session.delete(row)
    return Response(status_code=204)


router = APIRouter()
router.include_router(uploads, prefix=PREFIXES[0], tags=["Browser link"])
router.include_router(uploads, prefix=PREFIXES[1], tags=["Agent link"])
router.include_router(mine)
