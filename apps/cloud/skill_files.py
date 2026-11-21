"""Skill files: the files of the person's skills, private to their owner.

A skill is a folder — a ``SKILL.md`` and whatever it needs, scripts included. Its name,
description and the list of its files are a ``user_skills`` row (apps/cloud/skills.py; a
``skill`` cloud item until migration 0060); the files themselves are kept here, under the
owner's id. The website never sends a file that looks like a secret (``.env``, keys,
certificates, credentials) — that is its rule, not this route's. Wysebee Agent for Mac and
for Windows download them (apps/cloud/browser_links.py), so paths, fields and status codes are
not free to change:

- ``PUT /skill-files`` — the body is the file's bytes, any content (``Content-Type`` is
  ignored and the file is stored as ``application/octet-stream``); at most
  ``WYSEBEE_SKILL_FILE_MAX_BYTES`` (413), not empty (422). **Content-addressed**: the id
  is the lowercase hex SHA-256 of the bytes, so the same bytes are stored once. A new
  file past ``WYSEBEE_SKILL_FILE_MAX_COUNT`` is a 409. Answers ``{id, size}``.
- ``GET /skill-files/{id}`` — the bytes, as ``application/octet-stream``, never
  rendered (``attachment``, ``nosniff``), cached for good.
- ``DELETE /skill-files/{id}`` — 204.

Every route needs a signed-in caller. Another person's file is a 404; an id that is not
64 lowercase hex digits is a 422. Bytes go to the store first and the row second; a
delete removes the row first and the bytes after (best effort) — as for assets.
"""

import hashlib
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response
from pydantic import BaseModel
from sqlalchemy import delete, func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud.asset_storage import ASSET_ID_RE, AssetStore, AzureBlobAssetStore, FileAssetStore, InvalidName, user_folder
from apps.cloud.auth import User, current_user
from apps.cloud.config import Settings
from apps.cloud.deps import get_session
from apps.cloud.models import CloudSkillFile

logger = logging.getLogger("wysebee.cloud.skill_files")

router = APIRouter(prefix="/v1", tags=["Skill files"])

CONTENT_TYPE = "application/octet-stream"
# The per-person advisory lock a put takes (assets use 7_274_100).
_LOCK_CLASS = 7_274_101

FileId = Annotated[str, Path(pattern=ASSET_ID_RE.pattern)]


class SkillFileOut(BaseModel):
    id: str
    size: int


def get_skill_file_store(request: Request) -> AssetStore:
    return request.app.state.skill_file_store


def make_skill_file_store(settings: Settings) -> AssetStore:
    """Where they are written: the asset store's kind and account, a container (or folder)
    of their own."""
    if settings.asset_store == "azure":
        if not settings.asset_account_url:
            raise RuntimeError("WYSEBEE_ASSET_STORE=azure needs WYSEBEE_ASSET_AZURE_ACCOUNT_URL (or WYSEBEE_BACKUP_AZURE_ACCOUNT_URL).")
        return AzureBlobAssetStore.from_account_url(settings.asset_account_url, settings.skill_file_azure_container)
    return FileAssetStore(settings.skill_file_dir)


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Skill file not found.")


async def _read_body(request: Request, limit: int) -> bytes:
    too_large = HTTPException(status_code=413, detail=f"A skill file is at most {limit} bytes.")
    length = request.headers.get("content-length")
    if length is not None and length.isdigit() and int(length) > limit:
        raise too_large
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > limit:
            raise too_large
    return bytes(body)


@router.put("/skill-files", response_model=SkillFileOut)
async def put_skill_file(
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    store: AssetStore = Depends(get_skill_file_store),
) -> SkillFileOut:
    settings: Settings = request.app.state.settings
    try:
        user_folder(user.sub)
    except InvalidName as exc:
        raise HTTPException(status_code=422, detail="This account's id cannot hold files.") from exc
    data = await _read_body(request, settings.skill_file_max_bytes)
    file_id, size = await keep(session, store, settings, user.sub, data)
    await session.commit()
    return SkillFileOut(id=file_id, size=size)


async def keep(session: AsyncSession, store: AssetStore, settings: Settings, user_id: str, data: bytes) -> tuple[str, int]:
    """Store ``data`` as one of the person's skill files, in the caller's transaction (they
    commit): its id and size. Empty, or past ``skill_file_max_count``, is refused (and the
    transaction rolled back)."""
    if not data:
        raise HTTPException(status_code=422, detail="A skill file cannot be empty.")
    file_id = hashlib.sha256(data).hexdigest()
    await session.execute(text("SELECT pg_advisory_xact_lock(:c, hashtext(:sub))"), {"c": _LOCK_CLASS, "sub": user_id})
    if await session.get(CloudSkillFile, (user_id, file_id)) is not None:
        return file_id, len(data)
    count = await session.scalar(select(func.count()).select_from(CloudSkillFile).where(CloudSkillFile.user_id == user_id))
    if count >= settings.skill_file_max_count:
        await session.rollback()
        raise HTTPException(status_code=409, detail=f"You have {count} skill files stored, the most allowed is {settings.skill_file_max_count}. Delete a skill first.")
    await store.write(user_id, file_id, data, CONTENT_TYPE)
    await session.execute(insert(CloudSkillFile).values(user_id=user_id, file_id=file_id, size=len(data)).on_conflict_do_nothing())
    return file_id, len(data)


@router.get("/skill-files/{file_id}")
async def get_skill_file(
    file_id: FileId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    store: AssetStore = Depends(get_skill_file_store),
) -> Response:
    if await session.get(CloudSkillFile, (user.sub, file_id)) is None:
        raise _not_found()
    await session.close()
    data = await store.read(user.sub, file_id)
    if data is None:
        logger.warning("skill file %s has a row but no bytes", file_id)
        raise _not_found()
    return Response(
        content=data,
        media_type=CONTENT_TYPE,
        headers={
            "Cache-Control": "private, max-age=31536000, immutable",
            "Content-Disposition": "attachment",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/skill-files/{file_id}", status_code=204)
async def delete_skill_file(
    file_id: FileId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    store: AssetStore = Depends(get_skill_file_store),
) -> Response:
    removed = await session.scalar(
        delete(CloudSkillFile).where(CloudSkillFile.user_id == user.sub, CloudSkillFile.file_id == file_id).returning(CloudSkillFile.file_id)
    )
    if removed is None:
        raise _not_found()
    await session.commit()
    try:
        await store.delete(user.sub, file_id)
    except Exception as exc:  # noqa: BLE001 — a stray file is harmless; the answer stands
        logger.warning("skill file %s deleted but its bytes were not: %s", file_id, exc)
    return Response(status_code=204)
