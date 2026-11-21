"""relay_desktops.catalog: the tools each desktop offers through /mcp

/mcp no longer has one tool of its own (ask_wysebee): it lists the browser tools the
person's Wysebee Desktop says it has, sent with each poll, and forwards each call to it
(apps/cloud/relay.py).

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-21 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0008'
down_revision: str | None = '0007'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('relay_desktops', sa.Column('catalog', postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column('relay_desktops', 'catalog')
