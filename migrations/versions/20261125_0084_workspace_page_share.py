"""Pages shared: a page's owner shares it with everyone (2026-11-25, the person's call)

A ``workspace_pages`` row gains who it is shared with — ``share_audience``, ``'public'`` or none
(friends and colleagues to come) — the random ``share_key`` of its public address
(``/s/<key>``), kept when the AI app writes the page again and gone when sharing stops, and
when it was shared (apps/cloud/workspace_pages.py).

Revision ID: 0084
Revises: 0083
Create Date: 2026-11-25 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0084'
down_revision: str | None = '0083'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("workspace_pages", sa.Column("share_audience", sa.String(20), nullable=True))
    op.add_column("workspace_pages", sa.Column("share_key", sa.String(64), nullable=True))
    op.add_column("workspace_pages", sa.Column("shared_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_workspace_pages_share_key", "workspace_pages", ["share_key"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_workspace_pages_share_key", table_name="workspace_pages")
    op.drop_column("workspace_pages", "shared_at")
    op.drop_column("workspace_pages", "share_key")
    op.drop_column("workspace_pages", "share_audience")
