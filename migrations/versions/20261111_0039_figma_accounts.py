"""figma_accounts, figma_oauth_states: the person's sign-in to Figma

Wysebee's Figma tool calls Figma's REST API as the person; the code exchange, the refresh and
the tokens are the cloud's (apps/cloud/figma.py).

Revision ID: 0039
Revises: 0038
Create Date: 2026-11-11 09:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0039'
down_revision: str | None = '0038'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'figma_accounts',
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('figma_user_id', sa.String(length=255), server_default=sa.text("''"), nullable=False),
        sa.Column('handle', sa.String(length=255), server_default=sa.text("''"), nullable=False),
        sa.Column('email', sa.String(length=255), server_default=sa.text("''"), nullable=False),
        sa.Column('scopes', sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ciphertext', sa.LargeBinary(), nullable=False),
        sa.Column('nonce', sa.LargeBinary(), nullable=False),
        sa.Column('wrapped_key', sa.LargeBinary(), nullable=False),
        sa.Column('kek_id', sa.String(length=512), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('user_id'),
    )
    op.create_table(
        'figma_oauth_states',
        sa.Column('state', sa.String(length=64), nullable=False),
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('verifier', sa.String(length=128), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('state'),
    )
    op.create_index('ix_figma_oauth_states_user_id', 'figma_oauth_states', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_figma_oauth_states_user_id', table_name='figma_oauth_states')
    op.drop_table('figma_oauth_states')
    op.drop_table('figma_accounts')
