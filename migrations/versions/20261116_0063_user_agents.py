"""user_agents: agents get a table of their own, keyed by a UUID, and are linked by it

As skills did with 0060 and tools with 0061: a person's agents leave the cloud items (``kind
'agent'`` rows of ``cloud_configs``, their settings JSON text in ``data.CONFIG``) for
``user_agents`` (``agent_id`` a UUID, ``name`` the @handle, unique per owner, ``config`` the
settings as an object), so an agent can be renamed. Its id is the item's ``item_id`` when that
was a uuid hex (every agent the website or a pairing made); Wysebee's own agent (``item_id``
``wysebee``) gets a new one. Wysebee's own agent gets a row too where something below named it
and it had none.

Everything that named an agent by its handle now holds its id:

- ``agent_skills`` and ``agent_tools`` (by the item's ``item_id`` until now): a UUID, a foreign
  key, deleted with the agent;
- ``browser_links.agent`` → ``agent_id``, deleted with the agent (a claimed link whose agent was
  gone is deleted: its next poll was a 401 anyway);
- ``mcp_hidden_agents.agent`` → ``agent_id``, deleted with the agent;
- ``user_notifications.agent`` and ``user_task_runs.agent_name`` → ``agent_id``, cleared when
  the agent is deleted;
- each task's steps, ``{"agent": <handle>}`` → ``{"agent_id": <id>}`` (null when no such agent).

Then the agent items go from ``cloud_configs`` (tombstones too: no client syncs agents through
it any more), and three tables nothing has read since chat went (2026-11-14) are dropped:
``cloud_agent_keys``, ``user_chat_turns`` and ``content_reports``.

The downgrade puts agents back as cloud items (a uuid's hex as ``item_id``; ``wysebee`` for
Wysebee's) and every reference back to a handle; the three tables come back empty.

Revision ID: 0063
Revises: 0062
Create Date: 2026-11-16 09:00:00.000000
"""

import json
import uuid
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = '0063'
down_revision: str | None = '0062'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

WYSEBEE = "wysebee"
WYSEBEE_CONFIG = {"label": "Wysebee", "browser_access": False}
AGENT_FK = "user_agents.agent_id"

# As they were at 0062 (pg_dump --schema-only).
DDL = """
CREATE TABLE cloud_agent_keys (
    id character varying(32) NOT NULL,
    user_id character varying(255) NOT NULL,
    agent character varying(255) NOT NULL,
    label character varying(100) NOT NULL,
    secret_hash character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
);
CREATE TABLE content_reports (
    id character varying(32) NOT NULL,
    user_id character varying(255) NOT NULL,
    reason character varying(16) NOT NULL,
    content text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    conversation character varying(128) DEFAULT ''::character varying NOT NULL,
    message_id character varying(128) DEFAULT ''::character varying NOT NULL,
    agent character varying(128) DEFAULT ''::character varying NOT NULL,
    surface character varying(32) DEFAULT ''::character varying NOT NULL,
    app_version character varying(32) DEFAULT ''::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE user_chat_turns (
    user_id character varying(255) NOT NULL,
    id character varying(64) NOT NULL,
    conversation character varying(64) NOT NULL,
    agent character varying(64) NOT NULL,
    thread character varying(64) DEFAULT ''::character varying NOT NULL,
    root character varying(64) DEFAULT ''::character varying NOT NULL,
    runner character varying(64) DEFAULT ''::character varying NOT NULL,
    status character varying(16) NOT NULL,
    messages jsonb,
    stopped character varying(32),
    error text,
    error_code character varying(32),
    merged boolean DEFAULT false NOT NULL,
    seen boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone
);
ALTER TABLE ONLY cloud_agent_keys ADD CONSTRAINT cloud_agent_keys_pkey PRIMARY KEY (id);
ALTER TABLE ONLY content_reports ADD CONSTRAINT content_reports_pkey PRIMARY KEY (id);
ALTER TABLE ONLY user_chat_turns ADD CONSTRAINT user_chat_turns_pkey PRIMARY KEY (user_id, id);
CREATE INDEX ix_cloud_agent_keys_user_id ON cloud_agent_keys USING btree (user_id);
CREATE INDEX ix_content_reports_created ON content_reports USING btree (created_at);
CREATE INDEX ix_content_reports_user ON content_reports USING btree (user_id);
CREATE INDEX ix_user_chat_turns_open ON user_chat_turns USING btree (user_id, merged, seen);
"""


