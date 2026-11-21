"""delete tool, credential and database connection cloud items

Wysebee's agents and tasks work in the browser now: authored tools, the credentials
they used and database connections were removed from the desktop (its migration v11),
and this API accepts only agents, tasks and skills. Their rows here — live items and
tombstones alike — are deleted outright. No client reads those kinds any more, so no
tombstone is needed to tell one.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-19 12:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = '0006'
down_revision: str | None = '0005'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DELETE FROM cloud_configs WHERE kind IN ('tool', 'credential', 'database_connection')")


def downgrade() -> None:
    # What was deleted cannot be brought back.
    pass
