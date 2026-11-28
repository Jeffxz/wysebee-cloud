"""Pages run tools: what a page may run without asking its owner again

The person's call (2026-11-28): a page shown in Wysebee (its owner's own view, never its public
address) asks the web app around it to run one of the person's agents' tools
(``wysebee.callTool``), and the person approves each tool the first time. "Always" is kept here,
one row per page, agent and tool: ``reads`` says it only reads; a tool that can change something
keeps the page's ``view_key`` it was allowed for, so a page written again asks again
(apps/cloud/page_tools.py). Deleted with its page.

Revision ID: 0086
Revises: 0085
Create Date: 2026-11-28 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = '0086'
down_revision: str | None = '0085'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "page_tool_grants",
        sa.Column("page_id", UUID(as_uuid=False), sa.ForeignKey("workspace_pages.page_id", ondelete="CASCADE"), primary_key=True),
        sa.Column("agent", sa.String(100), primary_key=True),
        sa.Column("tool", sa.String(200), primary_key=True),
        sa.Column("reads", sa.Boolean(), nullable=False),
        sa.Column("view_key", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("page_tool_grants")
