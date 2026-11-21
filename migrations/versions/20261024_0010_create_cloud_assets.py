"""create cloud_assets

A per-person asset store (apps/cloud/assets.py): the rows say what each person stored
— content type, size, when — and the bytes are kept by the asset store, a file or an
Azure blob named <sha256(sub)[:32]>/<asset id>. Wysebee Desktop's avatar image is the
first thing stored here.

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-24 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0010'
down_revision: str | None = '0009'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('cloud_assets',
    sa.Column('user_id', sa.String(length=255), nullable=False),
    sa.Column('asset_id', sa.String(length=64), nullable=False),
    sa.Column('content_type', sa.String(length=64), nullable=False),
    sa.Column('size', sa.BigInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('user_id', 'asset_id')
    )


def downgrade() -> None:
    # The rows go; the stored files or blobs are left where they are.
    op.drop_table('cloud_assets')
