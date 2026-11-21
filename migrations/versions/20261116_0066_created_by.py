"""created_by and updated_by: who made and last changed each agent, tool, skill, project and task

Before things can be shared (an editor changing what another person owns), each of
``user_agents``, ``user_tools``, ``user_skills``, ``user_projects`` and ``user_tasks`` records
who made it and who changed it last, as user ids (apps/cloud/people.py). Until now only the
owner could do either, so both are its ``user_id``. ``user_tasks.creator`` — an email, always
the owner's — goes: ``created_by`` says it.

The downgrade drops them and puts ``creator`` back from the creator's ``users`` row.

Revision ID: 0066
Revises: 0065
Create Date: 2026-11-16 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0066'
down_revision: str | None = '0065'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("user_agents", "user_tools", "user_skills", "user_projects", "user_tasks")


def upgrade() -> None:
    for table in TABLES:
        for column in ("created_by", "updated_by"):
            op.add_column(table, sa.Column(column, sa.String(255), nullable=True))
            op.execute(f"UPDATE {table} SET {column} = user_id")
            op.alter_column(table, column, nullable=False)
    op.drop_column("user_tasks", "creator")


def downgrade() -> None:
    op.add_column("user_tasks", sa.Column("creator", sa.String(320), nullable=True))
    op.execute("UPDATE user_tasks t SET creator = NULLIF(u.email, '') FROM users u WHERE u.user_id = t.created_by")
    for table in TABLES:
        op.drop_column(table, "updated_by")
        op.drop_column(table, "created_by")
