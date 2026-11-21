"""delete skill cloud items

Skills and skill categories were removed from Wysebee Desktop (its migration v18), and
this API accepts only agents, tasks and Wysebee's profile. Skill rows here — live items
and tombstones alike — are deleted outright. No client reads that kind any more, so no
tombstone is needed to tell one. A `skills` list left inside an agent's, task's or
profile's `data` is inert: the desktop ignores it and drops it on its next save.

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-24 12:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = '0009'
down_revision: str | None = '0008'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DELETE FROM cloud_configs WHERE kind = 'skill'")


def downgrade() -> None:
    # What was deleted cannot be brought back.
    pass
