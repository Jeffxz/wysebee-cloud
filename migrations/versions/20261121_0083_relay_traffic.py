"""relay_traffic: each person's relay traffic, per calendar month

One row per person and month (UTC, ``YYYY-MM``): the bytes that passed through Wysebee Cloud
between their AI app and their devices (calls' arguments and results, skill files,
recordings — apps/cloud/traffic.py). A new month is a new row: the count starts over.

Revision ID: 0083
Revises: 0082
Create Date: 2026-11-21 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0083'
down_revision: str | None = '0082'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'relay_traffic',
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('month', sa.String(length=7), nullable=False),
        sa.Column('bytes', sa.BigInteger(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('user_id', 'month'),
    )


def downgrade() -> None:
    op.drop_table('relay_traffic')
