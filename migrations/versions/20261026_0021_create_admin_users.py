"""admin_users

Who may sign in to Wysebee Admin (the wysebee-admin repository: a desktop app that reads and
changes this database directly). An email, an Argon2 password hash and whether the account
is a super user. Nothing in this service reads it; the admin app creates its first super
user with its own command (``wysebee-admin-cli set-password``).

Revision ID: 0021
Revises: 0020
Create Date: 2026-10-26 02:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0021'
down_revision: str | None = '0020'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'admin_users',
        sa.Column('email', sa.String(320), primary_key=True),
        sa.Column('password_hash', sa.Text(), nullable=False),
        sa.Column('is_super', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table('admin_users')
