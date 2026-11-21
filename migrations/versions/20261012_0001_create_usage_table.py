"""create usage table

Revision ID: 0001
Revises:
Create Date: 2026-10-12 08:38:00.585381
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0001'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('usage',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('insert_id', sa.String(length=64), nullable=False),
    sa.Column('event', sa.String(length=100), nullable=False),
    sa.Column('distinct_id', sa.String(length=255), nullable=False),
    sa.Column('session_id', sa.String(length=64), nullable=True),
    sa.Column('app_version', sa.String(length=32), nullable=True),
    sa.Column('os', sa.String(length=32), nullable=True),
    sa.Column('lib', sa.String(length=64), nullable=True),
    sa.Column('event_time', sa.DateTime(timezone=True), nullable=False),
    sa.Column('received_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('properties', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('insert_id')
    )
    op.create_index('ix_usage_distinct_id_event_time', 'usage', ['distinct_id', 'event_time'], unique=False)
    op.create_index('ix_usage_event_event_time', 'usage', ['event', 'event_time'], unique=False)
    op.create_index('ix_usage_event_time', 'usage', ['event_time'], unique=False)
    op.create_index('ix_usage_properties', 'usage', ['properties'], unique=False, postgresql_using='gin', postgresql_ops={'properties': 'jsonb_path_ops'})


def downgrade() -> None:
    op.drop_index('ix_usage_properties', table_name='usage', postgresql_using='gin', postgresql_ops={'properties': 'jsonb_path_ops'})
    op.drop_index('ix_usage_event_time', table_name='usage')
    op.drop_index('ix_usage_event_event_time', table_name='usage')
    op.drop_index('ix_usage_distinct_id_event_time', table_name='usage')
    op.drop_table('usage')
