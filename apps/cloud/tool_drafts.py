"""Tools drafted, changes proposed and switches requested by the person's AI app (2026-11-17,
the person's call: **AI apps propose, the person approves** — docs/ai-apps-propose.md), through
Wysebee Assistant (``/assistant/mcp``, apps/cloud/agent_mcp.py).

- ``draft_sql_tool``, ``draft_site_link``, ``draft_program``: a tool kept with ``config.draft``
  true and given to the agent — left out of everything that runs (apps/cloud/user_tools.py
  ``of_agent``: the agent's tools, a Mac's programs) until the person creates it.
- ``propose_sql_tool_change``: a change to one of the agent's SQL tools, kept in its
  ``config.pending``; the live version runs until the person applies it.
- ``request_switch``: asks the person to turn on one of the agent's switches (Run any program,
  Screen control…), kept in the agent's ``switch_requests``; only the person turns it on.
- ``propose_skill``: asks for one of the person's skills on the agent (a ``skill_requests``
  row, apps/cloud/skill_changes.py); only the person gives it.
- ``propose_instruction``: a new version of the agent's Instruction — the notes every AI app
  reads before using the agent — kept in its ``instruction_proposal``; the agent's own stays
  until the person saves the new one.

Each tells the person (a notification on Activity), and they review it on the agent's Tools
tab. Nothing here can create, apply or turn on what it proposed.

SQL Query tools:

**The AI app drafts; the person creates.** A SQL tool is a statement the agent may run on a
database, so the AI app never makes one that runs: ``draft_sql_tool`` keeps a ``sql`` tool
(apps/cloud/user_tools.py) with ``config.draft`` true, given to the agent and listed on its
Tools tab as a draft, and leaves the person a notification. **A draft is not offered to the
agent** (apps/cloud/agent_chat/toolbox.py) until the person reviews it in the SQL tool editor
and clicks Create tool — a save from the website, which keeps the tool without ``draft``.
Nothing here can change a tool that is not a draft.

To write a good one, the AI app also has, read-only: ``list_database_connections`` (an
agent's connections, never their secrets or addresses), ``describe_database`` (a connection's
tables and columns — only names and types, no rows) and ``check_sql_tool`` (the editor's
Validate: the template checked, and the statement prepared or explained by the database,
never run).
"""

import json
import logging
import uuid
from typing import Any

from fastapi import HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud import notifications, user_tools
from apps.cloud.agent_chat import postgres as pg
from apps.cloud.agent_chat import snowflake as sf
from apps.cloud.agent_chat import sql_tools
from apps.cloud.agent_chat.postgres import Invalid
from apps.cloud.auth import User
from apps.cloud.models import AgentTool, UserAgent, UserTool
from apps.cloud.people import stamp
from apps.cloud.relay import public_base

logger = logging.getLogger("wysebee.cloud.tool_drafts")

AGENT = {"type": "string", "description": "The agent's @handle (without the @), as list_agents names it."}
CONNECTION = {"type": "string", "description": "The connection's name, as list_database_connections gives it."}
PARAM = {
    "type": "object",
    "properties": {
        "name": {"type": "string", "description": "A letter or _, then letters, digits or _ (not 'database'). Written {name} in the SQL."},
        "type": {"type": "string", "enum": list(sql_tools.TYPES)},
        "description": {"type": "string", "description": "For the AI that calls the tool: what the value is and where it comes from."},
        "required": {"type": "boolean"},
        "default": {"type": "string", "description": "Its value when none is given."},
        "optional": {"type": "boolean", "description": "Only filter when set: it sits inside [[ ]] in the SQL, a part left out when it has no value."},
    },
    "required": ["name", "type"],
}
TOOL_FIELDS = {
    "agent": AGENT,
    "name": {"type": "string", "description": "The tool's name: letters, digits, _ and -, starting and ending with a letter, digit or _, at most 64."},
    "description": {"type": "string", "description": "What the tool computes: the AI that calls it picks it by this."},
    "connection": CONNECTION,
    "params": {"type": "array", "items": PARAM, "description": "Its input parameters."},
    "sql": {
        "type": "string",
        "description": (
            "One statement. {param} is a parameter, always bound (never written into the SQL); {database} the connection's "
            "database; [[ AND col = {param} ]] a part left out when an 'optional' parameter has no value."
        ),
    },
}
TOOL_SCHEMA = {"type": "object", "properties": TOOL_FIELDS, "required": ["agent", "name", "description", "connection", "sql"]}

