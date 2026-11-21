"""How much of Wysebee Cloud's file storage a person uses (2026-11-11, the person's call),
against a **storage quota** — shown on their Billing page. It is
enforced on recordings only (2026-11-20): a browser agent's upload is refused once it would
take the person past their quota (apps/cloud/browser_recordings.py, :func:`room_left`), since
a device, not the person, sends those. Pictures and skill files are not refused yet.

**What counts is every file kept for them in blob storage** (Azure Blob Storage in
production, a folder locally), each kind in its own container:

- **pictures** — their assets (apps/cloud/assets.py: avatars), ``cloud_assets``;
- **skill files** — the files of their skills (apps/cloud/skill_files.py), ``cloud_skill_files``;
- **recordings** — the scenario videos their browser agents filmed
  (apps/cloud/browser_recordings.py), ``browser_recordings``.

(Desktop backups were a third kind until migration 0062.) Every one of those files has a row
with its size, written when it was stored and deleted with it, so the total is sums in the database — the blob store itself is never listed.
What is kept in the database (conversations, settings, tasks) is not file storage and is not
counted.

**The quota** is ``WYSEBEE_STORAGE_QUOTA_BYTES`` (1 GiB by default; 100 GiB self-hosted), or
what an extension's policy gives the person (apps/cloud/extensions.py, ``storage_quota``) —
never less than the setting.

- ``GET /storage`` — ``{used, limit, files, parts: [{kind, bytes, files}]}``: the signed-in
  person's bytes and files, in all and per kind (``assets``, ``skill_files``,
  ``recordings`` — always all three, in that order).
"""

from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud.auth import User, current_user
from apps.cloud.deps import get_session
from apps.cloud.models import BrowserRecording, CloudAsset, CloudSkillFile

router = APIRouter(prefix="/v1", tags=["Storage"])

# Each kind of file, with the table that lists a person's and the column holding a file's size.
KINDS: list[tuple[str, Any, Any]] = [
    ("assets", CloudAsset, CloudAsset.size),
    ("skill_files", CloudSkillFile, CloudSkillFile.size),
    ("recordings", BrowserRecording, BrowserRecording.size),
]


async def used_by(session: AsyncSession, user_id: str) -> list[dict[str, Any]]:
    """The person's bytes and files of each kind, in :data:`KINDS`' order."""
    parts = []
    for kind, table, size in KINDS:
        total, count = (await session.execute(select(func.coalesce(func.sum(size), 0), func.count()).where(table.user_id == user_id))).one()
        parts.append({"kind": kind, "bytes": int(total), "files": int(count)})
    return parts


async def limit_of(session: AsyncSession, state: Any, user_id: str) -> int:
    """The person's quota in bytes: the policy's, never less than ``storage_quota_bytes``."""
    given = await state.policy.storage_quota(session, user_id)
    return max(state.settings.storage_quota_bytes, given or 0)


async def room_left(session: AsyncSession, state: Any, user_id: str) -> int:
    """How many more bytes the person may keep before reaching their quota (0 when at or past it)."""
    used = sum(p["bytes"] for p in await used_by(session, user_id))
    return max(await limit_of(session, state, user_id) - used, 0)


@router.get("/storage")
async def storage(request: Request, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    parts = await used_by(session, user.sub)
    return {
        "used": sum(p["bytes"] for p in parts),
        "limit": await limit_of(session, request.app.state, user.sub),
        "files": sum(p["files"] for p in parts),
        "parts": parts,
    }
