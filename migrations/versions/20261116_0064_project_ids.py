"""projects: a UUID id, and files kept under it so a project can be renamed

As skills, tools and agents: ``user_projects.project_id`` (and ``project_assistants``'s link to
it) becomes a UUID column (it was a uuid4 hex). A project's files were kept in the project
store under its name, ``<user id>/<name>/…``; from here they are kept under its id, so a
rename moves nothing. A migration cannot reach the store, so ``folder`` says where a project's
files still are — its name, for every project made before — and the cloud moves them itself,
one project at a time (apps/cloud/projects.py ``move_folders``), clearing it. A new project
has none.

The downgrade turns the ids back into hex. It cannot move files back: it refuses while any
project's files are under its id.

Revision ID: 0064
Revises: 0063
Create Date: 2026-11-16 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0064'
down_revision: str | None = '0063'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FK = "project_assistants_project_id_fkey"


def upgrade() -> None:
    op.drop_constraint(FK, "project_assistants", type_="foreignkey")
    op.execute("ALTER TABLE user_projects ALTER COLUMN project_id TYPE uuid USING project_id::uuid")
    op.execute("ALTER TABLE project_assistants ALTER COLUMN project_id TYPE uuid USING project_id::uuid")
    op.create_foreign_key(FK, "project_assistants", "user_projects", ["project_id"], ["project_id"], ondelete="CASCADE")
    op.add_column("user_projects", sa.Column("folder", sa.String(80), nullable=True))
    op.execute("UPDATE user_projects SET folder = name")


def downgrade() -> None:
    moved = op.get_bind().execute(sa.text("SELECT count(*) FROM user_projects WHERE folder IS NULL")).scalar_one()
    if moved:
        raise RuntimeError(f"{moved} project(s) keep their files under their id now; 0063 can only find them by name. Not downgraded.")
    op.drop_column("user_projects", "folder")
    op.drop_constraint(FK, "project_assistants", type_="foreignkey")
    op.execute("ALTER TABLE user_projects ALTER COLUMN project_id TYPE varchar(32) USING replace(project_id::text, '-', '')")
    op.execute("ALTER TABLE project_assistants ALTER COLUMN project_id TYPE varchar(32) USING replace(project_id::text, '-', '')")
    op.create_foreign_key(FK, "project_assistants", "user_projects", ["project_id"], ["project_id"], ondelete="CASCADE")
