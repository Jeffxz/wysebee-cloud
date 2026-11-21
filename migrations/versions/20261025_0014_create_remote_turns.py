"""create remote_turns

Chat turns for an agent that lives on another of the person's desktops (its Home):
sent here, picked up and run by that desktop, answered here (apps/cloud/turns.py).

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-25 16:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0014'
down_revision: str | None = '0013'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('remote_turns',
    sa.Column('user_id', sa.String(length=255), nullable=False),
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('agent', sa.String(length=64), nullable=False),
    sa.Column('home', sa.String(length=64), nullable=False),
    sa.Column('request', postgresql.JSONB(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('result', postgresql.JSONB(), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('error_status', sa.Integer(), nullable=True),
    sa.Column('cancel_seen', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('claimed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('user_id', 'id')
    )
    op.create_index('ix_remote_turns_home', 'remote_turns', ['user_id', 'home', 'status'])


def downgrade() -> None:
    op.drop_index('ix_remote_turns_home', table_name='remote_turns')
    op.drop_table('remote_turns')
