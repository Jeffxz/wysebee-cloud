"""Skills the person's AI app asks to give an agent, waiting for the person

The person's call (2026-11-17, "AI apps propose, the person approves"): Wysebee Assistant's
``propose_skill`` asks for one of the person's skills on one of their agents; the request waits
here until the person gives it (it becomes an ``agent_skills`` row) or declines it, on the
agent's Tools tab (apps/cloud/skill_changes.py). One per agent and skill; deleted with either.

Revision ID: 0076
Revises: 0075
Create Date: 2026-11-20 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = '0076'
down_revision: str | None = '0075'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "skill_requests",
        sa.Column("user_id", sa.String(255), nullable=False),
        sa.Column("agent_id", UUID(as_uuid=False), sa.ForeignKey("user_agents.agent_id", ondelete="CASCADE"), primary_key=True),
        sa.Column("skill_id", UUID(as_uuid=False), sa.ForeignKey("user_skills.skill_id", ondelete="CASCADE"), primary_key=True),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_skill_requests_user_id", "skill_requests", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_skill_requests_user_id", table_name="skill_requests")
    op.drop_table("skill_requests")
