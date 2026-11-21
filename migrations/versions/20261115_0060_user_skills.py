"""user_skills and agent_skills: skills get an id, and agents link to them by it

A skill was a ``skill`` cloud item keyed by its name, and an agent named its skills in its
settings' ``skills`` list, so a skill could not be renamed. Now:

- ``user_skills``: one row per skill — ``skill_id`` (a UUID), its owner (``user_id``), its
  ``name`` (unique per owner), ``description`` and ``files`` (``[{path, id, size}]``, their
  bytes still in the skill file store under the owner's id);
- ``agent_skills``: which agents have which skills, in order — the agent by its owner and its
  cloud item's ``item_id``, the skill by id (deleting the skill deletes the link). The agent's
  owner and the skill's are kept apart so a skill can later be shared with another person.

The upgrade copies every live ``skill`` item into ``user_skills`` (one whose ``item_id`` is not
a skill's name is dropped, as every reader skipped it) and every agent's ``skills`` names into
``agent_skills`` (a name with no skill is dropped), takes ``skills`` out of the agents' settings
and deletes the ``skill`` items, tombstones too: it is a clean break — clients that synced
``skill`` items no longer see them. The downgrade puts them back the same way, without ids.

Revision ID: 0060
Revises: 0059
Create Date: 2026-11-15 20:00:00.000000
"""

import json
import re
import uuid
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = '0060'
down_revision: str | None = '0059'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NAME = re.compile(r"^[a-z][a-z0-9_-]{0,39}$")
FILE_ID = re.compile(r"^[0-9a-f]{64}$")
SKILLS = "skills"


def _object(text: Any) -> dict[str, Any] | None:
    try:
        value = json.loads(text) if isinstance(text, str) else None
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def _files(config: dict[str, Any] | None) -> list[dict[str, Any]]:
    files = (config or {}).get("files")
    return [
        {"path": f["path"], "id": f["id"], "size": f["size"]}
        for f in (files if isinstance(files, list) else [])
        if isinstance(f, dict) and isinstance(f.get("path"), str) and f["path"] and isinstance(f.get("id"), str) and FILE_ID.match(f["id"])
        and isinstance(f.get("size"), int) and not isinstance(f["size"], bool) and f["size"] >= 0
    ]


def _dump(config: dict[str, Any]) -> str:
    return json.dumps(config, separators=(",", ":"), ensure_ascii=False)


