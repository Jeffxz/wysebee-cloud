"""Tools: a person's library of reusable tools, and which of their agents has which.

As skills (apps/cloud/skills.py) since 2026-11-15: each tool is a
:class:`~apps.cloud.models.UserTool` keyed by ``tool_id``, a UUID — everything links by it,
so a tool can be renamed — given to agents through :class:`~apps.cloud.models.AgentTool`
(the agent by its id, apps/cloud/agents.py). The kinds:

- ``postgres`` and ``snowflake``: a database **connection** (apps/cloud/agent_chat/postgres.py,
  snowflake.py) — ``config`` its host or account, database, user…; its password, token or key
  envelope-encrypted here (apps/cloud/envelope.py), **write-only**: ``has_secret`` says only
  whether one is kept. A save without ``secret`` keeps the stored one, ``""`` removes it.
  Bound to ``<kind>:<tool_id>``: a secret copied to another tool opens nowhere. Since
  2026-11-17 a connection is **not a tool the AI sees**: it is set on the agent's General tab,
  and reached through the agent's SQL Query tools.
- ``sql``: a SQL Query tool (apps/cloud/agent_chat/sql_tools.py) — ``config``
  ``{connection_id, params, sql}``: a template run on one of the person's connections, offered
  to an agent only while the agent has that connection.

**Drafts and proposed changes** from the person's AI app (apps/cloud/tool_drafts.py,
docs/ai-apps-propose.md): a ``sql``, site link or ``program`` tool with ``config.draft`` true
is not given to the agent in effect (:func:`of_agent` leaves it out); a live ``sql`` tool may
hold a proposed change in ``config.pending`` (``{name, description, config}``), never used. A
save here — the person's — keeps neither: creating a draft, or applying or discarding a change.
- ``gmail``, ``calendar``, ``travel``, ``news``, ``website``: a site link — ``config``
  ``{address}``, the address also its ``name``; ``description`` what it is for. Only an agent
  made by pairing the browser extension may be given one (the agent types' ``tool_kinds``).
- ``program``: a program on a Mac (apps/cloud/agent_chat/mac.py) — ``config`` ``{command,
  args}``, its tool ``local_<name>``. Only a Mac agent may be given one; its Mac hears at once.

Until migration 0061 connections were the ``cloud_postgres`` / ``cloud_snowflake`` tables,
keyed by agent name, and links and programs agents' settings — fields a save now drops
(:func:`without_moved`).

- ``GET /tools?kind=`` — ``{tools: [Tool]}``. ``POST /tools`` ``{kind, name, description,
  config, secret?}`` — 201. ``GET|PUT|DELETE /tools/{tool_id}`` — a put may rename it.
- ``POST /tools/test`` ``{kind, name, description, config, secret?, tool_id?}`` — a
  connection tried with the secret typed, else the stored one: ``{ok, version, error}``.
- ``GET /tools/{tool_id}/used-by`` — a connection's SQL Query tools, each with the agents that
  have it: ``{tools: [{id, name, draft, agents: [{id, name, label}]}]}``. A connection is the
  person's, shared by every agent given it, and **cannot be deleted while a SQL tool uses it**
  (a 409 naming them): those are deleted or moved to another connection first.
- ``POST /tools/validate-sql`` ``{name, description, config}`` — a SQL tool checked, its
  template here and its statement by its database (prepared or explained, never run):
  ``{ok, error}``.
- ``GET /agents/{agent_id}/tools`` — ``{tools: [Tool]}``; ``PUT`` ``{kind, tool_ids}`` replaces
  the agent's tools of that kind, in order.

Another person's tool or agent is a 404. Tools of another person cannot be given yet; the
tables keep the agent's owner and the tool's apart for when they can.
"""

import logging
import uuid
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud import agent_types, tool_kinds
from apps.cloud.agent_chat import mac
from apps.cloud.agent_chat import postgres as pg
from apps.cloud.agent_chat import snowflake as sf
from apps.cloud.agent_chat import sql_tools
from apps.cloud.agent_chat.postgres import Invalid
from apps.cloud.auth import User, current_user
from apps.cloud.deps import get_session
from apps.cloud.envelope import EnvelopeError, Kek, Sealed, open_sealed, seal
from apps.cloud.models import AgentTool, UserAgent, UserTool
from apps.cloud.people import Person, named, of_rows, stamp

