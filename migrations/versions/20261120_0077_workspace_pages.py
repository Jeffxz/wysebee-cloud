"""Pages: rich HTML made from a workspace document by the person's AI app

The person's call (2026-11-17): Wysebee Assistant's ``write_page`` keeps a self-contained HTML
page for the document open in the editor — one per document, its id stable across rewrites —
in the workspace's hidden ``.pages`` folder in the workspace store
(``<user>/<workspace id>/.pages/<page id>.html``), and a ``workspace_pages`` row says which
document it is of, and a random ``view_key``, new each time it is written, for the address it
is shown at (apps/cloud/workspace_pages.py). Deleted with the workspace.

Revision ID: 0077
Revises: 0076
Create Date: 2026-11-20 14:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = '0077'
down_revision: str | None = '0076'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workspace_pages",
        sa.Column("page_id", UUID(as_uuid=False), primary_key=True),
        sa.Column("user_id", sa.String(255), nullable=False),
        sa.Column("workspace_id", UUID(as_uuid=False), sa.ForeignKey("user_workspaces.workspace_id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_path", sa.String(400), nullable=False),
        sa.Column("title", sa.String(200), nullable=False, server_default=""),
        sa.Column("view_key", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_workspace_pages_workspace_source", "workspace_pages", ["workspace_id", "source_path"], unique=True)
    op.create_index("ix_workspace_pages_user_id", "workspace_pages", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_workspace_pages_user_id", table_name="workspace_pages")
    op.drop_index("ix_workspace_pages_workspace_source", table_name="workspace_pages")
    op.drop_table("workspace_pages")
