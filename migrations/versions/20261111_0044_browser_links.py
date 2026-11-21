"""browser_links and browser_calls: the Wysebee Agent browser extension, paired with the cloud

A link is one paired extension (apps/cloud/browser_links.py): made with a pairing code,
claimed by the person who types it, driven through a queue of calls.

Revision ID: 0044
Revises: 0043
Create Date: 2026-11-11 22:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0044'
down_revision: str | None = '0043'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'browser_links',
        sa.Column('id', sa.String(length=32), nullable=False),
        sa.Column('user_id', sa.String(length=255), nullable=True),
        sa.Column('code', sa.String(length=8), nullable=True),
        sa.Column('code_expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('secret_hash', sa.String(length=64), nullable=False),
        sa.Column('name', sa.String(length=60), nullable=False),
        sa.Column('agent', sa.String(length=30), nullable=True),
        sa.Column('browser', sa.String(length=32), server_default=sa.text("''"), nullable=False),
        sa.Column('extension_version', sa.String(length=32), server_default=sa.text("''"), nullable=False),
        sa.Column('paused', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('refused', sa.String(length=32), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('claimed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_seen', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_browser_links_code', 'browser_links', ['code'], unique=True)
    op.create_index('ix_browser_links_user', 'browser_links', ['user_id'], unique=False)
    op.create_table(
        'browser_calls',
        sa.Column('id', sa.String(length=32), nullable=False),
        sa.Column('link_id', sa.String(length=32), nullable=False),
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('op', sa.String(length=64), nullable=False),
        sa.Column('args', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('ok', sa.Boolean(), nullable=True),
        sa.Column('result', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('timeout_seconds', sa.Float(), nullable=False),
        sa.Column('cancelled', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('claimed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['link_id'], ['browser_links.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_browser_calls_link_status', 'browser_calls', ['link_id', 'status', 'created_at'], unique=False)
    op.create_index('ix_browser_calls_user', 'browser_calls', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_table('browser_calls')
    op.drop_table('browser_links')
