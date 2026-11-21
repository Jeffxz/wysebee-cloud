"""agent type wysebee-android

Registers **Wysebee Android Agent** (``wysebee-android``): Wysebee Agent for Android
(``wysebee-agent-android``), an app that lets one agent operate a phone through an
accessibility service — read the screen, screenshot, tap, type, swipe, scroll, press its keys
and open apps — only in the apps the person allowed on the phone. Its link is held in the new
field ``android_link`` (legacy ``kind`` ``android``; apps/cloud/agent_types.py ``LINK_FIELDS``);
its poll carries nothing but calls, as a browser's does. A fixed id, so every environment has
the same.

Revision ID: 0059
Revises: 0058
Create Date: 2026-11-15 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = '0059'
down_revision: str | None = '0058'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ANDROID_ID = "6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c05"
ANDROID = "wysebee-android"
ROW = {
    "id": ANDROID_ID, "key": ANDROID, "name": "Wysebee Android Agent",
    "description": "An agent that operates your Android phone as you would — reads the screen, taps, types, swipes and opens apps — only in the apps you allow, through Wysebee Agent for Android.",
    "link_field": "android_link",
    "ops": [
        "ping", "android_apps", "android_launch", "android_snapshot", "android_screenshot",
        "android_tap", "android_type", "android_swipe", "android_scroll", "android_key",
    ],
    "tool_kinds": ["android"],
}


def upgrade() -> None:
    table = sa.table(
        "agent_types",
        sa.column("id", UUID(as_uuid=False)), sa.column("key", sa.Text()), sa.column("name", sa.Text()),
        sa.column("description", sa.Text()), sa.column("link_field", sa.Text()),
        sa.column("ops", JSONB()), sa.column("tool_kinds", JSONB()),
    )
    # An environment where an admin registered it by hand keeps that row.
    if op.get_bind().execute(sa.text("SELECT 1 FROM agent_types WHERE key = :k"), {"k": ANDROID}).first() is None:
        op.bulk_insert(table, [ROW])


def downgrade() -> None:
    # Links of it name it (a foreign key): a downgrade with phones still paired fails rather
    # than leave them typeless. Unpair them first.
    op.execute(sa.text("DELETE FROM agent_types WHERE id = CAST(:i AS uuid)").bindparams(i=ANDROID_ID))