TOOLS: list[dict[str, Any]] = [
    {
        "name": "list_database_connections",
        "title": "List an agent's database connections",
        "description": "The PostgreSQL and Snowflake connections one of the person's agents has (set on its General tab): each one's name, kind, database and whether it allows changes — and the agent's SQL Query tools on them. Start here to draft a SQL Query tool.",
        "inputSchema": {"type": "object", "properties": {"agent": AGENT}, "required": ["agent"]},
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "describe_database",
        "title": "A database's tables and columns",
        "description": "The tables of one of an agent's database connections, each with its columns and their types — names only, never rows. Use it to write a SQL Query tool's statement.",
        "inputSchema": {"type": "object", "properties": {"agent": AGENT, "connection": CONNECTION}, "required": ["agent", "connection"]},
        "annotations": {"readOnlyHint": True, "openWorldHint": True},
    },
    {
        "name": "check_sql_tool",
        "title": "Check a SQL Query tool",
        "description": "Check a SQL Query tool before drafting it, as the editor's Validate does: its name, parameters and template, then its statement by the database — prepared (PostgreSQL) or explained (Snowflake), never run. Says what is wrong, or that it is valid.",
        "inputSchema": TOOL_SCHEMA,
        "annotations": {"readOnlyHint": True, "openWorldHint": True},
    },
    {
        "name": "draft_sql_tool",
        "title": "Draft a SQL Query tool",
        "description": (
            "Draft a SQL Query tool for one of the person's agents: a named statement on one of its database connections, with input "
            "parameters the agent fills in. It is only a draft: it shows on the agent's Tools tab for the person to review, and the "
            "agent cannot use it until they click Create tool. Check it with check_sql_tool first."
        ),
        "inputSchema": TOOL_SCHEMA,
        "annotations": {"readOnlyHint": False, "destructiveHint": False},
    },
]
TOOLS += [
    {
        "name": "propose_sql_tool_change",
        "title": "Propose a change to a SQL Query tool",
        "description": (
            "Propose a new version of one of an agent's SQL Query tools ('tool': its name now), given whole as for draft_sql_tool. "
            "Only proposed: the agent goes on using the tool as it is until the person reviews the change on its Tools tab and "
            "applies it. Check it with check_sql_tool first."
        ),
        "inputSchema": {**TOOL_SCHEMA, "properties": {"tool": {"type": "string", "description": "The SQL tool's name now."}, **TOOL_FIELDS}, "required": ["tool", *TOOL_SCHEMA["required"]]},
        "annotations": {"readOnlyHint": False, "destructiveHint": False},
    },
    {
        "name": "draft_site_link",
        "title": "Draft a site link",
        "description": (
            "Draft a site link for an agent made by pairing the Wysebee Agent browser extension: a Gmail, Calendar, Travel, News or "
            "Website address and what it is for. Only a draft: the person reviews it on the agent's Tools tab and creates it."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent": AGENT,
                "kind": {"type": "string", "enum": list(user_tools.SITES)},
                "address": {"type": "string", "description": "The link, https://… (Gmail's starts with https://mail.google.com/)."},
                "description": {"type": "string", "description": "What it is for, on one line."},
            },
            "required": ["agent", "kind", "address", "description"],
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False},
    },
    {
        "name": "draft_program",
        "title": "Draft a program",
        "description": (
            "Draft a program for an agent made by pairing Wysebee Agent for Mac, Windows or Linux: a name, what it does, the command and its "
            "arguments, each a fixed value or a blank the agent fills in. Only a draft: the person reviews it on the agent's Tools tab "
            "and creates it, and Wysebee Agent on the computer asks them again before it runs."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent": AGENT,
                "name": {"type": "string", "description": "A lowercase letter, then lowercase letters, digits or _."},
                "description": {"type": "string", "description": "What it does."},
                "command": {"type": "string", "description": "The program to run, e.g. /usr/bin/say."},
                "args": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "value": {"type": "string", "description": "A fixed argument."},
                            "param": {"type": "string", "description": "Or a blank's name, which the agent fills in."},
                            "description": {"type": "string", "description": "What goes in the blank."},
                        },
                    },
                },
            },
            "required": ["agent", "name", "description", "command"],
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False},
    },
    {
        "name": "request_switch",
        "title": "Ask the person to turn on an agent's switch",
        "description": (
            "Ask the person to turn on one of an agent's switches: browser_access, browser_devtools (a browser agent's), or "
            "run_any_program, screen_control, developer_access, android_toolkit, ios_toolkit (a Mac, Windows PC or Linux machine agent's; "
            "screen_control not a Linux machine's, ios_toolkit a Mac's alone). Only a request, with your reason: the person sees what it allows and turns it on, or not."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent": AGENT,
                "switch": {"type": "string", "enum": ["browser_access", "browser_devtools", "run_any_program", "screen_control", "developer_access", "android_toolkit", "ios_toolkit"]},
                "reason": {"type": "string", "description": "Why the agent needs it, on one line, for the person."},
            },
            "required": ["agent", "switch", "reason"],
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False},
    },
]
TOOLS.append({
    "name": "propose_skill",
    "title": "Propose a skill for an agent",
    "description": (
        "Ask the person to give one of their skills (by its name; create_skill makes a new one) to one of their agents, with your "
        "reason. Only a request: the agent does not have the skill until the person gives it on the agent's Tools tab. Changes "
        "you proposed to the skill's files wait for the person on its page too."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "agent": AGENT,
            "skill": {"type": "string", "description": "The skill's name, as in the person's Skills library."},
            "reason": {"type": "string", "description": "Why the agent needs it, on one line, for the person."},
        },
        "required": ["agent", "skill", "reason"],
    },
    "annotations": {"readOnlyHint": False, "destructiveHint": False},
})
TOOLS.append({
    "name": "propose_instruction",
    "title": "Propose an agent's Instruction",
    "description": (
        "Propose a new version of an agent's Instruction — the person's notes on what the agent is for and how to use it, which "
        "list_agent_tools gives every AI app — whole, in markdown, with your reason. Only proposed: the agent's Instruction stays "
        "as it is until the person reviews yours and saves it. Read the current one with list_agent_tools first."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "agent": AGENT,
            "text": {"type": "string", "description": "The whole new Instruction, in markdown."},
            "reason": {"type": "string", "description": "Why, on one line, for the person."},
        },
        "required": ["agent", "text", "reason"],
    },
    "annotations": {"readOnlyHint": False, "destructiveHint": False},
})
TOOL_NAMES = {t["name"] for t in TOOLS}
FREE = {"list_database_connections"}
INSTRUCTION_FIELD = "instruction_proposal"
MAX_INSTRUCTION = 20_000
def switches() -> dict[str, tuple[str | None, str]]:
    """Each switch an agent may be asked to turn on — its agent type packs' (apps/cloud/agent_packs.py),
    in their order: its field, the tool kind that says which agents may have it (None: an agent
    of the pack's kind, by its link) and the English name the person reads. ``request_switch``'s
    ``enum`` lists the built-in packs' (tests/test_tool_proposals.py keeps them in step)."""
    from apps.cloud import agent_packs

    return {s.field: (s.tool_kind, s.label) for p in agent_packs.known().packs for s in p.settings}
