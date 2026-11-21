"""content_reports: AI answers people reported from inside an app

Google Play asks apps that generate content with AI to take such reports in the app
(apps/cloud/content_reports.py).

Revision ID: 0038
Revises: 0037
Create Date: 2026-11-06 09:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0038'
down_revision: str | None = '0037'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'content_reports',
        sa.Column('id', sa.String(length=32), nullable=False),
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('reason', sa.String(length=16), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('note', sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column('conversation', sa.String(length=128), server_default=sa.text("''"), nullable=False),
        sa.Column('message_id', sa.String(length=128), server_default=sa.text("''"), nullable=False),
        sa.Column('agent', sa.String(length=128), server_default=sa.text("''"), nullable=False),
        sa.Column('surface', sa.String(length=32), server_default=sa.text("''"), nullable=False),
        sa.Column('app_version', sa.String(length=32), server_default=sa.text("''"), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_content_reports_created', 'content_reports', ['created_at'])
    op.create_index('ix_content_reports_user', 'content_reports', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_content_reports_user', table_name='content_reports')
    op.drop_index('ix_content_reports_created', table_name='content_reports')
    op.drop_table('content_reports')
