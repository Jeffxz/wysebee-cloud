"""Skills: a person's library of skills, and which of their agents has which.

A skill is a folder — a ``SKILL.md`` and whatever it needs — whose files are in the person's
skill file store (apps/cloud/skill_files.py, content-addressed, under their user id). Its row,
:class:`~apps.cloud.models.UserSkill`, holds its ``name``, ``description`` and ``files``
(``[{path, id, size}]``) and is keyed by ``skill_id``, a UUID: everything links to a skill by
id, so a skill can be renamed. Which agents have it is
:class:`~apps.cloud.models.AgentSkill` — the agent by its id (apps/cloud/agents.py), in the
agent's order. (Until migration 0060 a skill was a ``skill`` cloud item keyed by its name, and
an agent listed names in its settings' ``skills``.)

A skill is edited a file at a time (2026-11-17, apps/cloud/skill_folders.py): its
``SKILL.md`` says its description, and its name is the skill's.

- ``GET /skills`` — ``{skills: [Skill]}``, by name; a skill is ``{id, name, description,
  files, folders, created_at, updated_at, created_by, updated_by}``.
- ``POST /skills`` ``{name, description?, instructions?}`` — 201 the new skill, with a
  ``SKILL.md`` made of them (a starter when not given).
- ``GET|PUT|DELETE /skills/{skill_id}`` — a put ``{name}`` renames it (and its SKILL.md's
  ``name``). A delete deletes the stored files no other of the person's skills has.
- ``GET /skills/{skill_id}/agents`` — ``{agents: [{id, name, label}]}``: the person's agents
  that have it, by name (the Skills page's overview).
- ``GET /agents/{agent_id}/skills`` — ``{skills: [Skill]}`` in the agent's order;
  ``PUT`` ``{skill_ids}`` replaces them (at most 50).

A Mac paired with an agent hears at once when the agent's skills, or one of them, change
(apps/cloud/browser_links.py: its poll carries them, by name). Another person's skill or
agent is a 404, as is a deleted agent. Skills of another person cannot be given yet; the
tables keep the agent's owner and the skill's apart for when they can.
"""

import logging
import re
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud.asset_storage import AssetStore
from apps.cloud.auth import User, current_user
from apps.cloud.deps import get_session
from apps.cloud.models import AgentSkill, CloudSkillFile, UserSkill, SkillRequest
from apps.cloud.people import Person, named, of_rows

logger = logging.getLogger("wysebee.cloud.skills")

router = APIRouter(prefix="/v1", tags=["Skills"])

# skills.rs `NAME`, `MAX_DESCRIPTION`, `MAX_FILES`, `MAX_ATTACHED`; the website's library limit.
NAME = re.compile(r"^[a-z][a-z0-9_-]{0,39}$")
NAME_RULE = "a skill's name starts with a lowercase letter and holds only lowercase letters, digits, '-' or '_' (40 at most)"
MAX_DESCRIPTION = 1024
MAX_FILES = 200
MAX_PATH = 1024
MAX_SKILLS = 100
MAX_ATTACHED = 50
SKILL_FILE = "SKILL.md"

SkillId = Path(pattern=r"^[0-9a-fA-F-]{32,36}$")
AgentId = Path(pattern=r"^[0-9a-fA-F-]{32,36}$")


class SkillFile(BaseModel):
    path: str
    id: str
    size: int


class SkillNew(BaseModel):
    name: str
    description: str | None = None
    instructions: str | None = None


class SkillRename(BaseModel):
    name: str


class SkillOut(BaseModel):
    id: str
    name: str
    description: str
    files: list[SkillFile]
    # The folders made that hold no file yet.
    folders: list[str]
    created_at: datetime
    updated_at: datetime
    # Who made it and who changed it last (apps/cloud/people.py).
    created_by: Person
    updated_by: Person


class SkillList(BaseModel):
    skills: list[SkillOut]


class AgentSkillsIn(BaseModel):
    skill_ids: list[str]


def _out(row: UserSkill, who: dict[str, Person]) -> SkillOut:
    return SkillOut(
        id=str(row.skill_id), name=row.name, description=row.description, files=[SkillFile(**f) for f in row.files or []],
        folders=list(row.folders or []), created_at=row.created_at, updated_at=row.updated_at, created_by=named(who, row.created_by), updated_by=named(who, row.updated_by),
    )


async def _list(session: AsyncSession, rows: Any) -> SkillList:
    who = await of_rows(session, rows)
    return SkillList(skills=[_out(r, who) for r in rows])


async def _one(session: AsyncSession, row: UserSkill) -> SkillOut:
    return _out(row, await of_rows(session, [row]))


