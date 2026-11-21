"""users; ai_waitlist without the cap

A table of the people using Wysebee (apps/cloud/users.py): their email and name, and
``ai_enabled`` — who may use Wysebee AI, turned on by hand. It replaces letting in the first
WYSEBEE_AI_WAITLIST_CAP on the waitlist, so ``ai_waitlist.ai_enabled`` (0017) goes. Everyone
on the waitlist gets a row, turned off.

Revision ID: 0019
Revises: 0018
Create Date: 2026-10-26 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0019'
down_revision: str | None = '0018'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'users',
        sa.Column('user_id', sa.String(255), primary_key=True),
        sa.Column('email', sa.String(320), nullable=False, server_default=''),
        sa.Column('name', sa.String(200), nullable=False, server_default=''),
        sa.Column('ai_enabled', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_users_email', 'users', [sa.text('lower(email)')])
    op.execute("INSERT INTO users (user_id, email, name, created_at, updated_at) SELECT user_id, email, name, created_at, updated_at FROM ai_waitlist")
    op.drop_index('ix_ai_waitlist_order', table_name='ai_waitlist')
    op.drop_column('ai_waitlist', 'ai_enabled')


def downgrade() -> None:
    op.add_column('ai_waitlist', sa.Column('ai_enabled', sa.Boolean(), nullable=False, server_default=sa.text('true')))
    op.create_index('ix_ai_waitlist_order', 'ai_waitlist', ['created_at', 'user_id'])
    op.drop_index('ix_users_email', table_name='users')
    op.drop_table('users')
