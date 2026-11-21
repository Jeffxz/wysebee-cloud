"""skills are edited as folders: empty folders kept, and Wysebee Assistant on a skill's file

The website's Skills page edits a skill as a folder of files, as Projects does (apps/cloud/
skill_folders.py). ``user_skills.folders`` keeps the folders the person made that hold no file
yet (a folder with files is in their paths). ``project_assistants`` — the page open in the
person's editor, which Wysebee Assistant writes — may now be a skill's file: ``project_id``
becomes optional beside a new ``skill_id`` (exactly one is set), and ``opened_by`` says
whether the person opened it or their AI app did (``create_skill``), so an editor open on
another page goes to the new skill.

The downgrade drops them (and an open skill file).

Revision ID: 0067
Revises: 0066
Create Date: 2026-11-17 09:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = '0067'
down_revision: str | None = '0066'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ONE = "ck_project_assistants_one_place"


def upgrade() -> None:
    op.add_column("user_skills", sa.Column("folders", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")))
    op.alter_column("project_assistants", "project_id", nullable=True)
    op.add_column("project_assistants", sa.Column(
        "skill_id", UUID(as_uuid=False), sa.ForeignKey("user_skills.skill_id", ondelete="CASCADE"), nullable=True,
    ))
    op.add_column("project_assistants", sa.Column("opened_by", sa.String(8), nullable=False, server_default=sa.text("'person'")))
    op.create_check_constraint(ONE, "project_assistants", "num_nonnulls(project_id, skill_id) = 1")


def downgrade() -> None:
    op.drop_constraint(ONE, "project_assistants", type_="check")
    op.execute("DELETE FROM project_assistants WHERE project_id IS NULL")
    op.drop_column("project_assistants", "opened_by")
    op.drop_column("project_assistants", "skill_id")
    op.alter_column("project_assistants", "project_id", nullable=False)
    op.drop_column("user_skills", "folders")