def _uuid(value: str) -> str | None:
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError, TypeError):
        return None


def _store(request: Request) -> AssetStore:
    return request.app.state.skill_file_store


# --- reading, for the agents' tools and their Macs ----------------------------------------


async def of_agent(session: AsyncSession, user_id: str, agent_id: str | None) -> list[UserSkill]:
    """The skills of the person's agent, in its order; none for an agent not stored yet
    (Wysebee's own, before it has a row: ``agent_id`` None)."""
    if agent_id is None:
        return []
    return list((await session.scalars(
        select(UserSkill)
        .join(AgentSkill, AgentSkill.skill_id == UserSkill.skill_id)
        .where(AgentSkill.user_id == user_id, AgentSkill.agent_id == agent_id)
        .order_by(AgentSkill.position)
    )).all())


# --- checks -------------------------------------------------------------------------------


def _path_problem(path: str) -> str | None:
    """skillManifest.ts ``filesProblem``'s rule for one path (wysebee-agent-osx's
    ``skills::parse_entry``): relative, ``/``-separated, no ``..``, ``.`` or empty part."""
    parts = path.split("/")
    if not path or len(path) > MAX_PATH or "\\" in path or "\x00" in path or path.startswith("/") or any(p in ("", ".", "..") for p in parts):
        return f"'{path}' is not a path inside the skill's folder: like scripts/run.py, with no '..'."
    return None


def _name(value: str) -> str:
    name = value.strip()
    if not NAME.match(name):
        raise HTTPException(status_code=422, detail=f"'{name}': {NAME_RULE}.")
    return name


async def _mine(session: AsyncSession, user: User, skill_id: str) -> UserSkill:
    sid = _uuid(skill_id)
    row = await session.get(UserSkill, sid, populate_existing=True) if sid else None
    if row is None or row.user_id != user.sub:
        raise HTTPException(status_code=404, detail="There is no such skill.")
    return row


async def _taken(session: AsyncSession, user: User, name: str, but: str | None = None) -> None:
    query = select(UserSkill.skill_id).where(UserSkill.user_id == user.sub, UserSkill.name == name)
    if but is not None:
        query = query.where(UserSkill.skill_id != but)
    if await session.scalar(query) is not None:
        raise HTTPException(status_code=409, detail=f"There is already a skill named '{name}'.")


async def _commit(session: AsyncSession, name: str) -> None:
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=409, detail=f"There is already a skill named '{name}'.") from exc


async def _forget_files(session: AsyncSession, store: AssetStore, user_id: str, ids: set[str]) -> None:
    """Delete the stored files among ``ids`` that none of the person's skills has any more.
    Best effort: a file left behind only counts toward their storage."""
    if not ids:
        return
    used = {f.get("id") for files in (await session.scalars(select(UserSkill.files).where(UserSkill.user_id == user_id))).all() for f in files or [] if isinstance(f, dict)}
    gone = (await session.scalars(
        delete(CloudSkillFile).where(CloudSkillFile.user_id == user_id, CloudSkillFile.file_id.in_(ids - used)).returning(CloudSkillFile.file_id)
    )).all()
    await session.commit()
    for file_id in gone:
        try:
            await store.delete(user_id, file_id)
        except Exception as exc:  # noqa: BLE001 — a stray file is harmless
            logger.warning("skill file %s forgotten but its bytes were not deleted: %s", file_id, exc)


async def _agent_id(session: AsyncSession, user: User, agent_id: str) -> str:
    from apps.cloud import agents

    row = await agents.by_id(session, user.sub, agent_id)
    if row is None:
        raise HTTPException(status_code=404, detail="There is no such agent.")
    return row.agent_id


# --- routes -------------------------------------------------------------------------------


