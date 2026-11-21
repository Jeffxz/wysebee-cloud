"""user_tools and agent_tools: tools get an id, and agents link to them by it

As skills did with 0060: a person's reusable tools — PostgreSQL and Snowflake connections,
site links (Gmail, Calendar, Travel, News, Website) and Mac programs — become rows of
``user_tools`` (``tool_id`` a UUID, unique ``name`` per owner and kind), given to agents
through ``agent_tools`` (the agent by its owner and its cloud item's ``item_id``, the tool by
id; deleting the tool deletes the link).

The upgrade copies:

- every ``cloud_postgres`` / ``cloud_snowflake`` row into a tool linked to the agent of that
  name, its encrypted secret as it is — it was sealed bound to ``<kind>:<agent>:<name>``,
  which ``secret_aad`` keeps until the secret is next saved (no key is needed here). A name
  another of the person's connections of that kind already took gets ``_2``, ``_3``…;
- every agent's site links (``gmail_accounts``, ``calendar_sites``, ``travel_sites``,
  ``news_sites``, ``websites``): one tool per address and kind, the first description kept,
  given to each agent that listed it;
- the ``local_programs`` of every agent paired with a Mac (``mac_link``, or a type whose link
  field is ``mac_link``): one tool per program, the same program on several agents one tool,
  a different one under a taken name renamed ``_2``…;

then takes those fields out of the agents' settings and drops the two tables. A clean break,
as for skills: clients that read those settings no longer see them. The downgrade puts them
back; a secret sealed since under the tool's own binding cannot be, and is left out.

Revision ID: 0061
Revises: 0060
Create Date: 2026-11-15 22:00:00.000000
"""

import json
import uuid
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = '0061'
down_revision: str | None = '0060'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SITES = {"gmail": "gmail_accounts", "calendar": "calendar_sites", "travel": "travel_sites", "news": "news_sites", "website": "websites"}
PROGRAMS = "local_programs"
SECRET = ("ciphertext", "nonce", "wrapped_key", "kek_id")
PG_FIELDS = ("host", "port", "database", "db_user", "ssl", "changes")
SF_FIELDS = ("account", "database", "warehouse", "schema_name", "role", "db_user", "auth", "changes")


def _object(text: Any) -> dict[str, Any] | None:
    try:
        value = json.loads(text) if isinstance(text, str) else None
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def _dump(config: dict[str, Any]) -> str:
    return json.dumps(config, separators=(",", ":"), ensure_ascii=False)


def _free(taken: set[str], name: str, most: int) -> str:
    """``name``, or ``name_2``, ``name_3``… — the first not in ``taken``, at most ``most`` long."""
    out, n = name, 1
    while out in taken:
        n += 1
        out = f"{name[: most - len(str(n)) - 1]}_{n}"
    taken.add(out)
    return out


class _Writer:
    def __init__(self, bind: Any) -> None:
        self.bind = bind
        self.names: dict[tuple[str, str], set[str]] = {}
        self.positions: dict[tuple[str, str], int] = {}

    def taken(self, user: str, kind: str) -> set[str]:
        return self.names.setdefault((user, kind), set())

    def tool(self, user: str, kind: str, name: str, description: str, config: dict[str, Any], secret: dict[str, Any] | None = None, aad: str | None = None) -> str:
        tool_id = str(uuid.uuid4())
        values = {"i": tool_id, "u": user, "k": kind, "n": name, "d": description, "c": json.dumps(config), "a": aad, **{f: (secret or {}).get(f) for f in SECRET}}
        self.bind.execute(sa.text(
            "INSERT INTO user_tools (tool_id, user_id, kind, name, description, config, ciphertext, nonce, wrapped_key, kek_id, secret_aad)"
            " VALUES (CAST(:i AS uuid), :u, :k, :n, :d, CAST(:c AS jsonb), :ciphertext, :nonce, :wrapped_key, :kek_id, :a)"
        ), values)
        return tool_id

    def give(self, user: str, agent: str, tool_id: str) -> None:
        position = self.positions.get((user, agent), 0)
        self.positions[(user, agent)] = position + 1
        self.bind.execute(sa.text("INSERT INTO agent_tools (user_id, agent_id, tool_id, position) VALUES (:u, :a, CAST(:t AS uuid), :p)"), {"u": user, "a": agent, "t": tool_id, "p": position})


