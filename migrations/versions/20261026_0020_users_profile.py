"""users.display_name and users.avatar

The person's profile — the display name and picture they chose — moves to their ``users``
row (apps/cloud/users.py). It was ``profile`` on Wysebee's own agent settings (the
``wysebee`` agent item's CONFIG); each one there is copied here (the agent item keeps it,
unread).

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-26 01:00:00.000000
"""

import json
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = '0020'
down_revision: str | None = '0019'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def profile_of(data: Any) -> tuple[str, str] | None:
    """(display name, avatar) from an agent item's data, or None when it has no profile."""
    if not isinstance(data, dict):
        return None
    config = data.get("CONFIG")
    if isinstance(config, str):
        try:
            config = json.loads(config)
        except ValueError:
            return None
    profile = config.get("profile") if isinstance(config, dict) else None
    if not isinstance(profile, dict):
        return None
    name = profile.get("display_name") if isinstance(profile.get("display_name"), str) else ""
    avatar = profile.get("avatar") if isinstance(profile.get("avatar"), str) else ""
    return (name.strip()[:80], avatar.strip()[:200]) if name or avatar else None


def upgrade() -> None:
    op.add_column('users', sa.Column('display_name', sa.String(80), nullable=False, server_default=''))
    op.add_column('users', sa.Column('avatar', sa.String(200), nullable=False, server_default=''))
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT user_id, data FROM cloud_configs WHERE kind = 'agent' AND name = 'wysebee' AND deleted_at IS NULL")).all()
    for user_id, data in rows:
        found = profile_of(data)
        if found is None:
            continue
        conn.execute(
            sa.text(
                "INSERT INTO users (user_id, display_name, avatar) VALUES (:u, :n, :a) "
                "ON CONFLICT (user_id) DO UPDATE SET display_name = :n, avatar = :a, updated_at = now()"
            ),
            {"u": user_id, "n": found[0], "a": found[1]},
        )


def downgrade() -> None:
    op.drop_column('users', 'avatar')
    op.drop_column('users', 'display_name')
