"""cloud_postgres: PostgreSQL connections of agents living in Wysebee Cloud

Each row one connection of one agent whose home is the cloud (apps/cloud/cloud_postgres.py):
where the server is, how TLS is used, whether changes are allowed — and its password, when
it has one, envelope-encrypted as the AI keys are (migration 0028). A desktop's
connections are never here.

Revision ID: 0029
Revises: 0028
Create Date: 2026-10-31 16:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0029'
down_revision: str | None = '0028'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'cloud_postgres',
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('agent', sa.String(length=255), nullable=False),
        sa.Column('name', sa.String(length=30), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('host', sa.String(length=255), nullable=False),
        sa.Column('port', sa.Integer(), nullable=False),
        sa.Column('database', sa.String(length=63), nullable=False),
        sa.Column('db_user', sa.String(length=63), nullable=False),
        sa.Column('ssl', sa.String(length=16), nullable=False),
        sa.Column('changes', sa.Boolean(), nullable=False),
        sa.Column('ciphertext', sa.LargeBinary(), nullable=True),
        sa.Column('nonce', sa.LargeBinary(), nullable=True),
        sa.Column('wrapped_key', sa.LargeBinary(), nullable=True),
        sa.Column('kek_id', sa.String(length=512), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('user_id', 'agent', 'name'),
    )


def downgrade() -> None:
    op.drop_table('cloud_postgres')
