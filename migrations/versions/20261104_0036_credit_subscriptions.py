"""credit_subscriptions: subscriptions recorded from a payment provider's webhook

``credit_subscriptions`` holds each person's subscription — its status, its plan and when its
period ends — and ``credit_purchases`` gains ``subscription_id``, its ``user_id`` nullable
until the subscription is tied to its person. Owned by the hosted service's extension
(apps/cloud/extensions.py) since 2026-11-21; not used by this repository's own code.

Revision ID: 0036
Revises: 0035
Create Date: 2026-11-04 14:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0036'
down_revision: str | None = '0035'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'credit_subscriptions',
        sa.Column('id', sa.String(length=255), nullable=False),
        sa.Column('user_id', sa.String(length=255), nullable=True),
        sa.Column('customer_id', sa.String(length=255), nullable=True),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('plan', sa.String(length=16), nullable=True),
        sa.Column('credits', sa.BigInteger(), nullable=False),
        sa.Column('cancel_at_period_end', sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column('current_period_end', sa.DateTime(timezone=True), nullable=True),
        sa.Column('event_at', sa.BigInteger(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_credit_subscriptions_user_id', 'credit_subscriptions', ['user_id'])
    op.add_column('credit_purchases', sa.Column('subscription_id', sa.String(length=255), nullable=True))
    op.create_index('ix_credit_purchases_subscription_id', 'credit_purchases', ['subscription_id'])
    op.alter_column('credit_purchases', 'user_id', existing_type=sa.String(length=255), nullable=True)


def downgrade() -> None:
    op.execute("DELETE FROM credit_purchases WHERE user_id IS NULL")
    op.alter_column('credit_purchases', 'user_id', existing_type=sa.String(length=255), nullable=False)
    op.drop_index('ix_credit_purchases_subscription_id', table_name='credit_purchases')
    op.drop_column('credit_purchases', 'subscription_id')
    op.drop_index('ix_credit_subscriptions_user_id', table_name='credit_subscriptions')
    op.drop_table('credit_subscriptions')
