"""wysebee-windows may show its screen and work its mouse and keyboard

The owner's call (2026-11-16): an agent paired with **Wysebee Agent for Windows** may be given
**Screen control** (``screen_control`` in its settings): two tools, ``screen_screenshot`` and
``screen_action``, sent as the ops of the same names. Wysebee Agent for Windows answers them
only while the person has turned on "Let Wysebee see and control this PC's screen" in its
window (off by default): a screenshot (a JPEG, the pointer drawn in), or a move, click, drag,
scroll, typed text or keys at a place on the last screenshot, with a red ring shown on the
screen where the pointer acts. Made for trying an app on the PC from Wysebee.

So the type's row gains the ops ``screen_screenshot`` and ``screen_action`` and the tool kind
``screen``. The Mac's type gains none. Added once; the downgrade takes them away again.

Revision ID: 0070
Revises: 0069
Create Date: 2026-11-18 13:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0070'
down_revision: str | None = '0069'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

WINDOWS = "wysebee-windows"
ADDED = (("ops", "screen_screenshot"), ("ops", "screen_action"), ("tool_kinds", "screen"))


def upgrade() -> None:
    for column, item in ADDED:
        op.execute(
            sa.text(
                f"UPDATE agent_types SET {column} = {column} || jsonb_build_array(CAST(:item AS text)), updated_at = now() "
                f"WHERE key = :key AND NOT {column} ? :item"
            ).bindparams(key=WINDOWS, item=item)
        )


def downgrade() -> None:
    for column, item in ADDED:
        op.execute(sa.text(f"UPDATE agent_types SET {column} = {column} - CAST(:item AS text), updated_at = now() WHERE key = :key").bindparams(key=WINDOWS, item=item))
