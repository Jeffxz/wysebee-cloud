"""create backup tables

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-16 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0003'
down_revision: str | None = '0002'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('backup_keys',
    sa.Column('user_id', sa.String(length=255), nullable=False),
    sa.Column('key_id', sa.String(length=32), nullable=False),
    sa.Column('envelope', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('user_id')
    )
    op.create_table('backups',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('user_id', sa.String(length=255), nullable=False),
    sa.Column('key_id', sa.String(length=32), nullable=False),
    sa.Column('app_version', sa.String(length=64), nullable=False),
    sa.Column('meta', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('objects', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('size_bytes', sa.BigInteger(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_backups_user_id'), 'backups', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_backups_user_id'), table_name='backups')
    op.drop_table('backups')
    op.drop_table('backup_keys')
