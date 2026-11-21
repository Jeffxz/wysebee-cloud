"""wysebee-browser-chrome takes browser_mock

The Wysebee Agent extension gained ``browser_mock`` (2026-11-19): fake network responses on
a tab through the Chrome DevTools Fetch domain — answer a request with a fake status, fail
it as the network would, or hold it back — so an agent testing a web app it is building can
see how the app handles errors. A web development tool (``devtools`` tool kind, which the
type already has); the extension asks the person every time unless the site is set to
"Allow everything".

The cloud relays only ops a type lists, so the Chrome type's row gains the op. Added once,
left as an admin set it otherwise; the downgrade takes it away again.

Revision ID: 0081
Revises: 0080
Create Date: 2026-11-21 13:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0081'
down_revision: str | None = '0080'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CHROME = "wysebee-browser-chrome"
OP = "browser_mock"


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE agent_types SET ops = ops || jsonb_build_array(CAST(:item AS text)), updated_at = now() "
            "WHERE key = :key AND NOT ops ? :item"
        ).bindparams(key=CHROME, item=OP)
    )


def downgrade() -> None:
    op.execute(sa.text("UPDATE agent_types SET ops = ops - CAST(:item AS text), updated_at = now() WHERE key = :key").bindparams(key=CHROME, item=OP))
