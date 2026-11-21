"""add usage user_id

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-16 06:09:30.125797
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = '0002'
down_revision: str | None = '0001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('usage', sa.Column('user_id', sa.String(length=64), nullable=True))
    op.create_index('ix_usage_user_id_event_time', 'usage', ['user_id', 'event_time'], unique=False, postgresql_where=sa.text('user_id IS NOT NULL'))


def downgrade() -> None:
    op.drop_index('ix_usage_user_id_event_time', table_name='usage', postgresql_where=sa.text('user_id IS NOT NULL'))
    op.drop_column('usage', 'user_id')
