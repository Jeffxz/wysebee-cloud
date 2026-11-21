"""create the user data tables

A person's Wysebee data (apps/cloud/userdata.py): the desktop's own tables — topics,
conversations, task runs, reminders, settings, the Tasks order — here, each keyed by the
person first.

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-24 22:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0011'
down_revision: str | None = '0010'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

USER = sa.String(length=255)


def upgrade() -> None:
    op.create_table('user_topics',
    sa.Column('user_id', USER, nullable=False),
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('position', sa.BigInteger(), server_default=sa.text('0'), nullable=False),
    sa.Column('created_at', sa.Text(), nullable=True),
    sa.PrimaryKeyConstraint('user_id', 'id')
    )
    op.create_index('ux_user_topics_name', 'user_topics', ['user_id', sa.text('lower(name)')], unique=True)
    op.create_table('user_conversations',
    sa.Column('user_id', USER, nullable=False),
    sa.Column('conversation_key', sa.String(length=64), nullable=False),
    sa.Column('messages', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('updated_at', sa.Text(), nullable=True),
    sa.PrimaryKeyConstraint('user_id', 'conversation_key')
    )
    op.create_table('user_task_runs',
    sa.Column('user_id', USER, nullable=False),
    sa.Column('run_id', sa.String(length=64), nullable=False),
    sa.Column('task_id', sa.String(length=64), nullable=False),
    sa.Column('status', sa.String(length=32), nullable=False),
    sa.Column('trigger', sa.String(length=32), nullable=True),
    sa.Column('agent_name', sa.Text(), nullable=True),
    sa.Column('model', sa.Text(), nullable=True),
    sa.Column('started_at', sa.Text(), nullable=True),
    sa.Column('finished_at', sa.Text(), nullable=True),
    sa.Column('output', sa.Text(), nullable=True),
    sa.Column('messages', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('recording', sa.Text(), nullable=True),
    sa.PrimaryKeyConstraint('user_id', 'run_id')
    )
    op.create_index('ix_user_task_runs_task', 'user_task_runs', ['user_id', 'task_id', 'started_at'])
    op.create_table('user_reminders',
    sa.Column('user_id', USER, nullable=False),
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('due_at', sa.Text(), nullable=False),
    sa.Column('created_at', sa.Text(), nullable=True),
    sa.Column('delivered_at', sa.Text(), nullable=True),
    sa.PrimaryKeyConstraint('user_id', 'id')
    )
    op.create_index('ix_user_reminders_due', 'user_reminders', ['user_id', 'delivered_at', 'due_at'])
    op.create_table('user_settings',
    sa.Column('user_id', USER, nullable=False),
    sa.Column('settings_id', sa.String(length=64), nullable=False),
    sa.Column('config', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('updated_at', sa.Text(), nullable=True),
    sa.PrimaryKeyConstraint('user_id', 'settings_id')
    )
    op.create_table('user_nav_order',
    sa.Column('user_id', USER, nullable=False),
    sa.Column('scope', sa.String(length=64), nullable=False),
    sa.Column('config', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('updated_at', sa.Text(), nullable=True),
    sa.PrimaryKeyConstraint('user_id', 'scope')
    )


def downgrade() -> None:
    for table in ('user_nav_order', 'user_settings', 'user_reminders', 'user_task_runs', 'user_conversations', 'user_topics'):
        op.drop_table(table)