REQUESTS_FIELD = "switch_requests"
is_draft = user_tools.is_draft


async def _agent(session: AsyncSession, user_id: str, handle: Any, visible: list[str]) -> UserAgent | str:
    from apps.cloud import agents

    if not isinstance(handle, str) or not handle.strip():
        return "Give the agent's handle as 'agent' (list_agents names them)."
    handle = handle.strip().removeprefix("@")
    found = await agents.find(session, user_id, handle) if handle in visible else None
    if found is None or not found.agent_id:
        return f"The person has no agent @{handle} here. List them with list_agents."
    return found


async def _connections(session: AsyncSession, user_id: str, agent: UserAgent) -> list[UserTool]:
    return [t for t in await user_tools.of_agent(session, user_id, agent.agent_id, drafts=True) if t.kind in user_tools.CONNECTIONS]


def _pick(connections: list[UserTool], name: Any) -> UserTool | str:
    found = [c for c in connections if c.name == name]
    if len(found) != 1:
        names = ", ".join(c.name for c in connections) or "none — the person adds one on the agent's General tab"
        return f"Say which connection, by its name: {names}."
    return found[0]


def _limit(request: Request, user_id: str, kind: str) -> str | None:
    state = request.app.state
    limit = state.postgres_limit if kind == user_tools.POSTGRES else state.snowflake_limit
    if limit.allow(user_id):
        return None
    most = pg.CALLS_PER_MINUTE if kind == user_tools.POSTGRES else sf.CALLS_PER_MINUTE
    return f"At most {most} {'PostgreSQL' if kind == user_tools.POSTGRES else 'Snowflake'} calls a minute: wait a moment before the next."


