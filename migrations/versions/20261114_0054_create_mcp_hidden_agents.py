"""create mcp_hidden_agents

The agents a person turned off for AI apps in their Connect AI app tab
(apps/cloud/agent_mcp.py): Wysebee Assistant neither lists them nor runs their tools.

Revision ID: 0054
Revises: 0053
Create Date: 2026-11-14 20:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0054'
down_revision: str | None = '0053'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'mcp_hidden_agents',
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('agent', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('user_id', 'agent'),
    )


def downgrade() -> None:
    op.drop_table('mcp_hidden_agents')
