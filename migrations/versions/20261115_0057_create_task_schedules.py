"""create task_schedules

When each of a person's scheduled tasks is next due (apps/cloud/task_runner.py): kept current
from the task's trigger whenever the task is saved or deleted, and claimed by the cloud's
scheduler (``running_since``) while it runs.

Revision ID: 0057
Revises: 0056
Create Date: 2026-11-15 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0057'
down_revision: str | None = '0056'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'task_schedules',
        sa.Column('user_id', sa.String(length=255), nullable=False),
        sa.Column('task_id', sa.String(length=255), nullable=False),
        sa.Column('next_run_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('running_since', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('user_id', 'task_id'),
    )
    op.create_index('ix_task_schedules_due', 'task_schedules', ['next_run_at'])


def downgrade() -> None:
    op.drop_index('ix_task_schedules_due', table_name='task_schedules')
    op.drop_table('task_schedules')
