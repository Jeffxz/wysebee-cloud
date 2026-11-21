"""user_credit_limits: a per-person monthly limit (historical)

A row per person given a monthly limit of their own. Read by nothing since 2026-11-21: the
table stays for databases that have it.

Revision ID: 0033
Revises: 0032
Create Date: 2026-11-03 15:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0033'
down_revision: str | None = '0032'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'user_credit_limits',
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('monthly_limit', sa.BigInteger(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('user_id'),
    )


def downgrade() -> None:
    op.drop_table('user_credit_limits')