def upgrade() -> None:
    op.create_table(
        'user_tools',
        sa.Column('tool_id', UUID(as_uuid=False), nullable=False),
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('name', sa.String(length=2048), nullable=False),
        sa.Column('description', sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column('config', JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column('ciphertext', sa.LargeBinary(), nullable=True),
        sa.Column('nonce', sa.LargeBinary(), nullable=True),
        sa.Column('wrapped_key', sa.LargeBinary(), nullable=True),
        sa.Column('kek_id', sa.String(length=512), nullable=True),
        sa.Column('secret_aad', sa.String(length=600), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('tool_id'),
    )
    op.create_index('ix_user_tools_user_id', 'user_tools', ['user_id'])
    op.create_index('ix_user_tools_user_kind_name', 'user_tools', ['user_id', 'kind', 'name'], unique=True)
    op.create_table(
        'agent_tools',
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('agent_id', sa.String(length=64), nullable=False),
        sa.Column('tool_id', UUID(as_uuid=False), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tool_id'], ['user_tools.tool_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'agent_id', 'tool_id'),
    )
    op.create_index('ix_agent_tools_tool', 'agent_tools', ['tool_id'])

    bind = op.get_bind()
    w = _Writer(bind)
    agents = {(r.user_id, r.name): r.item_id for r in bind.execute(sa.text("SELECT user_id, name, item_id FROM cloud_configs WHERE kind = 'agent' AND deleted_at IS NULL"))}

    # Connections: one tool each, linked to the agent of that name (if it is still there).
    for kind, table, fields in (("postgres", "cloud_postgres", PG_FIELDS), ("snowflake", "cloud_snowflake", SF_FIELDS)):
        for row in bind.execute(sa.text(f"SELECT * FROM {table} ORDER BY user_id, agent, name")).mappings():
            config = {("user" if f == "db_user" else "schema" if f == "schema_name" else f): row[f] for f in fields}
            name = _free(w.taken(row["user_id"], kind), row["name"], 30)
            secret = {f: row[f] for f in SECRET} if row["ciphertext"] is not None else None
            tool_id = w.tool(row["user_id"], kind, name, row["description"], config, secret, f"{kind}:{row['agent']}:{row['name']}" if secret else None)
            agent = agents.get((row["user_id"], row["agent"]))
            if agent is not None:
                w.give(row["user_id"], agent, tool_id)

    mac_types = {str(r[0]) for r in bind.execute(sa.text("SELECT id FROM agent_types WHERE link_field = 'mac_link'"))}
    sites: dict[tuple[str, str, str], str] = {}
    programs: dict[tuple[str, str], tuple[str, str]] = {}
    for row in bind.execute(sa.text("SELECT user_id, item_id, data FROM cloud_configs WHERE kind = 'agent' AND deleted_at IS NULL ORDER BY user_id, item_id")).mappings():
        user, agent, data = row["user_id"], row["item_id"], row["data"] or {}
        config = _object(data.get("CONFIG"))
        if config is None:
            continue
        mac = bool(config.get("mac_link")) or str(config.get("agent_type_id")) in mac_types
        moved = [f for f in SITES.values() if f in config] + ([PROGRAMS] if mac and PROGRAMS in config else [])
        if not moved:
            continue
        given: set[str] = set()
        for kind, field in SITES.items():
            for link in config.get(field) if isinstance(config.get(field), list) else []:
                address = link.get("address").strip() if isinstance(link, dict) and isinstance(link.get("address"), str) else ""
                if not address:
                    continue
                key = (user, kind, address)
                if key not in sites:
                    w.taken(user, kind).add(address)
                    sites[key] = w.tool(user, kind, address, str(link.get("description") or "").strip(), {"address": address})
                if sites[key] not in given:
                    given.add(sites[key])
                    w.give(user, agent, sites[key])
        if mac:
            for p in config.get(PROGRAMS) if isinstance(config.get(PROGRAMS), list) else []:
                if not isinstance(p, dict) or not isinstance(p.get("name"), str) or not p["name"]:
                    continue
                body = {"command": p.get("command") if isinstance(p.get("command"), str) else "", "args": p.get("args") if isinstance(p.get("args"), list) else []}
                same = _dump({"d": p.get("description"), **body})
                found = programs.get((user, p["name"]))
                if found is not None and found[1] == same:
                    tool_id = found[0]
                else:
                    name = _free(w.taken(user, "program"), p["name"], 40)
                    tool_id = w.tool(user, "program", name, str(p.get("description") or ""), body)
                    programs.setdefault((user, p["name"]), (tool_id, same))
                if tool_id not in given:
                    given.add(tool_id)
                    w.give(user, agent, tool_id)
        for f in moved:
            config.pop(f)
        bind.execute(
            sa.text("UPDATE cloud_configs SET data = CAST(:d AS jsonb) WHERE user_id = :u AND kind = 'agent' AND item_id = :a"),
            {"d": json.dumps({**data, "CONFIG": _dump(config)}), "u": user, "a": agent},
        )
    op.drop_table('cloud_postgres')
    op.drop_table('cloud_snowflake')


def downgrade() -> None:
    op.create_table(
        'cloud_postgres',
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('agent', sa.String(length=255), nullable=False),
        sa.Column('name', sa.String(length=30), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('host', sa.String(length=255), nullable=False),
        sa.Column('port', sa.Integer(), nullable=False),
        sa.Column('database', sa.String(length=63), nullable=False),
        sa.Column('db_user', sa.String(length=63), nullable=False),
        sa.Column('ssl', sa.String(length=16), nullable=False),
        sa.Column('changes', sa.Boolean(), nullable=False),
        sa.Column('ciphertext', sa.LargeBinary(), nullable=True),
        sa.Column('nonce', sa.LargeBinary(), nullable=True),
        sa.Column('wrapped_key', sa.LargeBinary(), nullable=True),
        sa.Column('kek_id', sa.String(length=512), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('user_id', 'agent', 'name'),
    )
    op.create_table(
        'cloud_snowflake',
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('agent', sa.String(length=255), nullable=False),
        sa.Column('name', sa.String(length=30), nullable=False),
        sa.Column('description', sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column('account', sa.String(length=100), nullable=False),
        sa.Column('database', sa.String(length=255), nullable=False),
        sa.Column('warehouse', sa.String(length=255), server_default=sa.text("''"), nullable=False),
        sa.Column('schema_name', sa.String(length=255), server_default=sa.text("''"), nullable=False),
        sa.Column('role', sa.String(length=255), server_default=sa.text("''"), nullable=False),
        sa.Column('db_user', sa.String(length=255), server_default=sa.text("''"), nullable=False),
        sa.Column('auth', sa.String(length=16), nullable=False),
        sa.Column('changes', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('ciphertext', sa.LargeBinary(), nullable=True),
        sa.Column('nonce', sa.LargeBinary(), nullable=True),
        sa.Column('wrapped_key', sa.LargeBinary(), nullable=True),
        sa.Column('kek_id', sa.String(length=512), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('user_id', 'agent', 'name'),
    )
    bind = op.get_bind()
    agents = {(r.user_id, r.item_id): (r.name, _object((r.data or {}).get("CONFIG")), r.data or {}) for r in bind.execute(sa.text(
        "SELECT user_id, item_id, name, data FROM cloud_configs WHERE kind = 'agent' AND deleted_at IS NULL"
    ))}
    links = bind.execute(sa.text(
        "SELECT a.user_id, a.agent_id, t.* FROM agent_tools a JOIN user_tools t ON t.tool_id = a.tool_id ORDER BY a.user_id, a.agent_id, a.position"
    )).mappings().all()
    changed: set[tuple[str, str]] = set()
    for link in links:
        key = (link["user_id"], link["agent_id"])
        if key not in agents:
            continue
        agent, config, _ = agents[key]
        kind, c = link["kind"], link["config"] or {}
        if kind in ("postgres", "snowflake"):
            # A secret sealed under this agent and name opens as before; any other is left out.
            keep = link["ciphertext"] is not None and link["secret_aad"] == f"{kind}:{agent}:{link['name']}"
            values: dict[str, Any] = {"u": link["user_id"], "a": agent, "n": link["name"], "d": link["description"], **{f: link[f] if keep else None for f in SECRET}}
            if kind == "postgres":
                values.update(h=c.get("host", ""), p=c.get("port", 5432), db=c.get("database", ""), du=c.get("user", ""), s=c.get("ssl", "verify"), ch=bool(c.get("changes")))
                sql = ("INSERT INTO cloud_postgres (user_id, agent, name, description, host, port, database, db_user, ssl, changes, ciphertext, nonce, wrapped_key, kek_id)"
                       " VALUES (:u, :a, :n, :d, :h, :p, :db, :du, :s, :ch, :ciphertext, :nonce, :wrapped_key, :kek_id) ON CONFLICT DO NOTHING")
            else:
                values.update(ac=c.get("account", ""), db=c.get("database", ""), wh=c.get("warehouse", ""), sc=c.get("schema", ""), r=c.get("role", ""), du=c.get("user", ""), au=c.get("auth", "token"), ch=bool(c.get("changes")))
                sql = ("INSERT INTO cloud_snowflake (user_id, agent, name, description, account, database, warehouse, schema_name, role, db_user, auth, changes, ciphertext, nonce, wrapped_key, kek_id)"
                       " VALUES (:u, :a, :n, :d, :ac, :db, :wh, :sc, :r, :du, :au, :ch, :ciphertext, :nonce, :wrapped_key, :kek_id) ON CONFLICT DO NOTHING")
            bind.execute(sa.text(sql), values)
            continue
        if config is None:
            continue
        if kind == "program":
            config.setdefault(PROGRAMS, []).append({"name": link["name"], "description": link["description"], "command": c.get("command", ""), "args": c.get("args", [])})
        else:
            config.setdefault(SITES[kind], []).append({"address": link["name"], "description": link["description"]})
        changed.add(key)
    for key in changed:
        _, config, data = agents[key]
        bind.execute(
            sa.text("UPDATE cloud_configs SET data = CAST(:d AS jsonb) WHERE user_id = :u AND kind = 'agent' AND item_id = :a"),
            {"d": json.dumps({**data, "CONFIG": _dump(config)}), "u": key[0], "a": key[1]},
        )
    op.drop_index('ix_agent_tools_tool', table_name='agent_tools')
    op.drop_table('agent_tools')
    op.drop_index('ix_user_tools_user_kind_name', table_name='user_tools')
    op.drop_index('ix_user_tools_user_id', table_name='user_tools')
    op.drop_table('user_tools')
