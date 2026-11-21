"""cloud_skill_files: the files of the person's Wysebee Desktop skills

Each skill is a cloud item of kind ``skill`` (no change to ``cloud_configs``: its kind is a
plain string); its files are content-addressed rows here, their bytes in the skill file
store (Azure Blob Storage's ``skill-files`` container in production). The downgrade drops
the table, not the bytes.

Revision ID: 0027
Revises: 0026
Create Date: 2026-10-28 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0027'
down_revision: str | None = '0026'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'cloud_skill_files',
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('file_id', sa.String(length=64), nullable=False),
        sa.Column('size', sa.BigInteger(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('user_id', 'file_id'),
    )


def downgrade() -> None:
    op.drop_table('cloud_skill_files')
