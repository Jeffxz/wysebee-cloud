"""user_credentials: the person's credentials, kept for all their Wysebee apps

A desktop's PostgreSQL passwords used to stay on the one computer; they follow the person now
(apps/cloud/credentials.py).

Revision ID: 0040
Revises: 0039
Create Date: 2026-11-11 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0040'
down_revision: str | None = '0039'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'user_credentials',
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('credential_id', sa.String(length=64), nullable=False),
        sa.Column('vendor', sa.String(length=64), nullable=False),
        sa.Column('name', sa.String(length=255), server_default=sa.text("''"), nullable=False),
        sa.Column('ciphertext', sa.LargeBinary(), nullable=False),
        sa.Column('nonce', sa.LargeBinary(), nullable=False),
        sa.Column('wrapped_key', sa.LargeBinary(), nullable=False),
        sa.Column('kek_id', sa.String(length=512), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('user_id', 'credential_id'),
    )


def downgrade() -> None:
    op.drop_table('user_credentials')
