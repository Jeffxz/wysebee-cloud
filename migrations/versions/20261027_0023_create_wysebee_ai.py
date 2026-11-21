"""wysebee_ai

How Wysebee AI answers (apps/cloud/wysebee_ai.py): the chat model, its reasoning effort and
each vendor's API key, kept here instead of in environment variables so Wysebee Admin can
change them. Whatever WYSEBEE_CHAT_MODEL / _CHAT_REASONING_EFFORT / _OPENAI_API_KEY /
_ANTHROPIC_API_KEY hold where this migration runs is copied in; the API keys encrypted with
WYSEBEE_CONFIG_SECRET_KEY, and left out (with a warning) when there is no such key.

Revision ID: 0023
Revises: 0022
Create Date: 2026-10-27 12:00:00.000000
"""

import logging
import os
import re
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0023'
down_revision: str | None = '0022'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.runtime.migration")

_MODEL_RE = re.compile(r"^(gpt|claude)-[A-Za-z0-9._-]+$")
_EFFORTS = ("none", "minimal", "low", "medium", "high", "xhigh", "max")


def _from_env() -> dict[str, str]:
    """The old settings, checked as the new keys are: a value they would refuse is left out."""
    from cryptography.fernet import Fernet

    found = {}
    model = os.environ.get("WYSEBEE_CHAT_MODEL", "").strip()
    if _MODEL_RE.match(model):
        found["chat.model"] = model
    effort = os.environ.get("WYSEBEE_CHAT_REASONING_EFFORT", "").strip().lower()
    if effort in _EFFORTS:
        found["chat.reasoning_effort"] = effort
    secrets = {
        "openai.api_key": os.environ.get("WYSEBEE_OPENAI_API_KEY", "").strip(),
        "anthropic.api_key": os.environ.get("WYSEBEE_ANTHROPIC_API_KEY", "").strip(),
    }
    secrets = {k: v for k, v in secrets.items() if v and not any(c.isspace() for c in v)}
    if secrets:
        try:
            fernet = Fernet(os.environ.get("WYSEBEE_CONFIG_SECRET_KEY", "").strip().encode())
        except ValueError:
            logger.warning("WYSEBEE_CONFIG_SECRET_KEY is not a Fernet key: %s not copied", ", ".join(secrets))
        else:
            found.update({k: fernet.encrypt(v.encode()).decode() for k, v in secrets.items()})
    return found


def upgrade() -> None:
    table = op.create_table(
        'wysebee_ai',
        sa.Column('key', sa.String(64), primary_key=True),
        sa.Column('value', sa.Text(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    rows = [{"key": k, "value": v} for k, v in _from_env().items()]
    if rows:
        op.bulk_insert(table, rows)


def downgrade() -> None:
    op.drop_table('wysebee_ai')
