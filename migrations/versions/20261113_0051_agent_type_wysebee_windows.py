"""agent type wysebee-windows

Registers **Wysebee Windows Agent** (``wysebee-windows``): Wysebee Agent for Windows
(``wysebee-agent-win``), the Windows build of Wysebee Agent for Mac. It speaks the Mac app's
protocol unchanged, so its row is the Mac type's but for its key, name and description: the
link held in ``mac_link`` (its links' legacy ``kind`` is ``osx``), the ops ``ping``,
``local_run``, ``skill_run`` and ``folder_call``, the tool kinds ``local``, ``folder``,
``sqlite`` and ``skill_scripts``. A fixed id, so every environment has the same.

A type is data (migration 0050): nothing else changes. A reconnect still needs the same key,
so an agent paired from a Mac is never reconnected from a Windows PC, nor the reverse.

Revision ID: 0051
Revises: 0050
Create Date: 2026-11-13 23:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = '0051'
down_revision: str | None = '0050'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

WINDOWS_ID = "6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c04"
WINDOWS = "wysebee-windows"
ROW = {
    "id": WINDOWS_ID, "key": WINDOWS, "name": "Wysebee Windows Agent",
    "description": "An agent that runs the programs, skill scripts and folder tools you allow on your Windows PC, through Wysebee Agent for Windows.",
    "link_field": "mac_link", "ops": ["ping", "local_run", "skill_run", "folder_call"],
    "tool_kinds": ["local", "folder", "sqlite", "skill_scripts"],
}


def upgrade() -> None:
    table = sa.table(
        "agent_types",
        sa.column("id", UUID(as_uuid=False)), sa.column("key", sa.Text()), sa.column("name", sa.Text()),
        sa.column("description", sa.Text()), sa.column("link_field", sa.Text()),
        sa.column("ops", JSONB()), sa.column("tool_kinds", JSONB()),
    )
    # An environment where an admin registered it by hand keeps that row.
    if op.get_bind().execute(sa.text("SELECT 1 FROM agent_types WHERE key = :k"), {"k": WINDOWS}).first() is None:
        op.bulk_insert(table, [ROW])


def downgrade() -> None:
    # Links of it name it (a foreign key): a downgrade with Windows PCs still paired fails
    # rather than leave them typeless. Unpair them first.
    op.execute(sa.text("DELETE FROM agent_types WHERE id = CAST(:i AS uuid)").bindparams(i=WINDOWS_ID))