logger = logging.getLogger("wysebee.cloud.tools")

router = APIRouter(prefix="/v1", tags=["Tools"])

POSTGRES, SNOWFLAKE, PROGRAM, SQL = "postgres", "snowflake", "program", "sql"
CONNECTIONS = (POSTGRES, SNOWFLAKE)
# Each site kind's field in agents' settings before 0061 (the desktop's sites.rs).
SITES = {"gmail": "gmail_accounts", "calendar": "calendar_sites", "travel": "travel_sites", "news": "news_sites", "website": "websites"}
KINDS = (*CONNECTIONS, SQL, *SITES, PROGRAM)
# The tool kind that says which agents may be given it (none: any agent): a pack's (apps/cloud/packs/).
TOOL_KEY = {**{k: k for k in SITES}, PROGRAM: "local"}
# At most so many of a kind an agent, and tools a person.
PER_AGENT = {POSTGRES: pg.MAX_CONNECTIONS, SNOWFLAKE: sf.MAX_CONNECTIONS, SQL: 50, PROGRAM: 20, **{k: 20 for k in SITES}}
MAX_TOOLS = 500
MAX_ADDRESS = 2048
MAX_DESCRIPTION = 1000
GMAIL = "https://mail.google.com/"
PROGRAMS_FIELD = "local_programs"
NO_KEK = {
    POSTGRES: "Passwords cannot be kept in Wysebee Cloud yet: this server has no key-encryption key configured.",
    SNOWFLAKE: "Tokens and keys cannot be kept in Wysebee Cloud yet: this server has no key-encryption key configured.",
}
SECRET_NAME = {POSTGRES: "password", SNOWFLAKE: "token or key"}

ToolId = Path(pattern=r"^[0-9a-fA-F-]{32,36}$")
AgentId = Path(pattern=r"^[0-9a-fA-F-]{32,36}$")


class ToolIn(BaseModel):
    kind: str | None = None
    # A new tool's id, when the page chose it (the SQL tool editor shows it before it is made).
    id: str | None = None
    name: str = ""
    description: str = ""
    config: dict[str, Any] = Field(default_factory=dict)
    secret: str | None = Field(default=None, max_length=sf.MAX_SECRET_CHARS)


class TestIn(ToolIn):
    tool_id: str | None = None


class ToolOut(BaseModel):
    id: str
    kind: str
    name: str
    description: str
    config: dict[str, Any]
    has_secret: bool
    created_at: datetime
    updated_at: datetime
    # Who made it and who changed it last (apps/cloud/people.py).
    created_by: Person
    updated_by: Person


class ToolList(BaseModel):
    tools: list[ToolOut]


class AgentToolsIn(BaseModel):
    kind: str
    tool_ids: list[str]


def _out(row: UserTool, who: dict[str, Person]) -> ToolOut:
    return ToolOut(
        id=str(row.tool_id), kind=row.kind, name=row.name, description=row.description, config=row.config or {},
        has_secret=row.ciphertext is not None, created_at=row.created_at, updated_at=row.updated_at,
        created_by=named(who, row.created_by), updated_by=named(who, row.updated_by),
    )


async def _list(session: AsyncSession, rows: Any) -> ToolList:
    who = await of_rows(session, rows)
    return ToolList(tools=[_out(r, who) for r in rows])


async def _one(session: AsyncSession, row: UserTool) -> ToolOut:
    return _out(row, await of_rows(session, [row]))


def _uuid(value: str) -> str | None:
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError, TypeError):
        return None


def _kind(kind: str | None) -> str:
    if kind not in KINDS:
        raise HTTPException(status_code=422, detail=f"A tool's kind is one of {', '.join(KINDS)}.")
    return kind


# --- the tools as the runners read them -----------------------------------------------------


