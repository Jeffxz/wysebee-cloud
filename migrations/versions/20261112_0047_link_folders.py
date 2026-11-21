"""browser_links.folders: the folders a Mac's agent may use

Local Folder left Wysebee Desktop and is a Mac agent's only: the person picks each folder
in Wysebee Agent for Mac, which says them with every poll (``folders``). The cloud keeps the
list on the link and writes it into the agent's settings as ``mac_folders``.
apps/cloud/browser_links.py; wysebee-agent-osx's docs/protocol.md, "Local folders".

Revision ID: 0047
Revises: 0046
Create Date: 2026-11-12 22:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0047'
down_revision: str | None = '0046'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('browser_links', sa.Column('folders', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False))


def downgrade() -> None:
    op.drop_column('browser_links', 'folders')
