"""Changes to a skill proposed by the person's AI app (2026-11-17, the person's call: **AI apps
propose, the person approves** — docs/ai-apps-propose.md).

Wysebee Assistant's ``write_skill_file`` and ``add_skill_folder`` (apps/cloud/workspace_assistant.py)
do not save into the skill: an agent may be running it, and a skill's scripts run on the
person's computer. Each keeps a :class:`~apps.cloud.models.SkillChange` — a file's whole text,
or a folder — one per skill and path, a later one for the same path replacing it, and leaves
the person a notification. **Nothing proposed reaches the skill until the person applies it**
on the skill's page; a discarded one is gone.

- ``GET /skills/{skill_id}/changes`` — ``{changes: [{id, path, folder, size, new, created_at}]}``
  (``new``: the skill has no such file yet).
- ``GET /skills/{skill_id}/changes/{change_id}`` — that, with ``content`` (proposed) and
  ``current`` (the file's text now, null when it has none).
- ``POST /skills/{skill_id}/changes/{change_id}/apply`` — saved into the skill as the person's
  own edit; the skill.
- ``DELETE /skills/{skill_id}/changes/{change_id}`` — discarded: 204.

**Skills asked for an agent** (migration 0076): Wysebee Assistant's ``propose_skill``
(apps/cloud/tool_drafts.py) keeps a :class:`~apps.cloud.models.SkillRequest`; the agent does not
have the skill until the person gives it.

- ``GET /agents/{agent_id}/skill-requests`` — ``{requests: [{skill_id, name, description,
  reason, created_at}]}``.
- ``POST /agents/{agent_id}/skill-requests/{skill_id}/give`` — the skill given to the agent,
  after its others: the agent's skills (as ``GET /agents/{agent_id}/skills``).
- ``DELETE /agents/{agent_id}/skill-requests/{skill_id}`` — declined: 204.

A skill given on the agent's Skills tab answers its request too (apps/cloud/skills.py).
"""

import logging
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud import notifications, skill_folders, skill_manifest
from apps.cloud.auth import User, current_user
from apps.cloud.config import Settings
from apps.cloud.deps import get_session
from apps.cloud.models import AgentSkill, SkillChange, SkillRequest, UserSkill
from apps.cloud.relay import public_base

logger = logging.getLogger("wysebee.cloud.skill_changes")

router = APIRouter(prefix="/v1", tags=["Skills"])

# At most so many waiting changes a skill.
MAX_CHANGES = 50


class ChangeOut(BaseModel):
    id: str
    path: str
    folder: bool
    size: int
    new: bool
    created_at: datetime


class ChangeDetail(ChangeOut):
    content: str | None
    current: str | None


def _paths(row: UserSkill) -> set[str]:
    return {f["path"] for f in row.files or [] if isinstance(f, dict)}


def _out(change: SkillChange, row: UserSkill) -> ChangeOut:
    size = len((change.content or "").encode("utf-8"))
    new = change.path not in (set(row.folders or []) if change.folder else _paths(row))
    return ChangeOut(id=change.change_id, path=change.path, folder=change.folder, size=size, new=new, created_at=change.created_at)


async def propose(session: AsyncSession, settings: Settings, row: UserSkill, path: str, content: str | None) -> None:
    """Keep the AI app's file (``content``) or folder (None) for the person, replacing what was
    proposed for that path; checked as a save would be, so what is applied will save. In the
    caller's transaction (they commit)."""
    if content is not None:
        if len(content.encode("utf-8")) > settings.skill_file_max_bytes:
            raise HTTPException(status_code=413, detail=f"A skill file is at most {settings.skill_file_max_bytes} bytes.")
        if skill_manifest.is_secret(path):
            raise HTTPException(status_code=422, detail=f"'{path}' looks like it holds a secret: such files are never kept in Wysebee Cloud.")
    waiting = (await session.scalars(select(SkillChange.path).where(SkillChange.skill_id == row.skill_id))).all()
    if path not in waiting and len(waiting) >= MAX_CHANGES:
        raise HTTPException(status_code=422, detail=f"The skill has {MAX_CHANGES} changes waiting for the person already: they apply or discard some first.")
    values = {"change_id": str(uuid.uuid4()), "user_id": row.user_id, "skill_id": row.skill_id, "path": path, "folder": content is None, "content": content}
    await session.execute(
        insert(SkillChange).values(**values).on_conflict_do_update(
            index_elements=[SkillChange.skill_id, SkillChange.path],
            set_={"change_id": values["change_id"], "folder": values["folder"], "content": content, "created_at": func.now()},
        )
    )


async def notify(request: Request, session: AsyncSession, row: UserSkill, path: str) -> None:
    """Tell the person a change is waiting on the skill's page."""
    review = f"{public_base(request)}/app/#/skills/{row.skill_id}"
    await notifications.send(
        session, row.user_id, f"Review a change to the skill {row.name}",
        f"Your AI app proposed **{path}** for the skill {row.name}. It is not saved: apply or discard it on the skill's page: {review}",
    )