def pg_connection(tool: UserTool) -> pg.Connection:
    c = tool.config or {}
    return pg.Connection(tool.name, tool.description, c.get("host", ""), c.get("port", pg.DEFAULT_PORT), c.get("database", ""), c.get("user", ""), c.get("ssl", "verify"), bool(c.get("changes")))


def sf_connection(tool: UserTool) -> sf.Connection:
    c = tool.config or {}
    return sf.Connection(
        tool.name, tool.description, c.get("account", ""), c.get("database", ""), c.get("warehouse", ""), c.get("schema", ""),
        c.get("role", ""), c.get("user", ""), c.get("auth", "token"), bool(c.get("changes")),
    )


def sql_tool(tool: UserTool) -> sql_tools.SqlTool | None:
    """A SQL tool as it runs; None when it can no longer be read."""
    try:
        return sql_tools.parse(tool.name, tool.description, tool.config or {})
    except Invalid:
        return None


def program_row(tool: UserTool) -> dict[str, Any]:
    """A program as a Mac's poll carries it, and as the runner reads it."""
    c = tool.config or {}
    return {"name": tool.name, "description": tool.description, "command": c.get("command", ""), "args": c.get("args", [])}


def programs(tools: list[UserTool]) -> list[mac.Program]:
    return [p for p in (mac.parse_one(program_row(t)) for t in tools if t.kind == PROGRAM) if p is not None]


def _aad(tool: UserTool) -> str:
    return tool.secret_aad or f"{tool.kind}:{tool.tool_id}"


async def secret_of(kek: Kek | None, tool: UserTool) -> str | None:
    """A connection's stored password, token or key, for a call or a test only — never logged,
    never returned."""
    if tool.ciphertext is None:
        return None
    if kek is None:
        raise Invalid(NO_KEK[tool.kind])
    try:
        return await open_sealed(kek, tool.user_id, _aad(tool), Sealed(tool.ciphertext, tool.nonce, tool.wrapped_key, tool.kek_id))
    except EnvelopeError as exc:
        logger.warning("tool_secret_unreadable: %s", exc)
        raise Invalid(f"The {SECRET_NAME[tool.kind]} for '{tool.name}' could not be read: {exc}") from exc


def is_draft(tool: UserTool) -> bool:
    """A tool the person's AI app drafted (apps/cloud/tool_drafts.py), not created yet."""
    return (tool.config or {}).get("draft") is True


async def of_agent(session: AsyncSession, user_id: str, agent_id: str | None, drafts: bool = False) -> list[UserTool]:
    """The tools of the person's agent, by kind and in its order; none for an agent not stored
    yet (Wysebee's own, before it has a row: ``agent_id`` None). **Drafts from the person's
    AI app are left out** — not offered, not sent to a Mac — unless ``drafts``."""
    if agent_id is None:
        return []
    found = list((await session.scalars(
        select(UserTool)
        .join(AgentTool, AgentTool.tool_id == UserTool.tool_id)
        .where(AgentTool.user_id == user_id, AgentTool.agent_id == agent_id)
        .order_by(UserTool.kind, AgentTool.position)
    )).all())
    return found if drafts else [t for t in found if not is_draft(t)]


# What an agent's settings no longer hold: the site links and programs (tools of their own
# since migration 0061) and what only Wysebee Desktop wrote (gone with migration 0062) —
# where it lived, its connections, local database and programs on a computer.
GONE = (*SITES.values(), PROGRAMS_FIELD, "home", "home_name", "postgres_databases", "snowflake_databases", "sqlite_database", "browser", "folders")


def without_moved(config: dict[str, Any]) -> dict[str, Any]:
    """An agent's settings as they are saved: without :data:`GONE`."""
    return {k: v for k, v in config.items() if k not in GONE}


# --- checks ----------------------------------------------------------------------------------


