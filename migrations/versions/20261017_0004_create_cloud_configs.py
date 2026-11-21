"""create cloud_configs

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-17 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0004'
down_revision: str | None = '0003'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('cloud_configs',
    sa.Column('user_id', sa.String(length=255), nullable=False),
    sa.Column('kind', sa.String(length=32), nullable=False),
    sa.Column('item_id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('data', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('secret', sa.String(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('user_id', 'kind', 'item_id')
    )
    op.create_index('ux_cloud_configs_name', 'cloud_configs', ['user_id', 'kind', 'name'], unique=True)


def downgrade() -> None:
    op.drop_index('ux_cloud_configs_name', table_name='cloud_configs')
    op.drop_table('cloud_configs')
