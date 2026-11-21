"""agent types are a table

Which kinds of device can pair is data, not code (2026-11-13, later, the owner's call; both
device protocols' "agent types are a table"): ``agent_types``, seeded with Wysebee Chrome
Agent and Wysebee OSX Agent under fixed ids, so every environment has the same.
``browser_links.agent_type_id`` names each link's type, filled from the old ``kind`` (which
stays). Every agent's ``CONFIG.paired_kind`` becomes its type's key (``browser`` ->
``wysebee-browser-chrome``, ``osx`` -> ``wysebee-osx``) and gains ``agent_type_id``; an agent
with a link and no ``paired_kind`` (paired before it existed) gets both from its link. Each
changed item gets the person's next revision, so their apps hear of it.

Revision ID: 0050
Revises: 0049
Create Date: 2026-11-13 21:00:00.000000
"""

import json
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = '0050'
down_revision: str | None = '0049'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CHANGED_BY = "migration/0050"
CHROME_ID = "6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c01"
OSX_ID = "6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c02"
# The ops the cloud took from a browser link until now (browser_links.OPS).
BROWSER_OPS = [
    "ping", "browser_tabs", "browser_activate", "browser_snapshot", "browser_screenshot",
    "browser_navigate", "browser_click", "browser_type", "browser_open_tab",
    "browser_close_tab", "browser_scroll", "browser_drag", "browser_mouse",
    "browser_bookmarks", "browser_console", "browser_network", "browser_network_body",
    "browser_evaluate", "browser_viewport", "browser_inspect", "browser_audit",
    "browser_performance", "browser_reload", "recording_saved",
]
SEED = [
    {
        "id": CHROME_ID, "key": "wysebee-browser-chrome", "name": "Wysebee Chrome Agent",
        "description": "An agent that works in your Chrome browser, through the Wysebee Agent extension.",
        "link_field": "browser_link", "ops": BROWSER_OPS,
        "tool_kinds": ["browser", "devtools", "gmail", "calendar", "travel", "news", "website"],
    },
    {
        "id": OSX_ID, "key": "wysebee-osx", "name": "Wysebee OSX Agent",
        "description": "An agent that runs the programs, skill scripts and folder tools you allow on your Mac, through Wysebee Agent for Mac.",
        "link_field": "mac_link", "ops": ["ping", "local_run", "skill_run", "folder_call"],
        "tool_kinds": ["local", "folder", "sqlite", "skill_scripts"],
    },
]
# Old kind -> (type key, type id), and back.
TYPES = {"browser": ("wysebee-browser-chrome", CHROME_ID), "osx": ("wysebee-osx", OSX_ID)}
FIELDS = {"browser": "browser_link", "osx": "mac_link"}


def _config(data: Any) -> dict[str, Any] | None:
    if not isinstance(data, dict) or not isinstance(data.get("CONFIG"), str):
        return None
    try:
        config = json.loads(data["CONFIG"])
    except ValueError:
        return None
    return config if isinstance(config, dict) else None


def typed(data: Any, linked: str | None) -> dict[str, Any] | None:
    """The item's data with its type's key and id (``linked``: the old kind of the link it
    holds, if any), or None when nothing changes or it cannot be read."""
    config = _config(data)
    if config is None:
        return None
    kind = config.get("paired_kind")
    if kind not in TYPES:
        if kind is not None or linked is None or not config.get(FIELDS[linked]):
            return None
        kind = linked
    config["paired_kind"], config["agent_type_id"] = TYPES[kind]
    return {**data, "CONFIG": json.dumps(config)}


def untyped(data: Any, _linked: str | None) -> dict[str, Any] | None:
    """The item's data as before :func:`typed`: the old kind back, no type id."""
    config = _config(data)
    old = next((k for k, (key, _) in TYPES.items() if config is not None and config.get("paired_kind") == key), None)
    if config is None or old is None:
        return None
    config["paired_kind"] = old
    config.pop("agent_type_id", None)
    return {**data, "CONFIG": json.dumps(config)}


def _rewrite(change) -> None:
    conn = op.get_bind()
    links = {(r.user_id, r.agent): r.kind for r in conn.execute(sa.text("SELECT user_id, agent, kind FROM browser_links WHERE user_id IS NOT NULL"))}
    rows = conn.execute(sa.text("SELECT user_id, item_id, name, data FROM cloud_configs WHERE kind = 'agent' AND deleted_at IS NULL")).all()
    for user_id, item_id, name, data in rows:
        new = change(data, links.get((user_id, name)))
        if new is None:
            continue
        head = conn.execute(
            sa.text(
                "INSERT INTO cloud_config_heads (user_id, revision) VALUES (:u, 1) "
                "ON CONFLICT (user_id) DO UPDATE SET revision = cloud_config_heads.revision + 1, updated_at = now() "
                "RETURNING revision"
            ),
            {"u": user_id},
        ).scalar_one()
        conn.execute(
            sa.text(
                "UPDATE cloud_configs SET data = CAST(:d AS jsonb), revision = :r, updated_at = now(), changed_by = :by "
                "WHERE user_id = :u AND kind = 'agent' AND item_id = :i"
            ),
            {"d": json.dumps(new), "r": head, "by": CHANGED_BY, "u": user_id, "i": item_id},
        )


def upgrade() -> None:
    table = op.create_table(
        "agent_types",
        sa.Column("id", UUID(as_uuid=False), primary_key=True),
        sa.Column("key", sa.Text(), nullable=False, unique=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("link_field", sa.Text(), nullable=False),
        sa.Column("ops", JSONB(), nullable=False),
        sa.Column("tool_kinds", JSONB(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.bulk_insert(table, SEED)
    op.add_column("browser_links", sa.Column("agent_type_id", UUID(as_uuid=False), nullable=True))
    op.execute(f"UPDATE browser_links SET agent_type_id = CASE WHEN kind = 'osx' THEN '{OSX_ID}'::uuid ELSE '{CHROME_ID}'::uuid END")
    op.alter_column("browser_links", "agent_type_id", nullable=False)
    op.create_foreign_key("fk_browser_links_agent_type", "browser_links", "agent_types", ["agent_type_id"], ["id"])
    _rewrite(typed)


def downgrade() -> None:
    _rewrite(untyped)
    op.drop_constraint("fk_browser_links_agent_type", "browser_links", type_="foreignkey")
    op.drop_column("browser_links", "agent_type_id")
    op.drop_table("agent_types")
