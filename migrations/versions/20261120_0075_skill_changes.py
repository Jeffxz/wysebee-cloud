"""Changes to a skill proposed by the person's AI app, waiting for the person

The person's call (2026-11-17, "AI apps propose, the person approves"): Wysebee Assistant's
``write_skill_file`` and ``add_skill_folder`` no longer save into a skill. Each keeps a
``skill_changes`` row — a file's whole text, or a folder — which the person applies or
discards on the skill's page (apps/cloud/skill_changes.py). One per skill and path: a later
proposal for the same path replaces it. Deleted with the skill.

Revision ID: 0075
Revises: 0074
Create Date: 2026-11-20 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = '0075'
down_revision: str | None = '0074'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "skill_changes",
        sa.Column("change_id", UUID(as_uuid=False), primary_key=True),
        sa.Column("user_id", sa.String(255), nullable=False),
        sa.Column("skill_id", UUID(as_uuid=False), sa.ForeignKey("user_skills.skill_id", ondelete="CASCADE"), nullable=False),
        sa.Column("path", sa.String(1024), nullable=False),
        sa.Column("folder", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_skill_changes_skill_path", "skill_changes", ["skill_id", "path"], unique=True)
    op.create_index("ix_skill_changes_user_id", "skill_changes", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_skill_changes_user_id", table_name="skill_changes")
    op.drop_index("ix_skill_changes_skill_path", table_name="skill_changes")
    op.drop_table("skill_changes")
