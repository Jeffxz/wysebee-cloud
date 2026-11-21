"""user_tasks: tasks get a table of their own, keyed by a UUID; cloud items go

As skills (0060), tools (0061), agents (0063) and projects (0064): a person's tasks leave the
cloud items (``kind 'task'`` rows of ``cloud_configs``, their settings JSON text in
``data.CONFIG``) for ``user_tasks`` (``task_id`` a UUID — the item's id, every one a uuid
hex; another is given a new one — ``name`` unique per owner, ``config`` an object,
``creator``). ``task_schedules`` and ``user_task_runs`` link to it by a foreign key, deleted
with the task; a schedule or run whose task is gone (or never was) is deleted here.

Tasks were the last kind of cloud item, so ``cloud_configs`` is dropped.
``cloud_config_heads`` stays: saving an agent or a task still bumps it for the change feed.

The downgrade makes ``cloud_configs`` again with the tasks in it (a uuid's hex as
``item_id``) and puts the two links back as text.

Revision ID: 0065
Revises: 0064
Create Date: 2026-11-16 15:00:00.000000
"""

import json
import uuid
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = '0065'
down_revision: str | None = '0064'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STAMP = "%Y-%m-%d %H:%M:%S"
LINKS = {"task_schedules": "task_schedules_task_id_fkey", "user_task_runs": "user_task_runs_task_id_fkey"}

# As it was at 0064 (pg_dump --schema-only).
DDL = """
CREATE TABLE cloud_configs (
    user_id character varying(255) NOT NULL,
    kind character varying(32) NOT NULL,
    item_id character varying(64) NOT NULL,
    name character varying(255) NOT NULL,
    data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    revision bigint DEFAULT 0 NOT NULL,
    deleted_at timestamp with time zone,
    changed_by character varying(128)
);
ALTER TABLE ONLY cloud_configs ADD CONSTRAINT cloud_configs_pkey PRIMARY KEY (user_id, kind, item_id);
CREATE INDEX ix_cloud_configs_user_revision ON cloud_configs USING btree (user_id, revision);
CREATE UNIQUE INDEX ux_cloud_configs_name ON cloud_configs USING btree (user_id, kind, name) WHERE (deleted_at IS NULL);
"""


def _object(text: Any) -> dict[str, Any]:
    try:
        value = json.loads(text) if isinstance(text, str) else text
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def _id_of(item_id: str) -> str:
    try:
        return str(uuid.UUID(item_id))
    except ValueError:
        return str(uuid.uuid4())


def upgrade() -> None:
    bind = op.get_bind()
    op.create_table(
        "user_tasks",
        sa.Column("task_id", UUID(as_uuid=False), primary_key=True),
        sa.Column("user_id", sa.String(255), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("config", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("creator", sa.String(320), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_user_tasks_user_id", "user_tasks", ["user_id"])
    op.create_index("ix_user_tasks_user_name", "user_tasks", ["user_id", "name"], unique=True)

    tasks = sa.table(
        "user_tasks", sa.column("task_id"), sa.column("user_id"), sa.column("name"), sa.column("config", JSONB),
        sa.column("creator"), sa.column("created_at"), sa.column("updated_at"),
    )
    ids: dict[tuple[str, str], str] = {}
    taken: set[str] = set()
    for r in bind.execute(sa.text(
        "SELECT user_id, item_id, name, data, created_at, updated_at FROM cloud_configs WHERE kind = 'task' AND deleted_at IS NULL "
        "ORDER BY created_at, user_id"
    )).all():
        data = r.data if isinstance(r.data, dict) else {}
        creator = data.get("CREATOR")
        task_id = _id_of(r.item_id)
        # An item's id was unique per person only: one an earlier item of another person's
        # already took gets a new one.
        if task_id in taken:
            task_id = str(uuid.uuid4())
        taken.add(task_id)
        bind.execute(tasks.insert().values(
            task_id=task_id, user_id=r.user_id, name=r.name[:200], config=_object(data.get("CONFIG")),
            creator=creator[:320] if isinstance(creator, str) and creator else None, created_at=r.created_at, updated_at=r.updated_at,
        ))
        ids[(r.user_id, r.item_id)] = task_id

    op.execute("CREATE TEMPORARY TABLE task_map (user_id varchar(255), ref varchar(255), task_id uuid) ON COMMIT DROP")
    if ids:
        pairs = sa.table("task_map", sa.column("user_id"), sa.column("ref"), sa.column("task_id"))
        bind.execute(pairs.insert(), [{"user_id": u, "ref": ref, "task_id": t} for (u, ref), t in ids.items()])
    for table, fk in LINKS.items():
        op.execute(f"DELETE FROM {table} t WHERE NOT EXISTS (SELECT 1 FROM task_map m WHERE m.user_id = t.user_id AND m.ref = t.task_id)")
        op.execute(f"UPDATE {table} t SET task_id = m.task_id::text FROM task_map m WHERE m.user_id = t.user_id AND m.ref = t.task_id")
        op.execute(f"ALTER TABLE {table} ALTER COLUMN task_id TYPE uuid USING task_id::uuid")
        op.create_foreign_key(fk, table, "user_tasks", ["task_id"], ["task_id"], ondelete="CASCADE")
    op.drop_table("cloud_configs")


def downgrade() -> None:
    bind = op.get_bind()
    for statement in DDL.split(";"):
        if statement.strip():
            op.execute(statement)
    for table, fk in LINKS.items():
        op.drop_constraint(fk, table, type_="foreignkey")
        op.execute(f"ALTER TABLE {table} ALTER COLUMN task_id TYPE varchar({255 if table == 'task_schedules' else 64}) USING replace(task_id::text, '-', '')")
    for r in bind.execute(sa.text("SELECT task_id, user_id, name, config, creator, created_at, updated_at FROM user_tasks")).all():
        item_id = uuid.UUID(str(r.task_id)).hex
        data = {
            "ID": item_id, "TASK_NAME": r.name, "CONFIG": json.dumps(r.config or {}), "CREATOR": r.creator,
            "CREATED_AT": r.created_at.strftime(STAMP), "UPDATED_AT": r.updated_at.strftime(STAMP),
        }
        bind.execute(
            sa.text(
                "INSERT INTO cloud_configs (user_id, kind, item_id, name, data, created_at, updated_at, revision) "
                "VALUES (CAST(:u AS varchar), 'task', :i, :n, CAST(:d AS jsonb), :c, :m, "
                "COALESCE((SELECT h.revision FROM cloud_config_heads h WHERE h.user_id = CAST(:u AS varchar)), 0))"
            ),
            {"u": r.user_id, "i": item_id, "n": r.name, "d": json.dumps(data), "c": r.created_at, "m": r.updated_at},
        )
    op.drop_table("user_tasks")
