"""credit_purchases: payments recorded from a payment provider's webhook

One row per payment, written by the hosted service's extension (apps/cloud/extensions.py),
which owns this table since 2026-11-21: who paid (an Auth0 ``sub``), the month, the amount (in
the currency's smallest unit) and its status. Not used by this repository's own code.

Revision ID: 0035
Revises: 0034
Create Date: 2026-11-04 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0035'
down_revision: str | None = '0034'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'credit_purchases',
        sa.Column('id', sa.String(length=255), nullable=False),
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('month', sa.String(length=7), nullable=False),
        sa.Column('credits', sa.BigInteger(), nullable=False),
        sa.Column('amount', sa.BigInteger(), nullable=False),
        sa.Column('currency', sa.String(length=3), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_credit_purchases_user_id', 'credit_purchases', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_credit_purchases_user_id', table_name='credit_purchases')
    op.drop_table('credit_purchases')