def _site(kind: str, body: ToolIn) -> tuple[str, str, dict[str, Any]]:
    address = str(body.config.get("address") or "").strip()
    description = body.description.strip()
    parts = urlsplit(address) if address and not any(c.isspace() for c in address) else None
    ok = parts is not None and len(address) <= MAX_ADDRESS and (address.startswith(GMAIL) if kind == "gmail" else parts.scheme in ("http", "https") and bool(parts.hostname))
    if not ok:
        raise HTTPException(status_code=422, detail=f"Give a link that starts with {GMAIL if kind == 'gmail' else 'https://'}.")
    if not description or len(description) > MAX_DESCRIPTION or "\n" in description:
        raise HTTPException(status_code=422, detail=f"Say what the link is for, on one line of at most {MAX_DESCRIPTION} characters.")
    return address, description, {"address": address}


def _checked(kind: str, body: ToolIn) -> tuple[str, str, dict[str, Any]]:
    """The name, description and config to keep, or a 422 saying what is wrong."""
    name, description = body.name.strip(), body.description.strip()
    try:
        if kind == POSTGRES:
            c = pg.parse(name, {**body.config, "description": description})
            return c.name, c.description, {"host": c.host, "port": c.port, "database": c.database, "user": c.user, "ssl": c.ssl, "changes": c.changes}
        if kind == SNOWFLAKE:
            s = sf.parse(name, {**body.config, "description": description})
            return s.name, s.description, {"account": s.account, "database": s.database, "warehouse": s.warehouse, "schema": s.schema, "role": s.role, "user": s.user, "auth": s.auth, "changes": s.changes}
        if kind == SQL:
            t = sql_tools.parse(name, description, body.config)
            return t.name, t.description, t.config()
    except Invalid as e:
        raise HTTPException(status_code=422, detail=e.message) from e
    if kind in SITES:
        return _site(kind, body)
    program = {"name": name, "description": description, "command": body.config.get("command"), "args": body.config.get("args", [])}
    if mac.parse_one(program) is None:
        raise HTTPException(
            status_code=422,
            detail="A program has a name (a lowercase letter, then lowercase letters, digits or _), says what it does, and has a command; each argument is a fixed value or a blank to fill in, named once.",
        )
    return name, description, {"command": str(program["command"]).strip(), "args": program["args"]}


async def _sealed(request: Request, tool: UserTool, body: ToolIn) -> None:
    """A connection's secret as the save says: kept (none sent), removed (``""``) or sealed."""
    if tool.kind not in CONNECTIONS or body.secret is None:
        return
    secret = body.secret if tool.kind == POSTGRES else body.secret.strip()
    if not secret:
        tool.ciphertext = tool.nonce = tool.wrapped_key = tool.kek_id = tool.secret_aad = None
        return
    kek = getattr(request.app.state, "ai_kek", None)
    if kek is None:
        raise HTTPException(status_code=503, detail=NO_KEK[tool.kind])
    tool.secret_aad = None
    try:
        s = await seal(kek, tool.user_id, _aad(tool), secret)
    except EnvelopeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    tool.ciphertext, tool.nonce, tool.wrapped_key, tool.kek_id = s.ciphertext, s.nonce, s.wrapped_key, s.kek_id


async def _connection(session: AsyncSession, user: User, connection_id: str) -> UserTool:
    """A SQL tool's connection: one of the person's, or a 422."""
    row = await session.get(UserTool, connection_id)
    if row is None or row.user_id != user.sub or row.kind not in CONNECTIONS:
        raise HTTPException(status_code=422, detail="Pick one of your database connections: that one is not there any more.")
    return row


async def _mine(session: AsyncSession, user: User, tool_id: str | None) -> UserTool:
    tid = _uuid(tool_id or "")
    row = await session.get(UserTool, tid, populate_existing=True) if tid else None
    if row is None or row.user_id != user.sub:
        raise HTTPException(status_code=404, detail="There is no such tool.")
    return row


async def _commit(session: AsyncSession, kind: str, name: str) -> None:
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=409, detail=f"There is already a {kind} tool named '{name}'.") from exc


async def _taken(session: AsyncSession, user: User, kind: str, name: str, but: str | None = None) -> None:
    query = select(UserTool.tool_id).where(UserTool.user_id == user.sub, UserTool.kind == kind, UserTool.name == name)
    if but is not None:
        query = query.where(UserTool.tool_id != but)
    if await session.scalar(query) is not None:
        raise HTTPException(status_code=409, detail=f"There is already a {kind} tool named '{name}'.")


