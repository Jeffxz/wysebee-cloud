"""create relay_desktops and relay_calls

The relay that lets a signed-in person use their own Wysebee Desktop from their own AI
app (Claude, ChatGPT) through ``/mcp``: apps/cloud/relay.py.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-20 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0007'
down_revision: str | None = '0006'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('relay_desktops',
    sa.Column('user_id', sa.String(length=255), nullable=False),
    sa.Column('instance_id', sa.String(length=64), nullable=False),
    sa.Column('app_version', sa.String(length=32), nullable=True),
    sa.Column('last_seen', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('user_id', 'instance_id')
    )
    op.create_table('relay_calls',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('user_id', sa.String(length=255), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('message', sa.Text(), nullable=False),
    sa.Column('result', sa.Text(), nullable=True),
    sa.Column('is_error', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('claimed_by', sa.String(length=64), nullable=True),
    sa.Column('client_id', sa.String(length=128), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_relay_calls_user_status', 'relay_calls', ['user_id', 'status', 'created_at'])


def downgrade() -> None:
    op.drop_index('ix_relay_calls_user_status', table_name='relay_calls')
    op.drop_table('relay_calls')
    op.drop_table('relay_desktops')
