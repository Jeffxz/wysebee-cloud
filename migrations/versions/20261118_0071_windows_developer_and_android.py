"""wysebee-windows may work as a developer on the PC, and use its Android phones

The owner's call (2026-11-16): an agent paired with **Wysebee Agent for Windows** may be given

- **Developer access** (``developer_access`` in its settings): a shell, background jobs and
  files anywhere on the PC — the ops ``dev_shell``, ``dev_job`` and ``dev_file`` — so an AI
  works on the PC as a coding assistant running there would; and
- **the Android Development Toolkit** (``android_toolkit``): Wysebee Desktop's adb tools for
  the phones plugged in to the PC — the op ``android_dev``.

Wysebee Agent for Windows answers them only while the person has turned on "Let Wysebee use
this PC as a developer" and "Let Wysebee use Android phones on this PC" in its window (each
off by default). So the type's row gains the four ops and the tool kinds ``developer`` and
``android_toolkit``; the Mac's type gains none. Added once; the downgrade takes them away.

Revision ID: 0071
Revises: 0070
Create Date: 2026-11-18 14:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0071'
down_revision: str | None = '0070'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

WINDOWS = "wysebee-windows"
ADDED = (("ops", "dev_shell"), ("ops", "dev_job"), ("ops", "dev_file"), ("ops", "android_dev"), ("tool_kinds", "developer"), ("tool_kinds", "android_toolkit"))


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
