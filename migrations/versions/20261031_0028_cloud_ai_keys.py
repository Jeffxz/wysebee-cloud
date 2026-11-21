"""cloud_ai_keys: AI provider keys kept in Wysebee Cloud; remote_turns.error_code

The person's own AI provider keys entered on the website, for agents whose home is Wysebee
Cloud (apps/cloud/ai_keys.py). Envelope-encrypted: ``ciphertext`` is AES-256-GCM under a key
of its own, stored here only wrapped (``wrapped_key``) by the key-encryption key named by
``kek_id`` — an Azure Key Vault key in production — which is never in the database. A
desktop's keys never come here.

``remote_turns.error_code``: why a turn failed, for the page to show (``no_model``,
``no_cloud_key`` — a turn the cloud ran itself, for an agent living there).

Revision ID: 0028
Revises: 0027
Create Date: 2026-10-31 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0028'
down_revision: str | None = '0027'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
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
    op.add_column('remote_turns', sa.Column('error_code', sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column('remote_turns', 'error_code')
    op.drop_table('cloud_ai_keys')
