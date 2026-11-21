"""An agent's tools as Wysebee Cloud runs them, for the person's own AI app through Wysebee
Assistant, ``/assistant/mcp`` (apps/cloud/agent_mcp.py): **the cloud's tools only** — the
agent's skills (apps/cloud/agent_chat/tools.py); **the tools of the agent type packs serving its
paired device** (apps/cloud/agent_packs.py, apps/cloud/packs/: the browser's, the phone's, the
computer's — Mac, Windows, Linux), each over that one device through apps/cloud/browser_links.py,
asked in that order and offered before the rest; its SQL Query tools over the PostgreSQL and
Snowflake connections it has (apps/cloud/agent_chat/sql_tools.py; since 2026-11-17 the
connections themselves are not tools the AI sees); and, for **every agent**,
``send_notification`` (2026-11-15): a notification on the person's Activity page, from it
(apps/cloud/notifications.py). A tool runs in the pack that offered it; its skills' scripts run
on the device whose pack runs them (``runs_skill_scripts``: the computer's).

The chat that once ran these tools for the cloud's own model went on 2026-11-14 (the person's
call: no chat and no AI model in Wysebee Cloud).
"""

from dataclasses import dataclass, field, replace
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud import agent_packs, browser_links, notifications
from apps.cloud.agent_chat import mac, postgres, snowflake, sql_tools, tools
from apps.cloud import user_tools
from apps.cloud.models import UserAgent

WYSEBEE = "wysebee"

# **Read or write** (2026-11-16, for Claude's connector directory, which rejects one tool that
# both reads and writes): Wysebee Assistant runs the tools here through two of its own —
# call_agent_read_tool, read-only, for these; call_agent_tool, destructive, for the rest. A
# tool not named here (a new one, a Mac program) is a write, never read-only by accident.
# A SQL Query tool is in both: read-only, it runs in a read-only transaction (PostgreSQL) or as
# a read statement only (Snowflake) whatever the connection allows (`read_only` below); through
# call_agent_tool it may change data, where its connection allows changes. An agent type pack's
# read-only tools are its own (``Toolbox.reads_only``).
READ_ONLY = frozenset({tools.LOAD, tools.READ})


def changes_nothing(c: Any) -> Any:
    """A PostgreSQL or Snowflake connection as a read-only one."""
    return replace(c, changes=False)


@dataclass
class Where:
    """What the agent's tools reach: the agent's settings and skill names, and its devices of the
    kinds packs serve (``packed``)."""

    config: dict
    attached: list[str]
    # Its id: the agent a notification it sends is from (None: Wysebee's own, not stored yet),
    # and its handle.
    agent: str | None = None
    name: str = ""
    # Whether a device of its runs its skills' scripts, and what that device is called.
    can_run: bool = False
    device: str = "Mac"
    # The packs whose tools it was offered, by tool name, with what each runs them with.
    packed: dict[str, tuple[agent_packs.AgentPack, agent_packs.ToolContext]] = field(default_factory=dict)


@dataclass(frozen=True)
class SqlRun:
    """A SQL Query tool as the agent has it, with its connection."""

    tool: sql_tools.SqlTool
    connection: Any


@dataclass
class Toolbox:
    """An agent's tools as the cloud runs them: the definitions offered, how to run one, and
    what Wysebee Assistant says about its skills and devices."""

    state: Any
    user_id: str
    skills: list
    databases: list
    warehouses: list
    where: "Where"
    defs: list[dict]
    skill_note: str | None
    # What its device that runs skill scripts is called ("Mac", "Windows PC", "Linux machine").
    device: str = "Mac"
    # Its SQL Query tools, by name.
    sql: dict[str, SqlRun] = field(default_factory=dict)
    # What its packs say of where their tools run (Wysebee Assistant's instructions).
    notes: list[str] = field(default_factory=list)

    @property
    def offered(self) -> set[str]:
        return {t["name"] for t in self.defs}

    def _read_only(self, name: str) -> bool:
        packed = self.where.packed.get(name)
        return name in READ_ONLY or (packed is not None and name in packed[0].read_only) or _pack_read_only(self.state, name)

    def reads_only(self, name: str) -> bool:
        """Whether ``name`` may run read-only (call_agent_read_tool)."""
        return self._read_only(name) or name in self.sql

    def writes(self, name: str, args: dict) -> bool:
        """Whether ``name`` with ``args`` may change something (call_agent_tool): any tool not
        read-only, and a SQL query on a connection that allows changes."""
        if name in self.sql:
            return bool((self.sql[name].connection.config or {}).get("changes"))
        return not self._read_only(name)

    async def run(self, call: dict) -> tools.Output:
        """Run one tool; ``call["read_only"]`` (call_agent_read_tool's): only a read-only one,
        its SQL in a read-only transaction."""
        return await _run_tool(self.state, self.user_id, self.skills, self.sql, self.offered, call, self.where, self._read_only)


