"""create user_projects

A person's projects (apps/cloud/projects.py): one row each — its id, its name (the folder
``<user id>/<name>/`` in the ``user-projects`` container) and the folder's URL. The files are
not rows: the store's listing is the folder structure.

Revision ID: 0052
Revises: 0051
Create Date: 2026-11-14 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0052'
down_revision: str | None = '0051'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'user_projects',
        sa.Column('project_id', sa.String(length=32), nullable=False),
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('name', sa.String(length=80), nullable=False),
        sa.Column('resource_url', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('project_id'),
    )
    op.create_index('ix_user_projects_user_id', 'user_projects', ['user_id'], unique=False)
    op.create_index('ix_user_projects_user_name', 'user_projects', ['user_id', sa.text('lower(name)')], unique=True)


def downgrade() -> None:
    op.drop_table('user_projects')