def _parsed(args: dict[str, Any], connection: UserTool) -> sql_tools.SqlTool:
    params = args.get("params") or []
    return sql_tools.parse(str(args.get("name") or "").strip(), str(args.get("description") or ""), {"connection_id": connection.tool_id, "params": params, "sql": args.get("sql")})


async def _check(request: Request, user_id: str, tool: sql_tools.SqlTool, conn: UserTool) -> None:
    """The editor's Validate (apps/cloud/user_tools.py ``validate_sql``): :class:`Invalid` when
    the database refuses the statement."""
    state = request.app.state
    secret = await user_tools.secret_of(getattr(state, "ai_kek", None), conn)
    if conn.kind == user_tools.POSTGRES:
        c = user_tools.pg_connection(conn)
        await pg.check(c, secret, sql_tools.render(tool, {}, user_tools.POSTGRES, c.database, sample=True).sql)
    else:
        s = user_tools.sf_connection(conn)
        r = sql_tools.render(tool, {}, user_tools.SNOWFLAKE, s.database, sample=True)
        await sf.check(state.ai_http, s, secret, r.sql, sql_tools.snowflake_bindings(r.values))


async def call_tool(request: Request, user: User, name: str, args: dict[str, Any], visible: list[str]) -> tuple[str, bool]:
    """Run one of the draft tools: its answer, and whether it is an error. ``visible``: the
    handles of the agents the AI app may use."""
    async with request.app.state.db.sessionmaker() as session:
        agent = await _agent(session, user.sub, args.get("agent"), visible)
        if isinstance(agent, str):
            return agent, True
        if name == "draft_site_link":
            return await _draft_site(request, session, user.sub, agent, args)
        if name == "draft_program":
            return await _draft_program(request, session, user.sub, agent, args)
        if name == "request_switch":
            return await _request_switch(request, session, user.sub, agent, args)
        if name == "propose_instruction":
            return await _propose_instruction(request, session, user.sub, agent, args)
        if name == "propose_skill":
            return await _propose_skill(request, session, user.sub, agent, args)
        connections = await _connections(session, user.sub, agent)
        if name == "list_database_connections":
            return await _list(session, user.sub, agent, connections), False
        conn = _pick(connections, args.get("connection"))
        if isinstance(conn, str):
            return conn, True
        if name == "describe_database":
            return await _describe(request, user.sub, conn)
        try:
            tool = _parsed(args, conn)
        except Invalid as e:
            return e.message, True
        if name == "check_sql_tool":
            if (why := _limit(request, user.sub, conn.kind)) is not None:
                return why, True
            try:
                await _check(request, user.sub, tool, conn)
            except Invalid as e:
                return e.message, True
            return "Valid: the database accepts the statement (it was not run). Draft it with draft_sql_tool.", False
        if name == "propose_sql_tool_change":
            return await _propose(request, session, user.sub, agent, tool, args.get("tool"))
        return await _draft(request, session, user.sub, agent, tool)


async def _list(session: AsyncSession, user_id: str, agent: UserAgent, connections: list[UserTool]) -> str:
    if not connections:
        return f"@{agent.name} has no database connection yet: the person adds a PostgreSQL or Snowflake one on its General tab."
    lines = [f"@{agent.name}'s database connections:"]
    for c in connections:
        kind = "PostgreSQL" if c.kind == user_tools.POSTGRES else "Snowflake"
        mode = "read and write" if (c.config or {}).get("changes") else "read only"
        what = f" — {c.description}" if c.description else ""
        lines.append(f"- {c.name} ({kind}, database {(c.config or {}).get('database', '')}, {mode}){what}")
    held = [t for t in await user_tools.of_agent(session, user_id, agent.agent_id, drafts=True) if t.kind == user_tools.SQL]
    if held:
        lines.append("\nIts SQL Query tools:")
        waiting = lambda t: " (a draft, waiting for the person)" if is_draft(t) else " (a change proposed, waiting for the person)" if (t.config or {}).get("pending") else ""  # noqa: E731
        lines += [f"- {t.name}{waiting(t)}: {t.description}" for t in held]
    return "\n".join(lines)


