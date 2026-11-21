"""browser agents live in Wysebee Cloud

An agent made by pairing the Wysebee Agent browser extension lived on the desktop where its
code was typed, so it showed offline — and could not answer — whenever that desktop was
closed, though the browser it drives was open and polling the cloud. From 2026-11-12 (the
person's call) a browser's agent always lives in Wysebee Cloud (apps/cloud/browser_links.py
``claim``), whose own loop drives the browser; this moves the ones paired before. Each moved
item gets the person's next revision, so their apps hear of it through the change feed.

Revision ID: 0048
Revises: 0047
Create Date: 2026-11-12 23:00:00.000000
"""

import json
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = '0048'
down_revision: str | None = '0047'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CLOUD = "cloud"
CLOUD_NAME = "Wysebee Cloud"


def moved(data: Any) -> dict[str, Any] | None:
    """The item's data with its agent living in the cloud, or None when it is not a browser's
    agent living elsewhere (or cannot be read)."""
    if not isinstance(data, dict) or not isinstance(data.get("CONFIG"), str):
        return None
    try:
        config = json.loads(data["CONFIG"])
    except ValueError:
        return None
    if not isinstance(config, dict):
        return None
    link = config.get("browser_link")
    if not isinstance(link, str) or not link or config.get("home") == CLOUD:
        return None
    config["home"] = CLOUD
    config["home_name"] = CLOUD_NAME
    return {**data, "CONFIG": json.dumps(config)}


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT user_id, item_id, data FROM cloud_configs WHERE kind = 'agent' AND deleted_at IS NULL")).all()
    for user_id, item_id, data in rows:
        new = moved(data)
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
                "UPDATE cloud_configs SET data = CAST(:d AS jsonb), revision = :r, updated_at = now(), changed_by = 'migration/0048' "
                "WHERE user_id = :u AND kind = 'agent' AND item_id = :i"
            ),
            {"d": json.dumps(new), "r": head, "u": user_id, "i": item_id},
        )


def downgrade() -> None:
    # Where each agent lived before is not kept; it stays in the cloud.
    pass
