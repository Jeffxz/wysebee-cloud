"""drop wysebee_ai

Wysebee AI no longer answers chats: Wysebee Desktop chats with the AI provider key each
person keeps on their own computer, so ``POST /api/v1/chat`` went, and with it the chat
model, its reasoning effort and the vendors' API keys this table held (0023). The
downgrade makes the table again, empty.

Revision ID: 0024
Revises: 0023
Create Date: 2026-10-28 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0024'
down_revision: str | None = '0023'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table('wysebee_ai')


def downgrade() -> None:
    op.create_table(
        'wysebee_ai',
        sa.Column('key', sa.String(64), primary_key=True),
        sa.Column('value', sa.Text(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
