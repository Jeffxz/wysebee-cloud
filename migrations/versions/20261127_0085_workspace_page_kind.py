"""Pages made directly: a page that is a workspace file of its own

The person's call (2026-11-27): a page can be made directly — a ``.html`` file in the
workspace, written by the person or by their AI app's ``write_document`` — not only as the
designed view the AI app's ``write_page`` keeps for a document. ``workspace_pages.kind`` says
which: ``"view"`` (its bytes in the hidden ``.pages`` folder, as before) or ``"file"`` (its bytes
the ``.html`` file at ``source_path`` itself) (apps/cloud/workspace_pages.py).

Revision ID: 0085
Revises: 0084
Create Date: 2026-11-27 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0085'
down_revision: str | None = '0084'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("workspace_pages", sa.Column("kind", sa.String(10), nullable=False, server_default="view"))


def downgrade() -> None:
    op.drop_column("workspace_pages", "kind")
