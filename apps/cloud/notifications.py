"""The person's **Activity** (2026-11-14, the person's call): notifications their agents send,
shown on the website's Activity page, newest first.

- **Sent by an agent** (2026-11-15, the person's call: a notification is always an agent's):
  every agent has the tool ``send_notification`` (:data:`TOOL`, offered with its own tools,
  apps/cloud/agent_chat/toolbox.py) — ``{title, body?}``: a title of one line, at most
  :data:`TITLE_MAX` characters, and a body in Markdown, at most :data:`BODY_MAX`. The AI app
  runs it with ``call_agent_tool`` (apps/cloud/agent_mcp.py), and a scheduled task as one of
  its steps (apps/cloud/task_runner.py); a due task also posts its own, from its first step's
  agent. The Activity page shows the agent with its picture. Each one is a tool call
  answered, so it costs a credit (apps/cloud/tool_calls.py). A person keeps their newest
  :data:`KEEP`; older ones go as new ones come.
- **Live**: a new one ``pg_notify``s the change feed's channel (apps/cloud/config_events.py),
  whose open streams then send ``event: activity`` with the person's unread count, so the
  website's Activity item lights up at once, with no polling.
- ``GET /notifications?limit=`` — ``{notifications: [{id, title, body, agent, created_at, read}],
  unread}``, newest first, at most :data:`LIST_MAX`.
- ``GET /notifications/unread`` — ``{unread}``: how many the person has not seen.
- ``POST /notifications/read`` — every one is seen now: ``{read: n}``, how many were not.
- ``DELETE /notifications/{id}`` — that one is gone (204); 404 when the person has none such.
"""

import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud.agent_chat.tools import Output
from apps.cloud.auth import User, current_user
from apps.cloud.changes import NOTIFY_CHANNEL
from apps.cloud.models import UserNotification

router = APIRouter(prefix="/v1", tags=["Activity"])

TITLE_MAX = 200
BODY_MAX = 10_000
KEEP = 500
LIST_MAX = 200

TOOL_NAME = "send_notification"
# Every agent's (apps/cloud/agent_chat/toolbox.py), in the chat loop's shape (``input_schema``).
TOOL: dict[str, Any] = {
    "name": TOOL_NAME,
    "description": (
        "Send the person a notification from this agent: it shows at once on Wysebee's Activity page with this "
        "agent's picture, newest first, with an indicator until they open it. Use it to tell them something "
        "finished, needs their attention, or to leave them a short report."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": f"One line, at most {TITLE_MAX} characters."},
            "body": {"type": "string", "description": f"Optional details, in Markdown, at most {BODY_MAX} characters."},
        },
        "required": ["title"],
    },
}


def _out(row: UserNotification, names: dict[str, str]) -> dict[str, Any]:
    """One as the page reads it: its agent by its handle now (null once deleted)."""
    return {
        "id": row.id,
        "title": row.title,
        "body": row.body,
        "agent": names.get(row.agent_id) if row.agent_id else None,
        "created_at": row.created_at.isoformat(),
        "read": row.read_at is not None,
    }


async def unread_of(session: AsyncSession, user_id: str) -> int:
    return int(await session.scalar(
        select(func.count()).select_from(UserNotification).where(UserNotification.user_id == user_id, UserNotification.read_at.is_(None))
    ) or 0)


async def _wake(session: AsyncSession, user_id: str) -> None:
    """Wake the person's open change feeds (on commit), which then send their unread count."""
    await session.execute(text("SELECT pg_notify(:channel, :payload)"), {"channel": NOTIFY_CHANNEL, "payload": json.dumps({"u": user_id})})


async def send(session: AsyncSession, user_id: str, title: str, body: str, agent_id: str | None = None) -> UserNotification:
    """Keep one for the person (from the agent of ``agent_id``), dropping their oldest beyond
    :data:`KEEP`; committed here."""
    row = UserNotification(id=uuid.uuid4().hex, user_id=user_id, title=title, body=body, agent_id=agent_id)
    session.add(row)
    await session.flush()
    kept = select(UserNotification.id).where(UserNotification.user_id == user_id).order_by(UserNotification.created_at.desc(), UserNotification.id.desc()).limit(KEEP)
    await session.execute(delete(UserNotification).where(UserNotification.user_id == user_id, UserNotification.id.not_in(kept)))
    await _wake(session, user_id)
    await session.commit()
    return row


async def from_agent(state: Any, user_id: str, agent_id: str | None, name: str, args: dict[str, Any]) -> Output:
    """The ``send_notification`` of the agent of ``agent_id`` (@``name``; None: Wysebee's own,
    made now when it has no row yet): sent from it, or why not."""
    title = args.get("title")
    body = args.get("body", "")
    if not isinstance(title, str) or not title.strip() or "\n" in title.strip():
        return Output("Give a 'title': one line of text.", True)
    if not isinstance(body, str):
        return Output("'body' must be text (Markdown).", True)
    title, body = title.strip(), body.strip()
    if len(title) > TITLE_MAX:
        return Output(f"The title is too long: at most {TITLE_MAX} characters.", True)
    if len(body) > BODY_MAX:
        return Output(f"The body is too long: at most {BODY_MAX} characters.", True)
    from apps.cloud import agents

    async with state.db.sessionmaker() as session:
        if agent_id is None:
            agent_id = (await agents.wysebee(session, user_id)).agent_id
        await send(session, user_id, title, body, agent_id)
    return Output(f"Sent from @{name}: it shows on the person's Activity page in Wysebee.")


@router.get("/notifications")
async def list_notifications(request: Request, limit: int = 50, user: User = Depends(current_user)) -> dict[str, Any]:
    from apps.cloud import agents

    limit = max(1, min(limit, LIST_MAX))
    async with request.app.state.db.sessionmaker() as session:
        rows = (await session.scalars(
            select(UserNotification).where(UserNotification.user_id == user.sub)
            .order_by(UserNotification.created_at.desc(), UserNotification.id.desc()).limit(limit)
        )).all()
        names = await agents.names(session, user.sub, {r.agent_id for r in rows if r.agent_id})
        return {"notifications": [_out(r, names) for r in rows], "unread": await unread_of(session, user.sub)}


@router.get("/notifications/unread")
async def unread(request: Request, user: User = Depends(current_user)) -> dict[str, int]:
    async with request.app.state.db.sessionmaker() as session:
        return {"unread": await unread_of(session, user.sub)}


@router.post("/notifications/read")
async def mark_read(request: Request, user: User = Depends(current_user)) -> dict[str, int]:
    async with request.app.state.db.sessionmaker() as session:
        done = await session.execute(
            update(UserNotification).where(UserNotification.user_id == user.sub, UserNotification.read_at.is_(None)).values(read_at=func.now())
        )
        if done.rowcount:  # type: ignore[attr-defined]
            await _wake(session, user.sub)
        await session.commit()
        return {"read": int(done.rowcount or 0)}  # type: ignore[attr-defined]


@router.delete("/notifications/{notification_id}", status_code=204)
async def delete_notification(notification_id: str, request: Request, user: User = Depends(current_user)) -> Response:
    async with request.app.state.db.sessionmaker() as session:
        row = await session.scalar(select(UserNotification).where(UserNotification.user_id == user.sub, UserNotification.id == notification_id))
        if row is None:
            raise HTTPException(status_code=404, detail="No such notification.")
        await session.delete(row)
        # An unread one going changes the badge.
        if row.read_at is None:
            await _wake(session, user.sub)
        await session.commit()
    return Response(status_code=204)
