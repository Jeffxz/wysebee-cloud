"""agent link offers: pairing by a QR code

The person's call (2026-11-17): a device may pair by scanning a QR code Wysebee shows, instead
of the person typing the code the device shows. Wysebee asks for an offer (``POST
/agent-links/offers``) and shows its token as a QR code; the device starts pairing with it
(``/start``'s ``offer``) and is claimed for that person at once. One use, ten minutes; only the
token's SHA-256 is kept (apps/cloud/browser_links.py).

Revision ID: 0078
Revises: 0077
Create Date: 2026-11-20 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0078'
down_revision: str | None = '0077'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_link_offers",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("user_id", sa.String(255), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("agent_name", sa.String(64), nullable=True),
        sa.Column("agent_label", sa.String(60), nullable=True),
    )
    op.create_index("ix_agent_link_offers_user_id", "agent_link_offers", ["user_id"])
    op.create_index("ix_agent_link_offers_token_hash", "agent_link_offers", ["token_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_agent_link_offers_token_hash", table_name="agent_link_offers")
    op.drop_index("ix_agent_link_offers_user_id", table_name="agent_link_offers")
    op.drop_table("agent_link_offers")