async def _wake(session: AsyncSession, user_id: str, tool: UserTool) -> None:
    """A program changed or went: the Macs of the agents that have it hear at once."""
    if tool.kind != PROGRAM:
        return
    from apps.cloud import browser_links

    agents = (await session.scalars(select(AgentTool.agent_id).where(AgentTool.user_id == user_id, AgentTool.tool_id == tool.tool_id))).all()
    await browser_links.wake_for_agent(session, user_id, *agents)


# --- routes ----------------------------------------------------------------------------------


@router.get("/tools", response_model=ToolList)
async def list_tools(kind: str | None = Query(default=None), user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> ToolList:
    query = select(UserTool).where(UserTool.user_id == user.sub)
    if kind is not None:
        query = query.where(UserTool.kind == _kind(kind))
    rows = (await session.scalars(query.order_by(UserTool.kind, UserTool.name))).all()
    return await _list(session, rows)


@router.post("/tools", response_model=ToolOut, status_code=201)
async def create_tool(request: Request, body: ToolIn, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> ToolOut:
    kind = _kind(body.kind)
    name, description, config = _checked(kind, body)
    if kind == SQL:
        await _connection(session, user, config["connection_id"])
    await _taken(session, user, kind, name)
    tool_id = str(uuid.uuid4())
    if body.id is not None:
        tool_id = _uuid(body.id) or ""
        if not tool_id or await session.get(UserTool, tool_id) is not None:
            raise HTTPException(status_code=422, detail="'id' is a new tool's id: a UUID no tool has.")
    count = await session.scalar(select(func.count()).select_from(UserTool).where(UserTool.user_id == user.sub)) or 0
    if count >= MAX_TOOLS:
        raise HTTPException(status_code=422, detail=f"You have at most {MAX_TOOLS} tools. Delete one first.")
    row = UserTool(tool_id=tool_id, user_id=user.sub, kind=kind, name=name, description=description, config=config)
    stamp(row, user.sub, made=True)
    await _sealed(request, row, body)
    session.add(row)
    await _commit(session, kind, name)
    await session.refresh(row)
    logger.info("tool_saved kind=%s", kind)
    return await _one(session, row)


@router.get("/tools/{tool_id}", response_model=ToolOut)
async def get_tool(tool_id: str = ToolId, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> ToolOut:
    return await _one(session, await _mine(session, user, tool_id))


@router.put("/tools/{tool_id}", response_model=ToolOut)
async def update_tool(request: Request, body: ToolIn, tool_id: str = ToolId, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> ToolOut:
    row = await _mine(session, user, tool_id)
    if body.kind not in (None, row.kind):
        raise HTTPException(status_code=422, detail="A tool's kind cannot change.")
    name, description, config = _checked(row.kind, body)
    if row.kind == SQL:
        await _connection(session, user, config["connection_id"])
    await _taken(session, user, row.kind, name, but=row.tool_id)
    await _sealed(request, row, body)
    row.name, row.description, row.config, row.updated_at = name, description, config, func.now()
    stamp(row, user.sub)
    await _wake(session, user.sub, row)
    await _commit(session, row.kind, name)
    await session.refresh(row)
    logger.info("tool_saved kind=%s", row.kind)
    return await _one(session, row)


class UsingAgent(BaseModel):
    id: str
    name: str
    label: str


class UsingTool(BaseModel):
    id: str
    name: str
    draft: bool
    agents: list[UsingAgent]


class UsedBy(BaseModel):
    tools: list[UsingTool]


async def _used_by(session: AsyncSession, user_id: str, connection_id: str) -> list[UsingTool]:
    """The person's SQL tools on a connection (drafts too), each with the agents that have it."""
    rows = (await session.scalars(
        select(UserTool).where(UserTool.user_id == user_id, UserTool.kind == SQL, UserTool.config["connection_id"].astext == connection_id).order_by(UserTool.name)
    )).all()
    if not rows:
        return []
    links = (await session.execute(
        select(AgentTool.tool_id, UserAgent.agent_id, UserAgent.name, UserAgent.config)
        .join(UserAgent, (UserAgent.agent_id == AgentTool.agent_id) & (UserAgent.user_id == AgentTool.user_id))
        .where(AgentTool.user_id == user_id, AgentTool.tool_id.in_([r.tool_id for r in rows]))
        .order_by(UserAgent.name)
    )).all()
    out = []
    for r in rows:
        agents = [
            UsingAgent(id=str(a), name=n, label=str((c or {}).get("label") or "").strip() or n)
            for t, a, n, c in links if str(t) == str(r.tool_id)
        ]
        out.append(UsingTool(id=str(r.tool_id), name=r.name, draft=(r.config or {}).get("draft") is True, agents=agents))
    return out


@router.get("/tools/{tool_id}/used-by", response_model=UsedBy)
async def used_by(tool_id: str = ToolId, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> UsedBy:
    row = await _mine(session, user, tool_id)
    return UsedBy(tools=await _used_by(session, user.sub, str(row.tool_id)) if row.kind in CONNECTIONS else [])


@router.delete("/tools/{tool_id}", status_code=204)
async def delete_tool(tool_id: str = ToolId, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> Response:
    row = await _mine(session, user, tool_id)
    if row.kind in CONNECTIONS:
        using = await _used_by(session, user.sub, str(row.tool_id))
        if using:
            names = ", ".join(t.name for t in using)
            raise HTTPException(status_code=409, detail=f"'{row.name}' is used by SQL Query tools ({names}): delete them, or move them to another connection, first.")
    # Woken before the links go, so the Macs of the agents that had it are found.
    await _wake(session, user.sub, row)
    await session.delete(row)
    await session.commit()
    return Response(status_code=204)


@router.post("/tools/test")
async def test_tool(request: Request, body: TestIn, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """A connection tried with the secret typed, else the stored one; nothing saved."""
    kind = _kind(body.kind)
    if kind not in CONNECTIONS:
        raise HTTPException(status_code=422, detail="Only a database connection can be tested.")
    name, description, config = _checked(kind, body)
    state = request.app.state
    limit = state.postgres_limit if kind == POSTGRES else state.snowflake_limit
    if not limit.allow(user.sub):
        most = pg.CALLS_PER_MINUTE if kind == POSTGRES else sf.CALLS_PER_MINUTE
        raise HTTPException(status_code=429, detail=f"At most {most} {'PostgreSQL' if kind == POSTGRES else 'Snowflake'} calls a minute: try again shortly.")
    stored = await _mine(session, user, body.tool_id) if body.tool_id else None
    try:
        typed = body.secret if kind == POSTGRES or body.secret is None else body.secret.strip()
        secret = (typed or None) if typed is not None else (await secret_of(getattr(state, "ai_kek", None), stored) if stored is not None else None)
        probe = UserTool(tool_id="", user_id=user.sub, kind=kind, name=name, description=description, config=config)
        version = await (pg.test(pg_connection(probe), secret) if kind == POSTGRES else sf.test(state.ai_http, sf_connection(probe), secret))
        return {"ok": True, "version": version, "error": None}
    except Invalid as e:
        return {"ok": False, "version": None, "error": e.message}


class ValidateIn(BaseModel):
    name: str = ""
    description: str = ""
    config: dict[str, Any] = Field(default_factory=dict)


@router.post("/tools/validate-sql")
async def validate_sql(request: Request, body: ValidateIn, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """A SQL tool checked, nothing saved: its template here, then its statement by its database
    — every part kept, each parameter its default or a sample value — prepared (PostgreSQL) or
    explained (Snowflake), never run."""
    try:
        tool = sql_tools.parse(body.name.strip() or "check", body.description.strip() or "check", body.config)
    except Invalid as e:
        return {"ok": False, "error": e.message}
    conn = await _connection(session, user, tool.connection_id)
    state = request.app.state
    limit = state.postgres_limit if conn.kind == POSTGRES else state.snowflake_limit
    if not limit.allow(user.sub):
        most = pg.CALLS_PER_MINUTE if conn.kind == POSTGRES else sf.CALLS_PER_MINUTE
        raise HTTPException(status_code=429, detail=f"At most {most} {'PostgreSQL' if conn.kind == POSTGRES else 'Snowflake'} calls a minute: try again shortly.")
    try:
        secret = await secret_of(getattr(state, "ai_kek", None), conn)
        if conn.kind == POSTGRES:
            c = pg_connection(conn)
            await pg.check(c, secret, sql_tools.render(tool, {}, POSTGRES, c.database, sample=True).sql)
        else:
            s = sf_connection(conn)
            r = sql_tools.render(tool, {}, SNOWFLAKE, s.database, sample=True)
            await sf.check(state.ai_http, s, secret, r.sql, sql_tools.snowflake_bindings(r.values))
    except Invalid as e:
        return {"ok": False, "error": e.message}
    return {"ok": True, "error": None}


async def _agent(session: AsyncSession, user: User, agent_id: str) -> UserAgent:
    from apps.cloud import agents

    row = await agents.by_id(session, user.sub, agent_id)
    if row is None:
        raise HTTPException(status_code=404, detail="There is no such agent.")
    return row


async def _agent_tools(session: AsyncSession, user: User, agent_id: str) -> ToolList:
    rows = (await session.scalars(
        select(UserTool).join(AgentTool, AgentTool.tool_id == UserTool.tool_id)
        .where(AgentTool.user_id == user.sub, AgentTool.agent_id == agent_id).order_by(UserTool.kind, AgentTool.position)
    )).all()
    return await _list(session, rows)


@router.get("/agents/{agent_id}/tools", response_model=ToolList)
async def get_agent_tools(agent_id: str = AgentId, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> ToolList:
    return await _agent_tools(session, user, (await _agent(session, user, agent_id)).agent_id)


@router.put("/agents/{agent_id}/tools", response_model=ToolList)
async def set_agent_tools(body: AgentToolsIn, agent_id: str = AgentId, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> ToolList:
    from apps.cloud import browser_links

    kind = _kind(body.kind)
    agent = await _agent(session, user, agent_id)
    wanted = [_uuid(i) for i in body.tool_ids]
    if any(i is None for i in wanted):
        raise HTTPException(status_code=422, detail="'tool_ids' holds tools' ids.")
    if len(set(wanted)) != len(wanted):
        raise HTTPException(status_code=422, detail="A tool is in 'tool_ids' twice.")
    if len(wanted) > PER_AGENT[kind]:
        raise HTTPException(status_code=422, detail=f"An agent has at most {PER_AGENT[kind]} {kind} tools.")
    held = set((await session.scalars(select(UserTool.tool_id).where(UserTool.user_id == user.sub, UserTool.kind == kind, UserTool.tool_id.in_(wanted)))).all()) if wanted else set()
    if any(i not in held for i in wanted):
        raise HTTPException(status_code=404, detail=f"There is no such {kind} tool.")
    mine = select(AgentTool.tool_id).join(UserTool, UserTool.tool_id == AgentTool.tool_id).where(AgentTool.user_id == user.sub, AgentTool.agent_id == agent.agent_id, UserTool.kind == kind)
    had = set((await session.scalars(mine)).all())
    # Giving one this agent's type may not have is refused; keeping or taking one never is.
    key = TOOL_KEY.get(kind)
    if key is not None and not had and set(wanted) - had:
        why = tool_kinds.may_have(key, dict(agent.config or {}), await agent_types.all_types(session))
        if why is not None:
            raise browser_links.Refused(422, tool_kinds.CODE, why)
    await session.execute(delete(AgentTool).where(AgentTool.user_id == user.sub, AgentTool.agent_id == agent.agent_id, AgentTool.tool_id.in_(had)))
    session.add_all(AgentTool(user_id=user.sub, agent_id=agent.agent_id, tool_id=i, position=n) for n, i in enumerate(wanted))
    if kind == PROGRAM:
        await browser_links.wake_for_agent(session, user.sub, agent.agent_id)
    await session.commit()
    return await _agent_tools(session, user, agent.agent_id)
