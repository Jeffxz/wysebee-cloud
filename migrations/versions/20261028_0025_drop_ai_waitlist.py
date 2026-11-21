"""drop ai_waitlist and users.ai_enabled

Who could use Wysebee AI (``users.ai_enabled``, 0019) and who waited for it
(``ai_waitlist``, 0016) gated ``POST /api/v1/chat``, which went with 0024: Wysebee Desktop
chats with the AI provider key each person keeps on their own computer. The people stay in
``users`` (their email, name and profile). The downgrade makes both again, empty — the
column false for everyone.

Revision ID: 0025
Revises: 0024
Create Date: 2026-10-28 13:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0025'
down_revision: str | None = '0024'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table('ai_waitlist')
    op.drop_column('users', 'ai_enabled')


def downgrade() -> None:
    op.add_column('users', sa.Column('ai_enabled', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.create_table(
        'ai_waitlist',
        sa.Column('user_id', sa.String(255), primary_key=True),
        sa.Column('email', sa.String(320), nullable=False, server_default=''),
        sa.Column('name', sa.String(200), nullable=False, server_default=''),
        sa.Column('source', sa.String(16), nullable=False, server_default='settings'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
