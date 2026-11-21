"""browser recordings: the browser_record op, and the videos it uploads

The Wysebee Agent extension gained ``browser_record`` (2026-11-19): it films a tab while an
agent runs a scenario, saves the WebM to the person's Downloads and uploads it here
(``POST /browser-links/{id}/recordings``, apps/cloud/browser_recordings.py). So the Chrome
type's row gains the op (the cloud relays only ops a type lists) — added once, left as an
admin set it otherwise — and ``browser_recordings`` holds what each uploaded video is (the
video itself is in the recording store). The downgrade takes both away.

Revision ID: 0082
Revises: 0081
Create Date: 2026-11-21 14:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = '0082'
down_revision: str | None = '0081'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CHROME = "wysebee-browser-chrome"
OP = "browser_record"


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE agent_types SET ops = ops || jsonb_build_array(CAST(:item AS text)), updated_at = now() "
            "WHERE key = :key AND NOT ops ? :item"
        ).bindparams(key=CHROME, item=OP)
    )
    op.create_table(
        "browser_recordings",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("user_id", sa.String(255), nullable=False),
        sa.Column("link_id", sa.String(32), nullable=False),
        sa.Column("agent_id", UUID(as_uuid=False), sa.ForeignKey("user_agents.agent_id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_ms", sa.BigInteger(), nullable=False),
        sa.Column("origin", sa.String(255), nullable=True),
        sa.Column("call_id", sa.String(64), nullable=True),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_browser_recordings_user_created", "browser_recordings", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_browser_recordings_user_created", table_name="browser_recordings")
    op.drop_table("browser_recordings")
    op.execute(sa.text("UPDATE agent_types SET ops = ops - CAST(:item AS text), updated_at = now() WHERE key = :key").bindparams(key=CHROME, item=OP))