async def _describe(request: Request, user_id: str, conn: UserTool) -> tuple[str, bool]:
    if (why := _limit(request, user_id, conn.kind)) is not None:
        return why, True
    state = request.app.state

    async def secret(_: str) -> str | None:
        return await user_tools.secret_of(getattr(state, "ai_kek", None), conn)

    # The schema statements only read names and types, in a read-only transaction.
    if conn.kind == user_tools.POSTGRES:
        out = await pg.call([user_tools.pg_connection(conn)], secret, pg.SCHEMA, {"database": conn.name})
    else:
        out = await sf.call(state.ai_http, [user_tools.sf_connection(conn)], secret, sf.SCHEMA, {"database": conn.name})
    return out.text, out.is_error


def _review(request: Request, agent: UserAgent) -> str:
    return f"{public_base(request)}/app/#/agents/{agent.agent_id}/tools"


async def _tell(request: Request, session: AsyncSession, user_id: str, agent: UserAgent, title: str, what: str) -> str:
    """The person's notification, from the agent; the review address."""
    review = _review(request, agent)
    await notifications.send(session, user_id, title, f"{what}\n\nReview it on the agent's Tools tab: {review}", agent.agent_id)
    return review


async def _keep_draft(session: AsyncSession, user_id: str, agent: UserAgent, kind: str, name: str, description: str, config: dict[str, Any]) -> UserTool | str:
    """A drafted tool, given to the agent; or why not."""
    taken = await session.scalar(select(UserTool.tool_id).where(UserTool.user_id == user_id, UserTool.kind == kind, UserTool.name == name))
    if taken is not None:
        what = "SQL tool" if kind == user_tools.SQL else "program" if kind == user_tools.PROGRAM else f"{kind} link"
        return f"The person already has a {what} named '{name}': pick another name, or ask them to give it to @{agent.name} on its Tools tab."
    count = await session.scalar(select(func.count()).select_from(UserTool).where(UserTool.user_id == user_id)) or 0
    if count >= user_tools.MAX_TOOLS:
        return f"The person has {user_tools.MAX_TOOLS} tools, the most they may: they delete one first."
    held = await session.scalar(
        select(func.count()).select_from(AgentTool).join(UserTool, UserTool.tool_id == AgentTool.tool_id)
        .where(AgentTool.user_id == user_id, AgentTool.agent_id == agent.agent_id, UserTool.kind == kind)
    ) or 0
    if held >= user_tools.PER_AGENT[kind]:
        return f"@{agent.name} has {held} of these, the most it may."
    row = UserTool(tool_id=str(uuid.uuid4()), user_id=user_id, kind=kind, name=name, description=description, config={**config, "draft": True})
    stamp(row, user_id, made=True)
    session.add(row)
    # The tool before the agent's link to it (no ORM relationship orders them).
    await session.flush()
    session.add(AgentTool(user_id=user_id, agent_id=agent.agent_id, tool_id=row.tool_id, position=held))
    await session.commit()
    logger.info("tool_drafted kind=%s", kind)
    return row


async def _draft(request: Request, session: AsyncSession, user_id: str, agent: UserAgent, tool: sql_tools.SqlTool) -> tuple[str, bool]:
    row = await _keep_draft(session, user_id, agent, user_tools.SQL, tool.name, tool.description, tool.config())
    if isinstance(row, str):
        return row, True
    review = await _tell(request, session, user_id, agent, f"Review the SQL tool {tool.name}", f"Your AI app drafted **{tool.name}** for this agent: {tool.description}\n\nClick Create tool to let the agent use it.")
    return json.dumps({
        "drafted": tool.name, "id": row.tool_id, "review": review,
        "note": f"Only a draft: @{agent.name} cannot use it until the person reviews it on its Tools tab and clicks Create tool. They have a notification.",
    }), False


