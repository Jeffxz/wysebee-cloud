"""Projects become Workspaces: ``user_workspaces`` and ``workspace_assistants``

The owner's call (2026-11-17): the website's Projects are now **Workspaces**, in name and in
the database. Existing projects are not kept: ``project_assistants`` and ``user_projects`` are
dropped and ``user_workspaces`` (apps/cloud/workspaces.py) and ``workspace_assistants``
(apps/cloud/workspace_assistant.py) made empty in their place. A workspace's files are kept
under its id from the start, so the pre-0064 ``folder`` column is gone. (Old projects' files
stay in the old ``user-projects`` store, untouched; a workspace's are in ``user-workspaces``.)

The downgrade drops the workspaces and makes the two old tables again, empty.

Revision ID: 0073
Revises: 0072
Create Date: 2026-11-19 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0073'
down_revision: str | None = '0072'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _stamps() -> list[sa.Column]:
    return [
        sa.Column('created_by', sa.String(length=255), nullable=False),
        sa.Column('updated_by', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    ]


def _assistants(table: str, key: str, parent: str) -> None:
    op.create_table(
        table,
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column(key, sa.UUID(as_uuid=False), nullable=True),
        sa.Column('skill_id', sa.UUID(as_uuid=False), nullable=True),
        sa.Column('opened_by', sa.String(length=8), server_default=sa.text("'person'"), nullable=False),
        sa.Column('path', sa.String(length=400), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('revision', sa.BigInteger(), nullable=False),
        sa.Column('writer', sa.String(length=16), nullable=False),
        sa.Column('ai_client', sa.String(length=100), nullable=True),
        sa.Column('ai_seen_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('seen_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint([key], [f'{parent}.{key}'], name=f'{table}_{key}_fkey', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['skill_id'], ['user_skills.skill_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
        sa.CheckConstraint(f'num_nonnulls({key}, skill_id) = 1', name=f'ck_{table}_one_place'),
    )


def upgrade() -> None:
    op.drop_table('project_assistants')
    op.drop_table('user_projects')
    op.create_table(
        'user_workspaces',
        sa.Column('workspace_id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('name', sa.String(length=80), nullable=False),
        sa.Column('resource_url', sa.Text(), nullable=False),
        *_stamps(),
        sa.PrimaryKeyConstraint('workspace_id'),
    )
    op.create_index('ix_user_workspaces_user_id', 'user_workspaces', ['user_id'], unique=False)
    op.create_index('ix_user_workspaces_user_name', 'user_workspaces', ['user_id', sa.text('lower(name)')], unique=True)
    _assistants('workspace_assistants', 'workspace_id', 'user_workspaces')


def downgrade() -> None:
    op.drop_table('workspace_assistants')
    op.drop_table('user_workspaces')
    op.create_table(
        'user_projects',
        sa.Column('project_id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('name', sa.String(length=80), nullable=False),
        sa.Column('resource_url', sa.Text(), nullable=False),
        sa.Column('folder', sa.String(length=80), nullable=True),
        *_stamps(),
        sa.PrimaryKeyConstraint('project_id'),
    )
    op.create_index('ix_user_projects_user_id', 'user_projects', ['user_id'], unique=False)
    op.create_index('ix_user_projects_user_name', 'user_projects', ['user_id', sa.text('lower(name)')], unique=True)
    _assistants('project_assistants', 'project_id', 'user_projects')
