"""Drop cloud_ai_keys: the person's own AI keys are over

Bring-your-own-key ended on 2026-11-03: Wysebee Cloud holds the AI keys itself, in its
environment (``WYSEBEE_OPENAI_API_KEY``, ``WYSEBEE_ANTHROPIC_API_KEY``), and is the only thing
that calls an AI provider (``POST /api/v1/chat``, apps/cloud/chat.py). The keys people entered
on the website (0028) are deleted with their table. The downgrade makes the table again,
empty, as 0028 made it; ``remote_turns.error_code`` stays.

Revision ID: 0031
Revises: 0030
Create Date: 2026-11-03 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0031'
down_revision: str | None = '0030'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table('cloud_ai_keys')


def downgrade() -> None:
    op.create_table(
        'cloud_ai_keys',
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('provider', sa.String(length=32), nullable=False),
        sa.Column('ciphertext', sa.LargeBinary(), nullable=False),
        sa.Column('nonce', sa.LargeBinary(), nullable=False),
        sa.Column('wrapped_key', sa.LargeBinary(), nullable=False),
        sa.Column('kek_id', sa.String(length=512), nullable=False),
        sa.Column('base_url', sa.String(length=500), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('user_id', 'provider'),
    )