async def _propose(request: Request, session: AsyncSession, user_id: str, agent: UserAgent, tool: sql_tools.SqlTool, current: Any) -> tuple[str, bool]:
    """A new version of one of the agent's SQL tools: a draft is simply redrafted; a live one
    keeps it in ``pending``, not used, for the person."""
    held = [t for t in await user_tools.of_agent(session, user_id, agent.agent_id, drafts=True) if t.kind == user_tools.SQL]
    row = next((t for t in held if t.name == current), None)
    if row is None:
        names = ", ".join(t.name for t in held) or "none"
        return f"Say which of @{agent.name}'s SQL tools, by its name now: {names}.", True
    if tool.name != row.name and await session.scalar(select(UserTool.tool_id).where(UserTool.user_id == user_id, UserTool.kind == user_tools.SQL, UserTool.name == tool.name)) is not None:
        return f"The person already has a SQL tool named '{tool.name}': pick another name.", True
    proposal = {"name": tool.name, "description": tool.description, "config": tool.config()}
    if is_draft(row):
        row.name, row.description, row.config = tool.name, tool.description, {**tool.config(), "draft": True}
        note = "It is still a draft: the person reviews it on the agent's Tools tab and creates it."
    else:
        row.config = {**(row.config or {}), "pending": proposal}
        note = f"Only proposed: @{agent.name} goes on using {row.name} as it is until the person applies the change on its Tools tab."
    row.updated_at = func.now()
    stamp(row, user_id)
    await session.commit()
    logger.info("sql_tool_change_proposed")
    review = await _tell(request, session, user_id, agent, f"Review a change to the SQL tool {current}", f"Your AI app proposed a new version of **{current}**.")
    return json.dumps({"proposed": tool.name, "id": row.tool_id, "review": review, "note": note}), False


async def _may_have(session: AsyncSession, agent: UserAgent, key: str) -> str | None:
    from apps.cloud import agent_types, tool_kinds

    return tool_kinds.may_have(key, dict(agent.config or {}), await agent_types.all_types(session))


async def _draft_site(request: Request, session: AsyncSession, user_id: str, agent: UserAgent, args: dict[str, Any]) -> tuple[str, bool]:
    kind = args.get("kind")
    if kind not in user_tools.SITES:
        return f"'kind' is one of {', '.join(user_tools.SITES)}.", True
    if (why := await _may_have(session, agent, kind)) is not None:
        return why, True
    try:
        name, description, config = user_tools._site(kind, user_tools.ToolIn(kind=kind, description=str(args.get("description") or ""), config={"address": args.get("address")}))
    except HTTPException as e:
        return str(e.detail), True
    row = await _keep_draft(session, user_id, agent, kind, name, description, config)
    if isinstance(row, str):
        return row, True
    review = await _tell(request, session, user_id, agent, f"Review a {kind} link", f"Your AI app drafted the link **{name}** for this agent: {description}")
    return json.dumps({"drafted": name, "id": row.tool_id, "review": review, "note": f"Only a draft: the person reviews it on @{agent.name}'s Tools tab and creates it."}), False


async def _draft_program(request: Request, session: AsyncSession, user_id: str, agent: UserAgent, args: dict[str, Any]) -> tuple[str, bool]:
    from apps.cloud.agent_chat import mac

    if (why := await _may_have(session, agent, "local")) is not None:
        return why, True
    program = {"name": str(args.get("name") or "").strip(), "description": str(args.get("description") or "").strip(), "command": args.get("command"), "args": args.get("args") or []}
    if mac.parse_one(program) is None:
        return "A program has a name (a lowercase letter, then lowercase letters, digits or _), says what it does, and has a command; each argument is a fixed 'value' or a blank ('param', with its 'description'), named once.", True
    row = await _keep_draft(session, user_id, agent, user_tools.PROGRAM, program["name"], program["description"], {"command": str(program["command"]).strip(), "args": program["args"]})
    if isinstance(row, str):
        return row, True
    review = await _tell(request, session, user_id, agent, f"Review the program {program['name']}", f"Your AI app drafted the program **{program['name']}** for this agent: {program['description']}")
    return json.dumps({
        "drafted": program["name"], "id": row.tool_id, "review": review,
        "note": f"Only a draft: the person reviews it on @{agent.name}'s Tools tab and creates it; Wysebee Agent on the computer then asks them to allow it.",
    }), False


