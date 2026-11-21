"""The people using Wysebee (``users``, migrations 0019–0020): what their app last gave
about them (email, name) and **their profile** — the display name and picture they chose.

- ``GET /profile`` — ``{display_name, avatar}`` ("" for none; ``avatar`` an emoji or
  ``asset:<id>``, a picture in the asset store, apps/cloud/assets.py).
- ``PUT /profile`` — ``{display_name?, avatar?}``: only what is sent changes ("" or null
  clears it). The display name is one line of at most 80 characters; a picture is uploaded
  as an asset first and named here by its id. (Until migration 0020 the profile was kept on
  Wysebee's own agent settings; that migration copied it here.)
- ``PUT /me`` — ``{email?, name?}``: who the caller is, as their sign-in told their app (an
  Auth0 access token carries neither). The website sends it when it signs in; a blank keeps
  what was there. Answers 204.

A row is made (or its email and name updated) when the person's app says who they are
(``PUT /me``). (``ai_enabled`` and the Wysebee AI waitlist went with the hosted chat they
gated, migrations 0024–0025.) Who is here, from the command line::

    python -m apps.cloud.users list      # each person: email, name, sub
"""

import asyncio
import re
import sys
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud.auth import User, current_user
from apps.cloud.deps import get_session
from apps.cloud.models import UserProfile

router = APIRouter(prefix="/v1", tags=["Users"])

# A picture in the asset store (its sha-256), or an emoji.
_ASSET = re.compile(r"^asset:[0-9a-f]{64}$")
MAX_EMOJI_CHARS = 16


class ProfileIn(BaseModel):
    display_name: str | None = Field(default=None, max_length=200)
    avatar: str | None = Field(default=None, max_length=200)


class MeIn(BaseModel):
    email: str = Field(default="", max_length=320)
    name: str = Field(default="", max_length=200)


def _profile(row: UserProfile | None) -> dict[str, Any]:
    return {"display_name": row.display_name if row else "", "avatar": row.avatar if row else ""}


@router.get("/profile")
async def get_profile(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    return _profile(await session.get(UserProfile, user.sub))


@router.put("/profile")
async def put_profile(body: ProfileIn, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    changes: dict[str, Any] = {}
    sent = body.model_fields_set
    if "display_name" in sent:
        name = (body.display_name or "").strip()
        if "\n" in name or "\r" in name or len(name) > 80:
            raise HTTPException(status_code=422, detail="A display name is one line of at most 80 characters.")
        changes["display_name"] = name
    if "avatar" in sent:
        avatar = (body.avatar or "").strip()
        is_asset = avatar.startswith("asset:")
        if (is_asset and not _ASSET.match(avatar)) or (not is_asset and len(avatar) > MAX_EMOJI_CHARS):
            raise HTTPException(status_code=422, detail="'avatar' is an emoji, or a picture in the asset store (asset:<id>).")
        changes["avatar"] = avatar
    now = datetime.now(UTC)
    if changes:
        await session.execute(
            pg_insert(UserProfile).values(user_id=user.sub, created_at=now, updated_at=now, **changes).on_conflict_do_update(index_elements=["user_id"], set_=changes | {"updated_at": now})
        )
        await session.commit()
    return _profile(await session.get(UserProfile, user.sub, populate_existing=True))


@router.put("/me", status_code=204)
async def put_me(body: MeIn, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> None:
    await remember(session, user.sub, body.email.strip(), body.name.strip())
    await session.commit()


async def remember(session: AsyncSession, sub: str, email: str, name: str) -> None:
    """Keep what the person's app says about them (a blank keeps what was there)."""
    now = datetime.now(UTC)
    changes = {"updated_at": now} | ({"email": email} if email else {}) | ({"name": name} if name else {})
    await session.execute(
        pg_insert(UserProfile).values(user_id=sub, email=email, name=name, created_at=now, updated_at=now).on_conflict_do_update(index_elements=["user_id"], set_=changes)
    )


USAGE = "usage: python -m apps.cloud.users list"


async def run(argv: list[str], session: AsyncSession) -> tuple[int, str]:
    """The command line's work: an exit code and what to print."""
    match argv:
        case ["list"]:
            rows = (await session.scalars(select(UserProfile).order_by(UserProfile.created_at, UserProfile.user_id))).all()
            lines = [f"{u.email or '-'}  {u.name or '-'}  {u.user_id}" for u in rows]
            return 0, "\n".join(lines) or "(nobody yet)"
        case _:
            return 2, USAGE


async def _main(argv: list[str]) -> int:  # pragma: no cover - the database from the environment
    from apps.cloud.config import Settings
    from apps.cloud.db import Database

    db = Database(Settings())
    try:
        async for session in db.session():
            code, out = await run(argv, session)
            print(out, file=sys.stderr if code else sys.stdout)
            return code
    finally:
        await db.dispose()
    return 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(asyncio.run(_main(sys.argv[1:])))
