"""create user_notifications

Notifications the person's AI app sends through Wysebee Assistant (``send_notification``,
apps/cloud/notifications.py), shown on the website's Activity page.

Revision ID: 0055
Revises: 0054
Create Date: 2026-11-14 23:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0055'
down_revision: str | None = '0054'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'user_notifications',
        sa.Column('id', sa.String(length=32), nullable=False),
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_user_notifications_user', 'user_notifications', ['user_id', 'created_at'])


def downgrade() -> None:
    op.drop_index('ix_user_notifications_user', table_name='user_notifications')
    op.drop_table('user_notifications')