def _object(text: Any) -> dict[str, Any]:
    try:
        value = json.loads(text) if isinstance(text, str) else text
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def _id_of(item_id: str) -> str:
    """The agent's id: its item's, when that was a uuid (hex or not), else a new one."""
    try:
        return str(uuid.UUID(item_id))
    except ValueError:
        return str(uuid.uuid4())


def upgrade() -> None:
    bind = op.get_bind()
    op.create_table(
        "user_agents",
        sa.Column("agent_id", UUID(as_uuid=False), primary_key=True),
        sa.Column("user_id", sa.String(255), nullable=False),
        sa.Column("name", sa.String(30), nullable=False),
        sa.Column("config", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_user_agents_user_id", "user_agents", ["user_id"])
    op.create_index("ix_user_agents_user_name", "user_agents", ["user_id", "name"], unique=True)

    # The agents, and how each was named: by its item's id and by its handle.
    by_item: dict[tuple[str, str], str] = {}
    taken: set[str] = set()
    by_name: dict[tuple[str, str], str] = {}
    agents = sa.table(
        "user_agents", sa.column("agent_id"), sa.column("user_id"), sa.column("name"), sa.column("config", JSONB),
        sa.column("description"), sa.column("created_at"), sa.column("updated_at"),
    )
    rows = bind.execute(sa.text(
        "SELECT user_id, item_id, name, data, created_at, updated_at FROM cloud_configs WHERE kind = 'agent' AND deleted_at IS NULL "
        "ORDER BY created_at, user_id"
    )).all()
    for r in rows:
        data = r.data if isinstance(r.data, dict) else {}
        name = WYSEBEE if r.item_id == WYSEBEE else r.name
        if (r.user_id, name) in by_name:
            continue
        agent_id = _id_of(r.item_id)
        # An item's id was unique per person only: one an earlier item of another person's
        # already took gets a new one.
        if agent_id in taken:
            agent_id = str(uuid.uuid4())
        taken.add(agent_id)
        description = data.get("DESCRIPTION")
        bind.execute(agents.insert().values(
            agent_id=agent_id, user_id=r.user_id, name=name[:30], config=_object(data.get("CONFIG")),
            description=description if isinstance(description, str) and description else None,
            created_at=r.created_at, updated_at=r.updated_at,
        ))
        by_item[(r.user_id, r.item_id)] = agent_id
        by_name[(r.user_id, name)] = agent_id

    def wysebee(user_id: str) -> str:
        """Wysebee's own agent's id, made for a person who had no item for it."""
        if (user_id, WYSEBEE) not in by_name:
            agent_id = str(uuid.uuid4())
            bind.execute(agents.insert().values(agent_id=agent_id, user_id=user_id, name=WYSEBEE, config=WYSEBEE_CONFIG))
            by_name[(user_id, WYSEBEE)] = agent_id
        return by_name[(user_id, WYSEBEE)]

    def named(user_id: str, handle: Any) -> str | None:
        if not isinstance(handle, str):
            return None
        handle = handle.strip().removeprefix("@")
        return wysebee(user_id) if handle == WYSEBEE else by_name.get((user_id, handle))

    # A map the updates below join with: (user_id, the old reference) → the agent's id.
    op.execute("CREATE TEMPORARY TABLE agent_map (user_id varchar(255), ref varchar(255), agent_id uuid) ON COMMIT DROP")
    pairs = sa.table("agent_map", sa.column("user_id"), sa.column("ref"), sa.column("agent_id"))

    def fill(found: dict[tuple[str, str], str]) -> None:
        op.execute("DELETE FROM agent_map")
        if found:
            bind.execute(pairs.insert(), [{"user_id": u, "ref": ref, "agent_id": a} for (u, ref), a in found.items()])

    # agent_skills, agent_tools: by item id.
    for table in ("agent_skills", "agent_tools"):
        refs = bind.execute(sa.text(f"SELECT DISTINCT user_id, agent_id FROM {table}")).all()
        found = {(u, ref): by_item.get((u, ref)) or (wysebee(u) if ref == WYSEBEE else None) for u, ref in refs}
        fill({k: v for k, v in found.items() if v is not None})
        op.execute(f"DELETE FROM {table} t WHERE NOT EXISTS (SELECT 1 FROM agent_map m WHERE m.user_id = t.user_id AND m.ref = t.agent_id)")
        op.execute(f"UPDATE {table} t SET agent_id = m.agent_id::text FROM agent_map m WHERE m.user_id = t.user_id AND m.ref = t.agent_id")
        op.execute(f"ALTER TABLE {table} ALTER COLUMN agent_id TYPE uuid USING agent_id::uuid")
        op.create_foreign_key(f"{table}_agent_id_fkey", table, "user_agents", ["agent_id"], ["agent_id"], ondelete="CASCADE")

    # The rest: by handle.
    def by_handle(table: str, column: str) -> None:
        refs = bind.execute(sa.text(f"SELECT DISTINCT user_id, {column} FROM {table} WHERE user_id IS NOT NULL AND {column} IS NOT NULL")).all()
        found = {(u, ref): named(u, ref) for u, ref in refs}
        fill({k: v for k, v in found.items() if v is not None})
        op.execute(f"UPDATE {table} t SET agent_id = m.agent_id FROM agent_map m WHERE m.user_id = t.user_id AND m.ref = t.{column}")

    op.add_column("browser_links", sa.Column("agent_id", UUID(as_uuid=False), sa.ForeignKey(AGENT_FK, ondelete="CASCADE"), nullable=True))
    by_handle("browser_links", "agent")
    op.execute("DELETE FROM browser_links WHERE user_id IS NOT NULL AND agent_id IS NULL")
    op.drop_column("browser_links", "agent")

    op.add_column("mcp_hidden_agents", sa.Column("agent_id", UUID(as_uuid=False), sa.ForeignKey(AGENT_FK, ondelete="CASCADE"), nullable=True))
    by_handle("mcp_hidden_agents", "agent")
    op.execute("DELETE FROM mcp_hidden_agents WHERE agent_id IS NULL")
    op.drop_constraint("mcp_hidden_agents_pkey", "mcp_hidden_agents", type_="primary")
    op.drop_column("mcp_hidden_agents", "agent")
    op.alter_column("mcp_hidden_agents", "agent_id", nullable=False)
    op.create_primary_key("mcp_hidden_agents_pkey", "mcp_hidden_agents", ["user_id", "agent_id"])

    op.add_column("user_notifications", sa.Column("agent_id", UUID(as_uuid=False), sa.ForeignKey(AGENT_FK, ondelete="SET NULL"), nullable=True))
    by_handle("user_notifications", "agent")
    op.drop_column("user_notifications", "agent")

    op.add_column("user_task_runs", sa.Column("agent_id", UUID(as_uuid=False), sa.ForeignKey(AGENT_FK, ondelete="SET NULL"), nullable=True))
    by_handle("user_task_runs", "agent_name")
    op.drop_column("user_task_runs", "agent_name")

    # Each task's steps: the agent by id.
    tasks = bind.execute(sa.text("SELECT user_id, item_id, data FROM cloud_configs WHERE kind = 'task' AND deleted_at IS NULL")).all()
    for t in tasks:
        data = t.data if isinstance(t.data, dict) else {}
        config = _object(data.get("CONFIG"))
        steps = config.get("steps")
        if not isinstance(steps, list) or not any(isinstance(s, dict) and "agent" in s for s in steps):
            continue
        config["steps"] = [
            {"agent_id": named(t.user_id, s.get("agent")), **{k: v for k, v in s.items() if k != "agent"}} if isinstance(s, dict) and "agent" in s else s
            for s in steps
        ]
        bind.execute(
            sa.text("UPDATE cloud_configs SET data = CAST(:data AS jsonb) WHERE user_id = :u AND kind = 'task' AND item_id = :i"),
            {"data": json.dumps({**data, "CONFIG": json.dumps(config)}), "u": t.user_id, "i": t.item_id},
        )

    op.execute("DELETE FROM cloud_configs WHERE kind = 'agent'")
    for table in ("cloud_agent_keys", "user_chat_turns", "content_reports"):
        op.drop_table(table)


def downgrade() -> None:
    bind = op.get_bind()
    for statement in DDL.split(";"):
        if statement.strip():
            op.execute(statement)

    rows = bind.execute(sa.text("SELECT agent_id, user_id, name, config, description, created_at, updated_at FROM user_agents")).all()
    item: dict[str, str] = {}
    handle: dict[str, str] = {}
    for r in rows:
        agent_id = str(r.agent_id)
        item_id = WYSEBEE if r.name == WYSEBEE else uuid.UUID(agent_id).hex
        item[agent_id], handle[agent_id] = item_id, r.name
        stamp = r.updated_at.strftime("%Y-%m-%d %H:%M:%S")
        data = {
            "AGENT_NAME": r.name, "CONFIG": json.dumps(r.config or {}, separators=(",", ":"), ensure_ascii=False),
            "DESCRIPTION": r.description, "CREATED_AT": r.created_at.strftime("%Y-%m-%d %H:%M:%S"), "UPDATED_AT": stamp,
        }
        bind.execute(
            sa.text(
                "INSERT INTO cloud_configs (user_id, kind, item_id, name, data, created_at, updated_at, revision) "
                "VALUES (CAST(:u AS varchar), 'agent', :i, :n, CAST(:d AS jsonb), :c, :m, "
                "COALESCE((SELECT h.revision FROM cloud_config_heads h WHERE h.user_id = CAST(:u AS varchar)), 0))"
            ),
            {"u": r.user_id, "i": item_id, "n": r.name, "d": json.dumps(data), "c": r.created_at, "m": r.updated_at},
        )

    op.execute("CREATE TEMPORARY TABLE agent_map (agent_id uuid, ref varchar(255)) ON COMMIT DROP")
    pairs = sa.table("agent_map", sa.column("agent_id"), sa.column("ref"))

    def fill(refs: dict[str, str]) -> None:
        op.execute("DELETE FROM agent_map")
        if refs:
            bind.execute(pairs.insert(), [{"agent_id": a, "ref": ref} for a, ref in refs.items()])

    fill(item)
    for table in ("agent_skills", "agent_tools"):
        op.drop_constraint(f"{table}_agent_id_fkey", table, type_="foreignkey")
        op.execute(f"ALTER TABLE {table} ALTER COLUMN agent_id TYPE varchar(64) USING agent_id::text")
        op.execute(f"UPDATE {table} t SET agent_id = m.ref FROM agent_map m WHERE m.agent_id::text = t.agent_id")

    fill(handle)
    op.add_column("browser_links", sa.Column("agent", sa.String(30), nullable=True))
    op.execute("UPDATE browser_links t SET agent = m.ref FROM agent_map m WHERE m.agent_id = t.agent_id")
    op.drop_column("browser_links", "agent_id")

    op.add_column("mcp_hidden_agents", sa.Column("agent", sa.String(255), nullable=True))
    op.execute("UPDATE mcp_hidden_agents t SET agent = m.ref FROM agent_map m WHERE m.agent_id = t.agent_id")
    op.drop_constraint("mcp_hidden_agents_pkey", "mcp_hidden_agents", type_="primary")
    op.drop_column("mcp_hidden_agents", "agent_id")
    op.alter_column("mcp_hidden_agents", "agent", nullable=False)
    op.create_primary_key("mcp_hidden_agents_pkey", "mcp_hidden_agents", ["user_id", "agent"])

    op.add_column("user_notifications", sa.Column("agent", sa.String(255), nullable=True))
    op.execute("UPDATE user_notifications t SET agent = m.ref FROM agent_map m WHERE m.agent_id = t.agent_id")
    op.drop_column("user_notifications", "agent_id")

    op.add_column("user_task_runs", sa.Column("agent_name", sa.Text(), nullable=True))
    op.execute("UPDATE user_task_runs t SET agent_name = m.ref FROM agent_map m WHERE m.agent_id = t.agent_id")
    op.drop_column("user_task_runs", "agent_id")

    tasks = bind.execute(sa.text("SELECT user_id, item_id, data FROM cloud_configs WHERE kind = 'task' AND deleted_at IS NULL")).all()
    for t in tasks:
        data = t.data if isinstance(t.data, dict) else {}
        config = _object(data.get("CONFIG"))
        steps = config.get("steps")
        if not isinstance(steps, list) or not any(isinstance(s, dict) and "agent_id" in s for s in steps):
            continue
        config["steps"] = [
            {"agent": handle.get(s.get("agent_id") or ""), **{k: v for k, v in s.items() if k != "agent_id"}} if isinstance(s, dict) and "agent_id" in s else s
            for s in steps
        ]
        bind.execute(
            sa.text("UPDATE cloud_configs SET data = CAST(:data AS jsonb) WHERE user_id = :u AND kind = 'task' AND item_id = :i"),
            {"data": json.dumps({**data, "CONFIG": json.dumps(config)}), "u": t.user_id, "i": t.item_id},
        )

    op.drop_table("user_agents")
