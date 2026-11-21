"""browser_links.kind and .approved: one link mechanism, two kinds

A link is the Wysebee Agent browser extension's (``browser``) or Wysebee Agent for Mac's
(``osx``), which runs the agent's local programs — those the person allowed on that Mac,
whose names it says with every poll (``approved``). apps/cloud/browser_links.py.

Revision ID: 0045
Revises: 0044
Create Date: 2026-11-12 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0045'
down_revision: str | None = '0044'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('browser_links', sa.Column('kind', sa.String(length=16), server_default=sa.text("'browser'"), nullable=False))
    op.add_column('browser_links', sa.Column('approved', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False))


def downgrade() -> None:
    op.drop_column('browser_links', 'approved')
    op.drop_column('browser_links', 'kind')