@router.get("/skills", response_model=SkillList)
async def list_skills(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> SkillList:
    rows = (await session.scalars(select(UserSkill).where(UserSkill.user_id == user.sub).order_by(UserSkill.name))).all()
    return await _list(session, rows)


@router.post("/skills", response_model=SkillOut, status_code=201)
async def create_skill(request: Request, body: SkillNew, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> SkillOut:
    from apps.cloud import skill_folders

    name = _name(body.name)
    await _taken(session, user, name)
    count = await session.scalar(select(func.count()).select_from(UserSkill).where(UserSkill.user_id == user.sub)) or 0
    if count >= MAX_SKILLS:
        raise HTTPException(status_code=422, detail=f"The library holds at most {MAX_SKILLS} skills. Delete one first.")
    description = (body.description or "").strip() or f"Say what {name} does and when to use it."
    row = await skill_folders.create(
        session, request.app.state.settings, _store(request), user.sub, name, description, body.instructions or "", user.sub,
    )
    await _commit(session, name)
    await session.refresh(row)
    return await _one(session, row)


@router.get("/skills/{skill_id}", response_model=SkillOut)
async def get_skill(skill_id: str = SkillId, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> SkillOut:
    return await _one(session, await _mine(session, user, skill_id))


@router.put("/skills/{skill_id}", response_model=SkillOut)
async def rename_skill(request: Request, body: SkillRename, skill_id: str = SkillId, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> SkillOut:
    """Rename a skill: its SKILL.md's ``name`` with it."""
    from apps.cloud import skill_folders

    row = await _mine(session, user, skill_id)
    name = _name(body.name)
    await _taken(session, user, name, but=row.skill_id)
    dropped = await skill_folders.rename(session, request.app.state.settings, _store(request), row, name, user.sub)
    await _commit(session, name)
    await session.refresh(row)
    out = await _one(session, row)
    await _forget_files(session, _store(request), user.sub, dropped)
    return out


@router.delete("/skills/{skill_id}", status_code=204)
async def delete_skill(request: Request, skill_id: str = SkillId, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> Response:
    from apps.cloud import browser_links

    row = await _mine(session, user, skill_id)
    ids = {f.get("id") for f in row.files or [] if isinstance(f, dict)}
    # Woken before the links go, so the Macs of the agents that had it are found.
    await browser_links.wake_for_skill(session, user.sub, row.skill_id)
    await session.delete(row)
    await session.commit()
    await _forget_files(session, _store(request), user.sub, ids)
    return Response(status_code=204)


@router.get("/skills/{skill_id}/agents")
async def skill_agents(skill_id: str = SkillId, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """The person's agents that have this skill, by name."""
    from apps.cloud.models import UserAgent

    row = await _mine(session, user, skill_id)
    agents = (await session.scalars(
        select(UserAgent).join(AgentSkill, AgentSkill.agent_id == UserAgent.agent_id)
        .where(AgentSkill.user_id == user.sub, AgentSkill.skill_id == row.skill_id).order_by(UserAgent.name)
    )).all()
    return {"agents": [{"id": a.agent_id, "name": a.name, "label": (a.config or {}).get("label") or a.name} for a in agents]}


async def _agent_skills(session: AsyncSession, user: User, agent_id: str) -> SkillList:
    rows = (await session.scalars(
        select(UserSkill).join(AgentSkill, AgentSkill.skill_id == UserSkill.skill_id)
        .where(AgentSkill.user_id == user.sub, AgentSkill.agent_id == agent_id).order_by(AgentSkill.position)
    )).all()
    return await _list(session, rows)


@router.get("/agents/{agent_id}/skills", response_model=SkillList)
async def get_agent_skills(agent_id: str = AgentId, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> SkillList:
    return await _agent_skills(session, user, await _agent_id(session, user, agent_id))


@router.put("/agents/{agent_id}/skills", response_model=SkillList)
async def set_agent_skills(body: AgentSkillsIn, agent_id: str = AgentId, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> SkillList:
    from apps.cloud import browser_links

    agent_id = await _agent_id(session, user, agent_id)
    wanted = [_uuid(i) for i in body.skill_ids]
    if any(i is None for i in wanted):
        raise HTTPException(status_code=422, detail="'skill_ids' holds skills' ids.")
    if len(set(wanted)) != len(wanted):
        raise HTTPException(status_code=422, detail="A skill is in 'skill_ids' twice.")
    if len(wanted) > MAX_ATTACHED:
        raise HTTPException(status_code=422, detail=f"An agent has at most {MAX_ATTACHED} skills.")
    held = set((await session.scalars(select(UserSkill.skill_id).where(UserSkill.user_id == user.sub, UserSkill.skill_id.in_(wanted)))).all()) if wanted else set()
    if any(i not in held for i in wanted):
        raise HTTPException(status_code=404, detail="There is no such skill.")
    await session.execute(delete(AgentSkill).where(AgentSkill.user_id == user.sub, AgentSkill.agent_id == agent_id))
    session.add_all(AgentSkill(user_id=user.sub, agent_id=agent_id, skill_id=i, position=n) for n, i in enumerate(wanted))
    # A skill the person's AI app asked for, given here: its request is answered.
    if wanted:
        await session.execute(delete(SkillRequest).where(SkillRequest.user_id == user.sub, SkillRequest.agent_id == agent_id, SkillRequest.skill_id.in_(wanted)))
    await browser_links.wake_for_agent(session, user.sub, agent_id)
    await session.commit()
    return await _agent_skills(session, user, agent_id)
