"""ai_turn_counts: each person's AI turns, per calendar month

One row per person and month (UTC, ``YYYY-MM``): how many model calls Wysebee Cloud answered
for them that month, from Wysebee Desktop, Wysebee for Android, the website and the agents'
API together (apps/cloud/ai_turns.py). A new month is a new row: the count starts over.

Revision ID: 0032
Revises: 0031
Create Date: 2026-11-03 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0032'
down_revision: str | None = '0031'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'ai_turn_counts',
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('month', sa.String(length=7), nullable=False),
        sa.Column('count', sa.BigInteger(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('user_id', 'month'),
    )


def downgrade() -> None:
    op.drop_table('ai_turn_counts')
