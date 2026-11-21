"""ai_waitlist.ai_enabled

The first people on the waitlist may use Wysebee AI (``WYSEBEE_AI_WAITLIST_CAP``);
``ai_enabled`` false turns one of them off (apps/cloud/waitlist.py).

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-25 22:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0017'
down_revision: str | None = '0016'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('ai_waitlist', sa.Column('ai_enabled', sa.Boolean(), nullable=False, server_default=sa.text('true')))
    op.create_index('ix_ai_waitlist_order', 'ai_waitlist', ['created_at', 'user_id'])


def downgrade() -> None:
    op.drop_index('ix_ai_waitlist_order', table_name='ai_waitlist')
    op.drop_column('ai_waitlist', 'ai_enabled')
