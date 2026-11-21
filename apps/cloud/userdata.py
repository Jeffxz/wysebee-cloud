"""A person's Wysebee data, partitioned by the person: task runs, reminders, the settings that
follow them and the Tasks order (apps/cloud/models.py ``User*``), every key starting with the
caller's ``sub``, read and written by the website (and the cloud's own scheduler). Tasks
themselves are apps/cloud/tasks.py's. Home's topics and conversations went with
chat (2026-11-14, the person's call): their tables stay, unread and unwritten here.

The routes:

- ``GET /data/{table}`` — ``{"rows": [...]}``, in the table's order. Filters: each
  table's own equality filters (``?task_id=`` on ``task_runs``), ``?limit=`` (at most
  :data:`MAX_LIST`), and on ``reminders`` ``?pending=1`` (not delivered) and
  ``?due_before=<ISO>``.
- ``GET /data/{table}/{key}`` — the row, or 404.
- ``PUT /data/{table}/{key}`` — the row's columns (the key's own taken from the path):
  stored whole, answered back. Larger than the table's limit is a 413.
- ``DELETE /data/{table}/{key}`` — 204, or 404 when there is none.
- ``DELETE /data/{table}?<filter>=`` — every row matching an equality filter (a task's
  runs): ``{"deleted": n}``. A filter is required.
- ``POST /data/reminders/{key}/deliver`` — marks a reminder delivered now, only if it is
  not yet: ``{"delivered": true}`` for the one caller that did, ``false`` for any other,
  so two callers never both post it. 404 when there is none.

Every route needs a signed-in caller; another person's row is simply not there (404).
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud.auth import User, current_user
from apps.cloud.deps import get_session
from apps.cloud.models import UserNavOrder, UserReminder, UserSetting, UserTaskRun

router = APIRouter(prefix="/v1", tags=["User data"])

MAX_LIST = 1000
SMALL = 256 * 1024
LARGE = 16 * 1024 * 1024

KEY_PATTERN = r"^[A-Za-z0-9_.:-]{1,64}$"


@dataclass(frozen=True)
class Table:
    model: Any
    key: str
    order: tuple[str, ...]
    max_bytes: int = SMALL
    filters: tuple[str, ...] = ()

    def all_columns(self) -> list[str]:
        return [c.name for c in self.model.__table__.columns if c.name != "user_id"]


TABLES: dict[str, Table] = {
    "task_runs": Table(UserTaskRun, "run_id", ("-started_at",), LARGE, ("task_id",)),
    "reminders": Table(UserReminder, "id", ("due_at", "created_at")),
    "settings": Table(UserSetting, "settings_id", ("settings_id",)),
    "nav_order": Table(UserNavOrder, "scope", ("scope",)),
}


def _table(name: str) -> Table:
    table = TABLES.get(name)
    if table is None:
        raise HTTPException(status_code=404, detail=f"There is no table {name!r}.")
    return table


def _row(table: Table, obj: Any) -> dict[str, Any]:
    return {c: getattr(obj, c) for c in table.all_columns()}


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Not found.")


@router.get("/data/{name}")
async def list_rows(
    name: str,
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    table = _table(name)
    model = table.model
    query = select(model).where(model.user_id == user.sub)
    params = request.query_params
    for f in table.filters:
        if f in params:
            query = query.where(_equal(model, f, params[f]))
    if model is UserReminder:
        if params.get("pending") == "1":
            query = query.where(model.delivered_at.is_(None))
        if "due_before" in params:
            query = query.where(model.due_at <= params["due_before"])
    for column in table.order:
        query = query.order_by(getattr(model, column.lstrip("-")).desc() if column.startswith("-") else getattr(model, column))
    limit = params.get("limit", "")
    query = query.limit(min(int(limit), MAX_LIST) if limit.isdigit() else MAX_LIST)
    rows = (await session.scalars(query)).all()
    return {"rows": [_row(table, r) for r in rows]}


def _equal(model: Any, column: str, value: str) -> Any:
    """A filter's condition; a value its column cannot hold (a task id that is no UUID) is a
    422, not a database error."""
    if isinstance(getattr(model, column).type, UUID):
        try:
            value = str(uuid.UUID(value))
        except ValueError:
            raise HTTPException(status_code=422, detail=f"'{column}' is not one.") from None
    return getattr(model, column) == value


@router.get("/data/{name}/{key}")
async def get_row(
    name: str,
    key: str = Path(pattern=KEY_PATTERN),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    table = _table(name)
    obj = await session.get(table.model, (user.sub, key))
    if obj is None:
        raise _not_found()
    return _row(table, obj)


@router.put("/data/{name}/{key}")
async def put_row(
    name: str,
    request: Request,
    key: str = Path(pattern=KEY_PATTERN),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    table = _table(name)
    body = await request.body()
    if len(body) > table.max_bytes:
        raise HTTPException(status_code=413, detail=f"A {name} row is at most {table.max_bytes} bytes.")
    try:
        sent = await request.json()
    except ValueError:
        raise HTTPException(status_code=422, detail="The body must be a JSON object.") from None
    if not isinstance(sent, dict):
        raise HTTPException(status_code=422, detail="The body must be a JSON object.")
    columns = table.all_columns()
    unknown = sorted(set(sent) - set(columns))
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown columns: {', '.join(unknown)}.")
    values = {c: sent.get(c) for c in columns}
    values[table.key] = key
    values["user_id"] = user.sub
    stmt = pg_insert(table.model).values(**values)
    stmt = stmt.on_conflict_do_update(
        index_elements=["user_id", table.key], set_={c: values[c] for c in columns if c != table.key}
    )
    try:
        await session.execute(stmt)
        await session.commit()
    except (IntegrityError, DataError) as exc:
        # A key no row of its own refers to (a run's task gone), or a value its column cannot
        # hold (a task id that is no UUID).
        await session.rollback()
        raise HTTPException(status_code=422, detail="This row cannot be stored.") from exc
    return {c: values[c] for c in columns}


@router.delete("/data/{name}/{key}", status_code=204)
async def delete_row(
    name: str,
    key: str = Path(pattern=KEY_PATTERN),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    table = _table(name)
    model = table.model
    result = await session.execute(delete(model).where(model.user_id == user.sub, getattr(model, table.key) == key))
    await session.commit()
    if result.rowcount == 0:
        raise _not_found()
    return Response(status_code=204)


@router.delete("/data/{name}")
async def delete_rows(
    name: str,
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, int]:
    table = _table(name)
    model = table.model
    chosen = [f for f in table.filters if f in request.query_params]
    if not chosen:
        raise HTTPException(status_code=422, detail=f"Say which rows: {', '.join(table.filters) or 'no filter'}.")
    query = delete(model).where(model.user_id == user.sub)
    for f in chosen:
        query = query.where(_equal(model, f, request.query_params[f]))
    result = await session.execute(query)
    await session.commit()
    return {"deleted": result.rowcount}


@router.post("/data/reminders/{key}/deliver")
async def deliver_reminder(
    key: str = Path(pattern=KEY_PATTERN),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, bool]:
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    result = await session.execute(
        update(UserReminder)
        .where(UserReminder.user_id == user.sub, UserReminder.id == key, UserReminder.delivered_at.is_(None))
        .values(delivered_at=now)
    )
    await session.commit()
    if result.rowcount == 1:
        return {"delivered": True}
    if await session.get(UserReminder, (user.sub, key)) is None:
        raise _not_found()
    return {"delivered": False}