async def _change(session: AsyncSession, row: UserSkill, change_id: str) -> SkillChange:
    try:
        cid = str(uuid.UUID(change_id))
    except ValueError:
        cid = None
    change = await session.get(SkillChange, cid) if cid else None
    if change is None or change.skill_id != row.skill_id:
        raise HTTPException(status_code=404, detail="There is no such change: it was applied or discarded.")
    return change


@router.get("/skills/{skill_id}/changes")
async def list_changes(skill_id: str, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    from apps.cloud import skills

    row = await skills._mine(session, user, skill_id)
    found = (await session.scalars(select(SkillChange).where(SkillChange.skill_id == row.skill_id).order_by(SkillChange.path))).all()
    return {"changes": [_out(c, row) for c in found]}


@router.get("/skills/{skill_id}/changes/{change_id}", response_model=ChangeDetail)
async def get_change(skill_id: str, change_id: str, request: Request, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> ChangeDetail:
    from apps.cloud import skills

    row = await skills._mine(session, user, skill_id)
    change = await _change(session, row, change_id)
    current = None
    if not change.folder and change.path in _paths(row):
        try:
            current = await skill_folders.read_text(request.app.state.skill_file_store, row, change.path)
        except HTTPException:
            current = None
    return ChangeDetail(**_out(change, row).model_dump(), content=change.content, current=current)


@router.post("/skills/{skill_id}/changes/{change_id}/apply")
async def apply_change(skill_id: str, change_id: str, request: Request, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> Any:
    """The person's approval: saved into the skill as their own edit."""
    from apps.cloud import skills

    row = await skills._mine(session, user, skill_id)
    change = await _change(session, row, change_id)
    dropped: set[str] = set()
    if change.folder:
        if change.path not in (row.folders or []):
            await skill_folders.add_folder(session, row, change.path, user.sub)
    else:
        dropped = await skill_folders.put_file(session, request.app.state.settings, request.app.state.skill_file_store, row, change.path, (change.content or "").encode("utf-8"), user.sub)
    await session.execute(delete(SkillChange).where(SkillChange.change_id == change.change_id))
    logger.info("skill_change_applied")
    return await skill_folders._answer(session, request, user, row, dropped)


@router.delete("/skills/{skill_id}/changes/{change_id}", status_code=204)
async def discard_change(skill_id: str, change_id: str, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> Response:
    from apps.cloud import skills

    row = await skills._mine(session, user, skill_id)
    change = await _change(session, row, change_id)
    await session.execute(delete(SkillChange).where(SkillChange.change_id == change.change_id))
    await session.commit()
    return Response(status_code=204)


# --- skills asked for an agent ----------------------------------------------------------------


async def _request(session: AsyncSession, user: User, agent_id: str, skill_id: str) -> tuple[str, SkillRequest]:
    from apps.cloud import skills

    agent = await skills._agent_id(session, user, agent_id)
    try:
        sid = str(uuid.UUID(skill_id))
    except ValueError:
        sid = ""
    found = await session.get(SkillRequest, (agent, sid)) if sid else None
    if found is None or found.user_id != user.sub:
        raise HTTPException(status_code=404, detail="There is no such request: it was given or declined.")
    return agent, found


@router.get("/agents/{agent_id}/skill-requests")
async def list_skill_requests(agent_id: str, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    from apps.cloud import skills

    agent = await skills._agent_id(session, user, agent_id)
    rows = (await session.execute(
        select(SkillRequest, UserSkill).join(UserSkill, UserSkill.skill_id == SkillRequest.skill_id)
        .where(SkillRequest.user_id == user.sub, SkillRequest.agent_id == agent).order_by(UserSkill.name)
    )).all()
    return {"requests": [{"skill_id": str(r.skill_id), "name": k.name, "description": k.description, "reason": r.reason, "created_at": r.created_at} for r, k in rows]}


@router.post("/agents/{agent_id}/skill-requests/{skill_id}/give")
async def give_requested_skill(agent_id: str, skill_id: str, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> Any:
    """The person's approval: the skill given to the agent, after its others."""
    from apps.cloud import browser_links, skills

    agent, found = await _request(session, user, agent_id, skill_id)
    held = (await session.scalars(select(AgentSkill.skill_id).where(AgentSkill.user_id == user.sub, AgentSkill.agent_id == agent))).all()
    if found.skill_id not in held:
        if len(held) >= skills.MAX_ATTACHED:
            raise HTTPException(status_code=422, detail=f"An agent has at most {skills.MAX_ATTACHED} skills.")
        session.add(AgentSkill(user_id=user.sub, agent_id=agent, skill_id=found.skill_id, position=len(held)))
    await session.delete(found)
    await browser_links.wake_for_agent(session, user.sub, agent)
    await session.commit()
    logger.info("skill_request_given")
    return await skills._agent_skills(session, user, agent)


@router.delete("/agents/{agent_id}/skill-requests/{skill_id}", status_code=204)
async def decline_skill_request(agent_id: str, skill_id: str, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> Response:
    _, found = await _request(session, user, agent_id, skill_id)
    await session.delete(found)
    await session.commit()
    return Response(status_code=204)
