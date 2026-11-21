"""cloud_snowflake: the Snowflake connections of agents living in Wysebee Cloud

Like cloud_postgres: the connection by the agent's name and its own, its access token or
private key envelope-encrypted (apps/cloud/cloud_snowflake.py). A paid plan's.

Revision ID: 0042
Revises: 0041
Create Date: 2026-11-11 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0042'
down_revision: str | None = '0041'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'cloud_snowflake',
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('agent', sa.String(length=255), nullable=False),
        sa.Column('name', sa.String(length=30), nullable=False),
        sa.Column('description', sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column('account', sa.String(length=100), nullable=False),
        sa.Column('database', sa.String(length=255), nullable=False),
        sa.Column('warehouse', sa.String(length=255), server_default=sa.text("''"), nullable=False),
        sa.Column('schema_name', sa.String(length=255), server_default=sa.text("''"), nullable=False),
        sa.Column('role', sa.String(length=255), server_default=sa.text("''"), nullable=False),
        sa.Column('db_user', sa.String(length=255), server_default=sa.text("''"), nullable=False),
        sa.Column('auth', sa.String(length=16), nullable=False),
        sa.Column('changes', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('ciphertext', sa.LargeBinary(), nullable=True),
        sa.Column('nonce', sa.LargeBinary(), nullable=True),
        sa.Column('wrapped_key', sa.LargeBinary(), nullable=True),
        sa.Column('kek_id', sa.String(length=512), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('user_id', 'agent', 'name'),
    )


def downgrade() -> None:
    op.drop_table('cloud_snowflake')
