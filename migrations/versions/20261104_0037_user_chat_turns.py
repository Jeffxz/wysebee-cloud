"""user_chat_turns: a Home chat turn's status and answer, kept beyond the page that asked

Each chat turn in a Home conversation (apps/cloud/chat_turns.py): running, then how it ended,
the answer itself when the asker was gone by then, and whether it has been posted into the
conversation and seen — so an answer that comes while Wysebee is closed shows on reopening,
with an unread badge. ``remote_turns.chat_turn`` names the chat turn a remote turn answers, so
its outcome is copied there.

Revision ID: 0037
Revises: 0036
Create Date: 2026-11-04 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0037'
down_revision: str | None = '0036'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'user_chat_turns',
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('conversation', sa.String(length=64), nullable=False),
        sa.Column('agent', sa.String(length=64), nullable=False),
        sa.Column('thread', sa.String(length=64), server_default=sa.text("''"), nullable=False),
        sa.Column('root', sa.String(length=64), server_default=sa.text("''"), nullable=False),
        sa.Column('runner', sa.String(length=64), server_default=sa.text("''"), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('messages', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('stopped', sa.String(length=32), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('error_code', sa.String(length=32), nullable=True),
        sa.Column('merged', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('seen', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('user_id', 'id'),
    )
    op.create_index('ix_user_chat_turns_open', 'user_chat_turns', ['user_id', 'merged', 'seen'])
    op.add_column('remote_turns', sa.Column('chat_turn', sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column('remote_turns', 'chat_turn')
    op.drop_index('ix_user_chat_turns_open', table_name='user_chat_turns')
    op.drop_table('user_chat_turns')
