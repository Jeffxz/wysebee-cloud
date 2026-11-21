"""add user_notifications.agent, create mcp_last_agents

The agent a notification is from (apps/cloud/notifications.py): the one the AI app names, else
the agent whose tool it used last (``mcp_last_agents``, one row a person). Shown with its
picture on the Activity page.

Revision ID: 0056
Revises: 0055
Create Date: 2026-11-15 09:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0056'
down_revision: str | None = '0055'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('user_notifications', sa.Column('agent', sa.String(length=255), nullable=True))
    op.create_table(
        'mcp_last_agents',
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('agent', sa.String(length=255), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('user_id'),
    )


def downgrade() -> None:
    op.drop_table('mcp_last_agents')
    op.drop_column('user_notifications', 'agent')
