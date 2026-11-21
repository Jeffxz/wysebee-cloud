"""drop mcp_last_agents

A notification is always sent by an agent now — every agent has ``send_notification``
(apps/cloud/notifications.py) — so the agent whose tool the AI app used last no longer needs
remembering.

Revision ID: 0058
Revises: 0057
Create Date: 2026-11-15 15:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0058'
down_revision: str | None = '0057'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table('mcp_last_agents')


def downgrade() -> None:
    op.create_table(
        'mcp_last_agents',
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('agent', sa.String(length=255), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('user_id'),
    )
