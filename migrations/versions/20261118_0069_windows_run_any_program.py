"""wysebee-windows may run any program the AI names

The owner's call (2026-11-16): an agent paired with **Wysebee Agent for Windows** may be given
**Run any program** — one tool, ``run_program``, with which the AI names the program and its
arguments itself, sent as the new op ``program_run`` ``{program, args}``. Wysebee Agent for
Windows runs it only while the person has turned on "Let Wysebee run any program on this PC"
in its window (off by default), and as it runs every program: an ``.exe`` or ``.com`` found
on its PATH or by full path, an argument list (never a shell, never a batch file), no input,
60 seconds, output cut.

So the type's row gains the op ``program_run`` (the cloud relays only ops a type lists) and
the tool kind ``any_program`` (only its agents may be given the tool). The Mac's type gains
neither: Wysebee Agent for Mac does not run it. Added once, left as an admin set it
otherwise; the downgrade takes both away again.

Revision ID: 0069
Revises: 0068
Create Date: 2026-11-18 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0069'
down_revision: str | None = '0068'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

WINDOWS = "wysebee-windows"
OP = "program_run"
TOOL_KIND = "any_program"


def upgrade() -> None:
    for column, item in (("ops", OP), ("tool_kinds", TOOL_KIND)):
        op.execute(
            sa.text(
                f"UPDATE agent_types SET {column} = {column} || jsonb_build_array(CAST(:item AS text)), updated_at = now() "
                f"WHERE key = :key AND NOT {column} ? :item"
            ).bindparams(key=WINDOWS, item=item)
        )


def downgrade() -> None:
    for column, item in (("ops", OP), ("tool_kinds", TOOL_KIND)):
        op.execute(sa.text(f"UPDATE agent_types SET {column} = {column} - CAST(:item AS text), updated_at = now() WHERE key = :key").bindparams(key=WINDOWS, item=item))