def upgrade() -> None:
    op.create_table(
        'user_skills',
        sa.Column('skill_id', UUID(as_uuid=False), nullable=False),
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('name', sa.String(length=40), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('files', JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('skill_id'),
    )
    op.create_index('ix_user_skills_user_id', 'user_skills', ['user_id'])
    op.create_index('ix_user_skills_user_name', 'user_skills', ['user_id', 'name'], unique=True)
    op.create_table(
        'agent_skills',
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('agent_id', sa.String(length=64), nullable=False),
        sa.Column('skill_id', UUID(as_uuid=False), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['skill_id'], ['user_skills.skill_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'agent_id', 'skill_id'),
    )
    op.create_index('ix_agent_skills_skill', 'agent_skills', ['skill_id'])

    bind = op.get_bind()
    ids: dict[tuple[str, str], str] = {}
    for row in bind.execute(sa.text(
        "SELECT user_id, item_id, data, created_at, updated_at FROM cloud_configs WHERE kind = 'skill' AND deleted_at IS NULL ORDER BY user_id, item_id"
    )).mappings():
        if not NAME.match(row["item_id"]):
            continue
        data = row["data"] or {}
        skill_id = str(uuid.uuid4())
        ids[(row["user_id"], row["item_id"])] = skill_id
        bind.execute(
            sa.text(
                "INSERT INTO user_skills (skill_id, user_id, name, description, files, created_at, updated_at) "
                "VALUES (CAST(:i AS uuid), :u, :n, :d, CAST(:f AS jsonb), :c, :m)"
            ),
            {"i": skill_id, "u": row["user_id"], "n": row["item_id"], "d": str(data.get("DESCRIPTION") or ""),
             "f": json.dumps(_files(_object(data.get("CONFIG")))), "c": row["created_at"], "m": row["updated_at"]},
        )
    for row in bind.execute(sa.text(
        "SELECT user_id, item_id, data FROM cloud_configs WHERE kind = 'agent' AND deleted_at IS NULL"
    )).mappings():
        data = row["data"] or {}
        config = _object(data.get("CONFIG"))
        if config is None or SKILLS not in config:
            continue
        names = config.pop(SKILLS)
        wanted = list(dict.fromkeys(n for n in names if isinstance(n, str))) if isinstance(names, list) else []
        for position, skill_id in enumerate(i for i in (ids.get((row["user_id"], n)) for n in wanted) if i is not None):
            bind.execute(
                sa.text("INSERT INTO agent_skills (user_id, agent_id, skill_id, position) VALUES (:u, :a, CAST(:s AS uuid), :p)"),
                {"u": row["user_id"], "a": row["item_id"], "s": skill_id, "p": position},
            )
        bind.execute(
            sa.text("UPDATE cloud_configs SET data = CAST(:d AS jsonb) WHERE user_id = :u AND kind = 'agent' AND item_id = :a"),
            {"d": json.dumps({**data, "CONFIG": _dump(config)}), "u": row["user_id"], "a": row["item_id"]},
        )
    op.execute("DELETE FROM cloud_configs WHERE kind = 'skill'")


def downgrade() -> None:
    bind = op.get_bind()
    names: dict[str, str] = {}
    for row in bind.execute(sa.text("SELECT skill_id, user_id, name, description, files, created_at, updated_at FROM user_skills")).mappings():
        names[str(row["skill_id"])] = row["name"]
        revision = bind.execute(sa.text("SELECT revision FROM cloud_config_heads WHERE user_id = :u"), {"u": row["user_id"]}).scalar() or 0
        data = {
            "SKILL_NAME": row["name"], "DESCRIPTION": row["description"], "CONFIG": _dump({"files": row["files"] or []}),
            "UPDATED_AT": row["updated_at"].isoformat(),
        }
        bind.execute(
            sa.text(
                "INSERT INTO cloud_configs (user_id, kind, item_id, name, data, revision, created_at, updated_at) "
                "VALUES (:u, 'skill', :n, :n, CAST(:d AS jsonb), :r, :c, :m)"
            ),
            {"u": row["user_id"], "n": row["name"], "d": json.dumps(data), "r": revision, "c": row["created_at"], "m": row["updated_at"]},
        )
    agents: dict[tuple[str, str], list[str]] = {}
    for row in bind.execute(sa.text("SELECT user_id, agent_id, skill_id FROM agent_skills ORDER BY user_id, agent_id, position")).mappings():
        agents.setdefault((row["user_id"], row["agent_id"]), []).append(names[str(row["skill_id"])])
    for (user_id, agent_id), wanted in agents.items():
        data = bind.execute(
            sa.text("SELECT data FROM cloud_configs WHERE user_id = :u AND kind = 'agent' AND item_id = :a AND deleted_at IS NULL"), {"u": user_id, "a": agent_id}
        ).scalar()
        config = _object((data or {}).get("CONFIG"))
        if config is None:
            continue
        bind.execute(
            sa.text("UPDATE cloud_configs SET data = CAST(:d AS jsonb) WHERE user_id = :u AND kind = 'agent' AND item_id = :a"),
            {"d": json.dumps({**data, "CONFIG": _dump({**config, SKILLS: wanted})}), "u": user_id, "a": agent_id},
        )
    op.drop_index('ix_agent_skills_skill', table_name='agent_skills')
    op.drop_table('agent_skills')
    op.drop_index('ix_user_skills_user_name', table_name='user_skills')
    op.drop_index('ix_user_skills_user_id', table_name='user_skills')
    op.drop_table('user_skills')
