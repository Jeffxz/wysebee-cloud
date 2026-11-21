"""Skills' files move to the user-skills container; saved skills are not kept

The owner's call (2026-11-17): the skill file store's Azure container is now ``user-skills``
(and the file store's folder ``./data/user-skills``), named like ``user-assets`` and
``user-workspaces``. Azure cannot rename a container, and the files are not copied over, so
every saved skill would point at files that are not there: they are deleted — ``user_skills``
(with them, by cascade, ``agent_skills`` and an open skill page in ``workspace_assistants``)
and every ``cloud_skill_files`` row. The old ``skill-files`` container is left untouched, to be
removed by hand.

The downgrade cannot bring them back: it changes nothing.

Revision ID: 0074
Revises: 0073
Create Date: 2026-11-19 20:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = '0074'
down_revision: str | None = '0073'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DELETE FROM user_skills")
    op.execute("DELETE FROM cloud_skill_files")


def downgrade() -> None:
    pass
