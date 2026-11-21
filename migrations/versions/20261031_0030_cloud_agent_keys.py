"""cloud_agent_keys: API keys for agents living in Wysebee Cloud

Each row one key the person made for one of their agents whose home is the cloud
(apps/cloud/agent_api.py): whoever holds it may chat with that agent at
``POST /api/v1/agents/{agent}/chat``. Only the SHA-256 of the key's secret is kept.

Revision ID: 0030
Revises: 0029
Create Date: 2026-10-31 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0030'
down_revision: str | None = '0029'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'cloud_agent_keys',
        sa.Column('id', sa.String(length=32), nullable=False),
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('agent', sa.String(length=255), nullable=False),
        sa.Column('label', sa.String(length=100), nullable=False),
        sa.Column('secret_hash', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_cloud_agent_keys_user_id', 'cloud_agent_keys', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_cloud_agent_keys_user_id', table_name='cloud_agent_keys')
    op.drop_table('cloud_agent_keys')
