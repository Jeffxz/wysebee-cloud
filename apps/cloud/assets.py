"""Assets: small images a person stores here, private to them.

Agents' and the person's pictures: the website uploads the image here and keeps only its id
in the settings. The routes:

- ``PUT /assets`` — the body is the file's bytes, ``Content-Type`` one of
  :data:`CONTENT_TYPES` (else 415); at most ``WYSEBEE_ASSET_MAX_BYTES`` (413), not empty
  (422). **Content-addressed**: the id is the lowercase hex SHA-256 of the bytes, so
  putting the same bytes again stores nothing new and answers the same id (with the
  content type stored the first time). A new asset past ``WYSEBEE_ASSET_MAX_COUNT`` is a
  409. Answers ``{id, content_type, size}``.
- ``GET /assets/{id}`` — the bytes, with the stored content type, cached for good
  (an id never names other bytes) and ``nosniff``.
- ``DELETE /assets/{id}`` — 204.

Every route needs a signed-in caller. Another person's asset is a 404, never a 403; an id that is not 64 lowercase
hex digits is a 422.

The bytes go to the asset store first and the row second, so a row never names bytes
that are not there; a delete removes the row first and the bytes after (best effort), so
a failure leaves a stray file, never a row pointing at nothing.
"""

import hashlib
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response
from pydantic import BaseModel
from sqlalchemy import delete, func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud.asset_storage import (
    ASSET_ID_RE,
    AssetStore,
    AzureBlobAssetStore,
    FileAssetStore,
    InvalidName,
    user_folder,
)
from apps.cloud.auth import User, current_user
from apps.cloud.config import Settings
from apps.cloud.deps import get_session
from apps.cloud.models import CloudAsset

logger = logging.getLogger("wysebee.cloud.assets")

router = APIRouter(prefix="/v1", tags=["Assets"])

# What may be stored: images a page can show. Not SVG — it can carry script.
CONTENT_TYPES = frozenset({"image/png", "image/jpeg", "image/webp", "image/gif"})

# The first key of the per-person advisory lock a put takes (the second is the person's
# hash), so two uploads cannot both pass the count check.
_LOCK_CLASS = 7_274_100

AssetId = Annotated[str, Path(pattern=ASSET_ID_RE.pattern)]


class AssetOut(BaseModel):
    id: str
    content_type: str
    size: int


def get_asset_store(request: Request) -> AssetStore:
    return request.app.state.asset_store


def make_asset_store(settings: Settings) -> AssetStore:
    if settings.asset_store == "azure":
        if not settings.asset_account_url:
            raise RuntimeError(
                "WYSEBEE_ASSET_STORE=azure needs WYSEBEE_ASSET_AZURE_ACCOUNT_URL (or "
                "WYSEBEE_BACKUP_AZURE_ACCOUNT_URL): https://<account>.blob.core.windows.net."
            )
        return AzureBlobAssetStore.from_account_url(settings.asset_account_url, settings.asset_azure_container)
    return FileAssetStore(settings.asset_dir)


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Asset not found.")


def _out(row: CloudAsset) -> AssetOut:
    return AssetOut(id=row.asset_id, content_type=row.content_type, size=row.size)


def content_type_of(header: str | None) -> str:
    """The media type alone, lowercased: ``image/PNG; charset=x`` is ``image/png``."""
    return (header or "").split(";", 1)[0].strip().lower()


async def _read_body(request: Request, limit: int) -> bytes:
    too_large = HTTPException(status_code=413, detail=f"An asset is at most {limit} bytes.")
    length = request.headers.get("content-length")
    if length is not None and length.isdigit() and int(length) > limit:
        raise too_large
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > limit:
            raise too_large
    return bytes(body)


@router.put("/assets", response_model=AssetOut)
async def put_asset(
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    store: AssetStore = Depends(get_asset_store),
) -> AssetOut:
    settings = _settings(request)
    try:
        # Assets are kept under the user id itself (asset_storage.user_folder).
        user_folder(user.sub)
    except InvalidName as exc:
        raise HTTPException(status_code=422, detail="This account's id cannot hold assets.") from exc
    content_type = content_type_of(request.headers.get("content-type"))
    if content_type not in CONTENT_TYPES:
        raise HTTPException(
            status_code=415, detail=f"An asset must be one of {', '.join(sorted(CONTENT_TYPES))}."
        )
    data = await _read_body(request, settings.asset_max_bytes)
    if not data:
        raise HTTPException(status_code=422, detail="An asset cannot be empty.")
    asset_id = hashlib.sha256(data).hexdigest()

    # One put per person at a time, held to the commit: the count check stays true.
    await session.execute(
        text("SELECT pg_advisory_xact_lock(:c, hashtext(:sub))"), {"c": _LOCK_CLASS, "sub": user.sub}
    )
    existing = await session.get(CloudAsset, (user.sub, asset_id))
    if existing is not None:
        await session.commit()
        return _out(existing)
    count = await session.scalar(select(func.count()).select_from(CloudAsset).where(CloudAsset.user_id == user.sub))
    if count >= settings.asset_max_count:
        await session.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"You have {count} assets stored, the most allowed is {settings.asset_max_count}. Delete one first.",
        )

    # The bytes first: a row is only ever written for bytes that are there.
    await store.write(user.sub, asset_id, data, content_type)
    await session.execute(
        insert(CloudAsset)
        .values(user_id=user.sub, asset_id=asset_id, content_type=content_type, size=len(data))
        .on_conflict_do_nothing()
    )
    await session.commit()
    return AssetOut(id=asset_id, content_type=content_type, size=len(data))


@router.get("/assets/{asset_id}")
async def get_asset(
    asset_id: AssetId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    store: AssetStore = Depends(get_asset_store),
) -> Response:
    row = await session.get(CloudAsset, (user.sub, asset_id))
    if row is None:
        raise _not_found()
    content_type = row.content_type
    # Nothing below needs the database; do not hold a connection through the read.
    await session.close()
    data = await store.read(user.sub, asset_id)
    if data is None:
        logger.warning("asset %s has a row but no bytes", asset_id)
        raise _not_found()
    return Response(
        content=data,
        media_type=content_type,
        headers={
            # An id is the hash of its bytes, so what it names never changes; private,
            # because a shared cache must not serve one person's asset to another.
            "Cache-Control": "private, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/assets/{asset_id}", status_code=204)
async def delete_asset(
    asset_id: AssetId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    store: AssetStore = Depends(get_asset_store),
) -> Response:
    removed = await session.scalar(
        delete(CloudAsset)
        .where(CloudAsset.user_id == user.sub, CloudAsset.asset_id == asset_id)
        .returning(CloudAsset.asset_id)
    )
    if removed is None:
        raise _not_found()
    await session.commit()
    # The row is gone, so the asset is; the bytes are tidied after, best effort.
    try:
        await store.delete(user.sub, asset_id)
    except Exception as exc:  # noqa: BLE001 — a stray file is harmless; the answer stands
        logger.warning("asset %s deleted but its bytes were not: %s", asset_id, exc)
    return Response(status_code=204)
