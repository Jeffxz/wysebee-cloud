"""wysebee-osx may do what wysebee-windows does, and use iPhones and simulators

The owner's call (2026-11-17): an agent paired with **Wysebee Agent for Mac** may be given
what an agent paired with Wysebee Agent for Windows may since 2026-11-16 (migrations
0069-0071), exactly as there —

- **Run any program** (``run_any_program``): the op ``program_run``, the tool kind
  ``any_program``;
- **Screen control** (``screen_control``): the ops ``screen_screenshot`` and
  ``screen_action``, the tool kind ``screen``;
- **Developer access** (``developer_access``): the ops ``dev_shell``, ``dev_job`` and
  ``dev_file``, the tool kind ``developer``;
- **the Android Development Toolkit** (``android_toolkit``): the op ``android_dev``, the tool
  kind ``android_toolkit`` —

and a new one, the Mac's alone: **the iPhone Development Toolkit** (``ios_toolkit``): the
Mac's iOS simulators and paired iPhones through Xcode, the op ``ios_dev``, the tool kind
``ios_toolkit`` (apps/cloud/agent_chat/ios_dev.py). The Windows type gains neither: there is
no Xcode on Windows.

Wysebee Agent for Mac answers each only while the person has turned on its switch there (each
off by default). So the Mac type's row gains the eight ops and the five tool kinds. Added
once, left as an admin set it otherwise; the downgrade takes them away again.

Revision ID: 0072
Revises: 0071
Create Date: 2026-11-19 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0072'
down_revision: str | None = '0071'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MAC = "wysebee-osx"
ADDED = (
    ("ops", "program_run"), ("ops", "screen_screenshot"), ("ops", "screen_action"), ("ops", "dev_shell"), ("ops", "dev_job"), ("ops", "dev_file"), ("ops", "android_dev"), ("ops", "ios_dev"),
    ("tool_kinds", "any_program"), ("tool_kinds", "screen"), ("tool_kinds", "developer"), ("tool_kinds", "android_toolkit"), ("tool_kinds", "ios_toolkit"),
)


def upgrade() -> None:
    for column, item in ADDED:
        op.execute(
            sa.text(
                f"UPDATE agent_types SET {column} = {column} || jsonb_build_array(CAST(:item AS text)), updated_at = now() "
                f"WHERE key = :key AND NOT {column} ? :item"
            ).bindparams(key=MAC, item=item)
        )


def downgrade() -> None:
    for column, item in ADDED:
        op.execute(sa.text(f"UPDATE agent_types SET {column} = {column} - CAST(:item AS text), updated_at = now() WHERE key = :key").bindparams(key=MAC, item=item))