async def toolbox(state: Any, session: AsyncSession, user_id: str, agent: UserAgent) -> Toolbox:
    """The agent's tools (``agent`` as apps/cloud/agents.py ``find`` gives it): its skills; the
    tools of the packs serving its paired devices (apps/cloud/agent_packs.py); its PostgreSQL and
    Snowflake connections kept here; a notification."""
    agent_id, config = agent.agent_id, dict(agent.config or {})
    skills = await tools.skills_of(session, user_id, agent_id)
    owned = await user_tools.of_agent(session, user_id, agent_id)
    databases = [t for t in owned if t.kind == user_tools.POSTGRES]
    warehouses = [t for t in owned if t.kind == user_tools.SNOWFLAKE]
    defs = tools.skill_tools(skills)
    # Each pack's tools, over the device of its kind paired with this agent (and, for one that
    # needs it, held as this agent's in the links table): the browser's, the phone's, the
    # computer's.
    packed: dict[str, tuple[agent_packs.AgentPack, agent_packs.ToolContext]] = {}
    notes: list[str] = []
    runner: agent_packs.AgentPack | None = None
    for pack in _packs(state):
        row = await browser_links.paired_link(session, user_id, config, pack.kind, pack.link_field)
        if pack.needs_paired and (row is None or row.agent_id != agent_id):
            # Not this agent's device in the links table now: none of its tools.
            continue
        ctx = agent_packs.ToolContext(
            session, state, user_id, agent, config, link=row,
            skills=skills, tools=owned, run_op=_op_runner(state, user_id, row.id if pack.needs_paired else pack.link_of(config), agent_id),
        )
        for d in await pack.tools(ctx):
            defs.append(d)
            packed[d["name"]] = (pack, ctx)
        note = pack.describe(ctx)
        if note:
            notes.append(note)
        if pack.runs_skill_scripts and runner is None:
            runner = pack
    # Its SQL Query tools whose connection it has, each under its own name (one whose name
    # another tool has already is left out).
    connections = {r.tool_id: r for r in (*databases, *warehouses)}
    sql: dict[str, SqlRun] = {}
    for row in owned:
        parsed = user_tools.sql_tool(row) if row.kind == user_tools.SQL else None
        conn = connections.get(parsed.connection_id) if parsed else None
        if parsed is None or conn is None or parsed.name in {d["name"] for d in defs} or parsed.name in sql:
            continue
        sql[parsed.name] = SqlRun(parsed, conn)
        defs.append(sql_tools.tool_def(parsed, "PostgreSQL" if conn.kind == user_tools.POSTGRES else "Snowflake"))
    # Every agent's: a notification on the person's Activity page, from it.
    defs.append(notifications.TOOL)
    # Where its skills' scripts would run, said in that device's words (a Mac's when none).
    device = runner.device_name(config) if runner is not None else mac.device_of(config)
    where = Where(config, [s.name for s in skills], agent=agent_id, name=agent.name, can_run=runner is not None, device=device, packed=packed)
    return Toolbox(
        state, user_id, skills, databases, warehouses, where, defs, tools.skills_prompt(skills, can_run=runner is not None, device=device),
        device=device, sql=sql, notes=notes,
    )


def _packs(state: Any) -> list[agent_packs.AgentPack]:
    registry = getattr(state, "agent_packs", None)
    return registry.packs if registry is not None else []


def _pack_read_only(state: Any, name: str) -> bool:
    """A tool a pack declares read-only, whether or not this agent was offered it."""
    registry = getattr(state, "agent_packs", None)
    pack = registry.for_tool(name) if registry is not None else None
    return pack is not None and name in pack.read_only


def _op_runner(state: Any, user_id: str, link: str, agent_id: str | None):
    """Runs one op on ``link`` as this agent; None without a link."""
    if not link:
        return None

    async def run(op: str, args: dict, timeout: float) -> dict:
        return await browser_links.run_op(state, user_id, link, op, args, agent=agent_id or "", timeout_seconds=timeout)

    return run


async def _run_tool(state: Any, user_id: str, skills: list, sql: dict[str, SqlRun], offered: set[str], call: dict, where: Where | None = None, is_read_only: Any = None) -> tools.Output:
    name = str(call.get("name") or "")
    args = call.get("arguments") if isinstance(call.get("arguments"), dict) else {}
    where = where or Where({}, [])
    if name not in offered:
        return tools.Output(f"'{name}' is not one of your tools.", True)
    read_only = call.get("read_only") is True
    reads_only = is_read_only(name) if is_read_only is not None else name in READ_ONLY
    if read_only and not reads_only and name not in sql:
        return tools.Output(f"'{name}' can change something, so it does not run read-only: use call_agent_tool.", True)
    if name == notifications.TOOL_NAME:
        return await notifications.from_agent(state, user_id, where.agent, where.name, args)
    packed = where.packed.get(name)
    if packed is not None:
        return await packed[0].run(packed[1], name, args)
    if name in sql:
        return await _run_sql(state, user_id, sql[name], args, read_only)
    return await tools.call_skill(state.skill_file_store, user_id, skills, name, args, can_run=where.can_run, device=where.device)


async def _run_sql(state: Any, user_id: str, run: SqlRun, args: dict, read_only: bool) -> tools.Output:
    """A SQL Query tool on its connection, its values bound; ``read_only``: as a read whatever
    the connection allows."""
    row = run.connection
    try:
        if row.kind == user_tools.POSTGRES:
            if not state.postgres_limit.allow(user_id):
                return tools.Output(f"At most {postgres.CALLS_PER_MINUTE} PostgreSQL calls a minute: wait a moment before the next.", True)
            c = user_tools.pg_connection(row)
            rendered = sql_tools.render(run.tool, args, user_tools.POSTGRES, c.database)
            password = await user_tools.secret_of(state.ai_kek, row)
            return await postgres.execute(changes_nothing(c) if read_only else c, password, rendered.sql, [v for _, v in rendered.values])
        if not state.snowflake_limit.allow(user_id):
            return tools.Output(f"At most {snowflake.CALLS_PER_MINUTE} Snowflake calls a minute: wait a moment before the next.", True)
        s = user_tools.sf_connection(row)
        rendered = sql_tools.render(run.tool, args, user_tools.SNOWFLAKE, s.database)
        secret = await user_tools.secret_of(state.ai_kek, row)
        return await snowflake.execute(state.ai_http, changes_nothing(s) if read_only else s, secret, rendered.sql, sql_tools.snowflake_bindings(rendered.values))
    except postgres.Invalid as e:
        return tools.Output(e.message, True)