async def _request_switch(request: Request, session: AsyncSession, user_id: str, agent: UserAgent, args: dict[str, Any]) -> tuple[str, bool]:
    from sqlalchemy.orm.attributes import flag_modified

    from apps.cloud.agent_chat import mac, prompts

    field, reason = args.get("switch"), str(args.get("reason") or "").strip()
    known = switches()
    if field not in known:
        return f"'switch' is one of {', '.join(known)}.", True
    if not reason or len(reason) > 500 or "\n" in reason:
        return "Say why the agent needs it, on one line of at most 500 characters.", True
    key, label = known[field]
    config = dict(agent.config or {})
    if key is None:
        why = None if prompts.is_browser_agent(config) else f"Only an agent made by pairing the Wysebee Agent browser extension can have {label}."
    else:
        why = await _may_have(session, agent, key)
        if why is None and field == "ios_toolkit" and mac.device_of(config) != mac.MAC:
            why = f"Only an agent made by pairing Wysebee Agent for Mac can have {label}."
    if why is not None:
        return why, True
    # Browser access is on for a browser agent unless turned off; the rest only once turned on.
    on = config.get(field) is not False if field == "browser_access" else config.get(field) is True
    if on:
        return f"{label} is on for @{agent.name} already.", True
    requests = dict(config.get(REQUESTS_FIELD) or {})
    requests[field] = {"reason": reason}
    agent.config = {**config, REQUESTS_FIELD: requests}
    flag_modified(agent, "config")
    await session.commit()
    logger.info("switch_requested field=%s", field)
    review = await _tell(request, session, user_id, agent, f"Your AI app asks to turn on {label}", f"For @{agent.name}: {reason}")
    return json.dumps({"requested": field, "review": review, "note": f"Only a request: the person turns {label} on (or not) on @{agent.name}'s Tools tab."}), False


async def _propose_skill(request: Request, session: AsyncSession, user_id: str, agent: UserAgent, args: dict[str, Any]) -> tuple[str, bool]:
    from sqlalchemy.dialects.postgresql import insert

    from apps.cloud import skills
    from apps.cloud.models import AgentSkill, SkillRequest, UserSkill

    name, reason = str(args.get("skill") or "").strip(), str(args.get("reason") or "").strip()
    if not reason or len(reason) > 500 or "\n" in reason:
        return "Say why the agent needs it, on one line of at most 500 characters.", True
    skill = await session.scalar(select(UserSkill).where(UserSkill.user_id == user_id, UserSkill.name == name))
    if skill is None:
        return f"The person has no skill named '{name}': make one with create_skill, or pick one of theirs.", True
    held = (await session.scalars(select(AgentSkill.skill_id).where(AgentSkill.user_id == user_id, AgentSkill.agent_id == agent.agent_id))).all()
    if skill.skill_id in held:
        return f"@{agent.name} has the skill {name} already.", True
    if len(held) >= skills.MAX_ATTACHED:
        return f"@{agent.name} has {skills.MAX_ATTACHED} skills, the most it may.", True
    await session.execute(
        insert(SkillRequest).values(user_id=user_id, agent_id=agent.agent_id, skill_id=skill.skill_id, reason=reason)
        .on_conflict_do_update(index_elements=[SkillRequest.agent_id, SkillRequest.skill_id], set_={"reason": reason, "created_at": func.now()})
    )
    await session.commit()
    logger.info("skill_proposed")
    review = await _tell(request, session, user_id, agent, f"Your AI app asks to give @{agent.name} the skill {name}", f"{reason}\n\nThe skill's own page shows its files.")
    return json.dumps({"requested": name, "review": review, "note": f"Only a request: @{agent.name} does not have {name} until the person gives it on its Tools tab."}), False


async def _propose_instruction(request: Request, session: AsyncSession, user_id: str, agent: UserAgent, args: dict[str, Any]) -> tuple[str, bool]:
    from sqlalchemy.orm.attributes import flag_modified

    text, reason = args.get("text"), str(args.get("reason") or "").strip()
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_INSTRUCTION:
        return f"Give the whole new Instruction as 'text', at most {MAX_INSTRUCTION} characters.", True
    if not reason or len(reason) > 500 or "\n" in reason:
        return "Say why, on one line of at most 500 characters.", True
    config = dict(agent.config or {})
    if text.strip() == str(config.get("instructions") or "").strip():
        return f"That is @{agent.name}'s Instruction already.", True
    # A later proposal replaces the one waiting.
    agent.config = {**config, INSTRUCTION_FIELD: {"text": text, "reason": reason}}
    flag_modified(agent, "config")
    await session.commit()
    logger.info("instruction_proposed")
    review = await _tell(request, session, user_id, agent, f"Your AI app proposes a new Instruction for @{agent.name}", reason)
    return json.dumps({"proposed": True, "review": review, "note": f"Only proposed: @{agent.name}'s Instruction stays as it is until the person reviews yours and saves it."}), False
