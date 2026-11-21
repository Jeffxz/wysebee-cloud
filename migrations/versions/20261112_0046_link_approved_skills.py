"""browser_links.approved_skills: the skills a Mac has allowed

Wysebee Agent for Mac runs a skill's declared scripts for its agent — only the skills the
person allowed on that Mac, whose names it says with every poll (``approved_skills``).
apps/cloud/browser_links.py; wysebee-agent-osx's docs/protocol.md, "Skill scripts".

Revision ID: 0046
Revises: 0045
Create Date: 2026-11-12 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0046'
down_revision: str | None = '0045'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('browser_links', sa.Column('approved_skills', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False))


def downgrade() -> None:
    op.drop_column('browser_links', 'approved_skills')
