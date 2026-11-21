"""agent type wysebee-linux

The owner's call (2026-11-18): registers **Wysebee Linux Agent** (``wysebee-linux``): Wysebee
Agent for Linux (``wysebee-agent-linux``), a command line and systemd service for Linux
desktops, servers and cloud VMs (Azure, AWS), built from the Mac app's core. It speaks the Mac
app's protocol (its ``docs/protocol.md``, "The owner's decision (2026-11-18): a Linux
machine's agent"), so its row is the Windows type's without the screen's — a server has none:
the link held in ``mac_link`` (its links' legacy ``kind`` is ``osx``), the ops ``ping``,
``local_run``, ``skill_run``, ``folder_call``, ``program_run``, ``dev_shell``, ``dev_job``,
``dev_file`` and ``android_dev``, the tool kinds ``local``, ``folder``, ``sqlite``,
``skill_scripts``, ``any_program``, ``developer`` and ``android_toolkit``. No screen, no
iPhone toolkit.

A fixed id, so every environment has the same. The protocol proposed ``…4a5c05``, which is the
Android type's (migration 0059), so it is ``…4a5c06``. A reconnect still needs the same key,
so an agent paired from Linux is never reconnected from a Mac or a PC, nor the reverse.

Revision ID: 0079
Revises: 0078
Create Date: 2026-11-21 09:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = '0079'
down_revision: str | None = '0078'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LINUX_ID = "6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c06"
LINUX = "wysebee-linux"
ROW = {
    "id": LINUX_ID, "key": LINUX, "name": "Wysebee Linux Agent",
    "description": "An agent that runs the programs, skill scripts, folder and developer tools you allow on your Linux machine or server, through Wysebee Agent for Linux.",
    "link_field": "mac_link",
    "ops": ["ping", "local_run", "skill_run", "folder_call", "program_run", "dev_shell", "dev_job", "dev_file", "android_dev"],
    "tool_kinds": ["local", "folder", "sqlite", "skill_scripts", "any_program", "developer", "android_toolkit"],
}


def upgrade() -> None:
    table = sa.table(
        "agent_types",
        sa.column("id", UUID(as_uuid=False)), sa.column("key", sa.Text()), sa.column("name", sa.Text()),
        sa.column("description", sa.Text()), sa.column("link_field", sa.Text()),
        sa.column("ops", JSONB()), sa.column("tool_kinds", JSONB()),
    )
    # An environment where an admin registered it by hand keeps that row.
    if op.get_bind().execute(sa.text("SELECT 1 FROM agent_types WHERE key = :k"), {"k": LINUX}).first() is None:
        op.bulk_insert(table, [ROW])


def downgrade() -> None:
    # Links of it name it (a foreign key): a downgrade with Linux machines still paired fails
    # rather than leave them typeless. Unpair them first.
    op.execute(sa.text("DELETE FROM agent_types WHERE id = CAST(:i AS uuid)").bindparams(i=LINUX_ID))
