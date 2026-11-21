"""create user_desktops

The person's Wysebee Desktops, each reporting itself while it runs (apps/cloud/desktops.py),
so Settings → Connections can list them, running or disconnected.

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-25 14:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0013'
down_revision: str | None = '0012'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('user_desktops',
    sa.Column('user_id', sa.String(length=255), nullable=False),
    sa.Column('install_id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('os', sa.String(length=64), nullable=False),
    sa.Column('app_version', sa.String(length=32), nullable=False),
    sa.Column('first_seen', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('last_seen', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('user_id', 'install_id')
    )


def downgrade() -> None:
    op.drop_table('user_desktops')
