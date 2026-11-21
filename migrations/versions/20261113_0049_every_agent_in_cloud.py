"""every agent lives in Wysebee Cloud

No agent lives on Wysebee Desktop any more (2026-11-13, the person's call): an agent on the
person's own computer is Wysebee Agent for Mac's or the browser extension's, and those live in
the cloud too. Pairing makes every new agent in the cloud (apps/cloud/browser_links.py
``claim``) and a save turns any other home into the cloud (apps/cloud/configs.py
``in_the_cloud``); this moves the agents that still live on a desktop (or an old phone). Where
each lived is kept beside it, as ``former_home`` / ``former_home_name``, so the move can be
undone. Each moved item gets the person's next revision, so their apps hear of it through the
change feed.

Revision ID: 0049
Revises: 0048
Create Date: 2026-11-13 18:00:00.000000
"""

import json
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = '0049'
down_revision: str | None = '0048'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CLOUD = "cloud"
CLOUD_NAME = "Wysebee Cloud"
CHANGED_BY = "migration/0049"


def _config(data: Any) -> dict[str, Any] | None:
    if not isinstance(data, dict) or not isinstance(data.get("CONFIG"), str):
        return None
    try:
        config = json.loads(data["CONFIG"])
    except ValueError:
        return None
    return config if isinstance(config, dict) else None


def moved(data: Any) -> dict[str, Any] | None:
    """The item's data with its agent living in the cloud, or None when it lives there
    already, has no home (the cloud's too) or cannot be read."""
    config = _config(data)
    home = config.get("home") if config is not None else None
    if config is None or not isinstance(home, str) or not home.strip() or home == CLOUD:
        return None
    config["former_home"] = home
    if "home_name" in config:
        config["former_home_name"] = config["home_name"]
    config["home"], config["home_name"] = CLOUD, CLOUD_NAME
    return {**data, "CONFIG": json.dumps(config)}


def back(data: Any) -> dict[str, Any] | None:
    """The item's data as it was before :func:`moved`, or None when it was not moved."""
    config = _config(data)
    if config is None or not isinstance(config.get("former_home"), str):
        return None
    config["home"] = config.pop("former_home")
    if "former_home_name" in config:
        config["home_name"] = config.pop("former_home_name")
    else:
        config.pop("home_name", None)
    return {**data, "CONFIG": json.dumps(config)}


def _rewrite(change) -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT user_id, item_id, data FROM cloud_configs WHERE kind = 'agent' AND deleted_at IS NULL")).all()
    for user_id, item_id, data in rows:
        new = change(data)
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
    _rewrite(moved)


def downgrade() -> None:
    _rewrite(back)
