"""desktops' AI providers, and model calls on the turns queue

Each desktop reports the AI providers configured on it (``user_desktops.ai``: provider ids
and model names only, never a key), so the person's other desktops and the website know
which one can answer for a model. A desktop with no key for an agent's model sends each
model round to that desktop as a turn of ``kind`` ``model`` (``remote_turns.kind``); the
key never leaves the desktop that holds it. The downgrade drops both.

Revision ID: 0026
Revises: 0025
Create Date: 2026-10-28 15:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0026'
down_revision: str | None = '0025'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('user_desktops', sa.Column('ai', postgresql.JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=False))
    op.add_column('remote_turns', sa.Column('kind', sa.String(length=16), server_default=sa.text("'turn'"), nullable=False))


def downgrade() -> None:
    op.drop_column('remote_turns', 'kind')
    op.drop_column('user_desktops', 'ai')
