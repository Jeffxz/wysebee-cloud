"""Who made or last changed something (migration 0066): agents, tools, skills, workspaces and
tasks each keep ``created_by`` and ``updated_by``, user ids, alongside ``user_id``, their
owner. They are the same person until things can be shared; then an editor who is not the
owner changes what another owns.

An answer names each as ``{id, name, email}`` from the ``users`` table (apps/cloud/users.py):
``name`` the person's chosen display name, else their name; both empty when they never told
the cloud about themselves."""

from collections.abc import Iterable
from typing import Any

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud.models import UserProfile


class Person(BaseModel):
    id: str
    name: str
    email: str


async def of_rows(session: AsyncSession, rows: Iterable[Any]) -> dict[str, Person]:
    """The people who made or last changed these rows, by id, in one query."""
    ids = {i for r in rows for i in (r.created_by, r.updated_by) if i}
    found = (await session.scalars(select(UserProfile).where(UserProfile.user_id.in_(ids)))).all() if ids else []
    known = {p.user_id: Person(id=p.user_id, name=p.display_name or p.name, email=p.email) for p in found}
    return {i: known.get(i) or Person(id=i, name="", email="") for i in ids}


def named(people: dict[str, Person], user_id: str | None) -> Person:
    """One of them (an empty one for a row that names nobody)."""
    return people.get(user_id or "") or Person(id=user_id or "", name="", email="")


def stamp(row: Any, user_id: str, *, made: bool = False) -> None:
    """Record that ``user_id`` changed ``row`` — and, ``made``, made it."""
    row.updated_by = user_id
    if made:
        row.created_by = user_id
