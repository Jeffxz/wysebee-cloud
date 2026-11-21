"""create project_assistants

Wysebee Assistant (apps/cloud/project_assistant.py): the person's AI app writing the page open
in their Projects editor. One row per person while it is on: the page, its text as the editor
holds it and a revision every write bumps.

Revision ID: 0053
Revises: 0052
Create Date: 2026-11-14 16:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0053'
down_revision: str | None = '0052'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'project_assistants',
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('project_id', sa.String(length=32), nullable=False),
        sa.Column('path', sa.String(length=400), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('revision', sa.BigInteger(), nullable=False),
        sa.Column('writer', sa.String(length=16), nullable=False),
        sa.Column('ai_client', sa.String(length=100), nullable=True),
        sa.Column('ai_seen_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('seen_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['user_projects.project_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )


def downgrade() -> None:
    op.drop_table('project_assistants')
