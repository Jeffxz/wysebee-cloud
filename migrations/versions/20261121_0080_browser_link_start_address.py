"""browser link start address: a cap on the codes one address may hold

The owner's call (2026-11-18): ``/start`` needs no sign-in, and at most
``browser_link_pending_max`` links may wait for their code at once, for everyone. With only a
limit on starts a minute, a handful of addresses could keep that table full and stop every
device in the world from pairing. So a waiting link keeps the SHA-256 of the address that
started it (never the address itself; cleared once claimed), and one address may hold at most
``browser_link_pending_per_address`` codes at once (apps/cloud/browser_links.py).

Revision ID: 0080
Revises: 0079
Create Date: 2026-11-21 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0080'
down_revision: str | None = '0079'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("browser_links", sa.Column("start_address", sa.String(64), nullable=True))
    op.create_index("ix_browser_links_start_address", "browser_links", ["start_address"])


def downgrade() -> None:
    op.drop_index("ix_browser_links_start_address", table_name="browser_links")
    op.drop_column("browser_links", "start_address")
