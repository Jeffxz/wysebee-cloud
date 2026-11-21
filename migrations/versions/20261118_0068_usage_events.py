"""usage_events: every usage event from the site's pages, kept here as well as in Mixpanel

Until now the landing page and the web app posted their events straight to Mixpanel. From
2026-11-15 they post them to wysebee-cloud (``POST /api/v1/events``, apps/cloud/usage_events.py),
which keeps each in this table and forwards them to Mixpanel, so they can be searched here.
Indexed by when it happened, by person (or anonymous id) and by event name, and its
properties for ``@>`` searches.

The downgrade drops the table and every event in it.

Revision ID: 0068
Revises: 0067
Create Date: 2026-11-18 09:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = '0068'
down_revision: str | None = '0067'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "usage_events",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("event", sa.String(100), nullable=False),
        sa.Column("user_id", sa.String(255), nullable=True),
        sa.Column("anonymous_id", sa.String(64), nullable=True),
        sa.Column("session_id", sa.String(64), nullable=True),
        sa.Column("insert_id", sa.String(64), nullable=False),
        sa.Column("surface", sa.String(16), nullable=False),
        sa.Column("page", sa.String(200), nullable=True),
        sa.Column("app_version", sa.String(32), nullable=True),
        sa.Column("language", sa.String(35), nullable=True),
        sa.Column("properties", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.create_index("ix_usage_events_occurred", "usage_events", ["occurred_at"])
    op.create_index("ix_usage_events_user", "usage_events", ["user_id", "occurred_at"])
    op.create_index("ix_usage_events_anonymous", "usage_events", ["anonymous_id", "occurred_at"])
    op.create_index("ix_usage_events_event", "usage_events", ["event", "occurred_at"])
    op.create_index("ix_usage_events_properties", "usage_events", ["properties"], postgresql_using="gin", postgresql_ops={"properties": "jsonb_path_ops"})


def downgrade() -> None:
    op.drop_table("usage_events")
