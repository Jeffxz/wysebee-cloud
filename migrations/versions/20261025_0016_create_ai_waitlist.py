"""ai_waitlist

The people waiting for Wysebee AI (apps/cloud/waitlist.py): who, their email and name as
their app gave them, and where they joined from.

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-25 20:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0016'
down_revision: str | None = '0015'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'ai_waitlist',
        sa.Column('user_id', sa.String(255), primary_key=True),
        sa.Column('email', sa.String(320), nullable=False, server_default=''),
        sa.Column('name', sa.String(200), nullable=False, server_default=''),
        sa.Column('source', sa.String(16), nullable=False, server_default='settings'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('ai_waitlist')
