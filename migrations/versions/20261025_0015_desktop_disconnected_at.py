"""user_desktops.disconnected_at

The person can disconnect one of their desktops from remote turns — an unrecognized one, or
their own so nothing elsewhere runs its agents' tools there (apps/cloud/desktops.py).

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-25 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0015'
down_revision: str | None = '0014'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('user_desktops', sa.Column('disconnected_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('user_desktops', 'disconnected_at')
