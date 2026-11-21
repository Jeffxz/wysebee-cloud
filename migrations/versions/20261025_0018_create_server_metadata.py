"""server_metadata

What the deployment announces (apps/cloud/server_metadata.py): the latest desktop release
and its downloads, kept here instead of in environment variables. Whatever
WYSEBEE_DESKTOP_VERSION / _DOWNLOAD_URL_OSX / _DOWNLOAD_URL_WIN hold where this migration
runs is copied in, so an announced release stays announced.

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-25 23:00:00.000000
"""

import os
import re
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0018'
down_revision: str | None = '0017'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_VERSION_RE = re.compile(r"^v?(\d+)\.(\d+)(?:\.(\d+))?$")


def _from_env() -> dict[str, str]:
    """The old settings, checked as they were: a value they would have refused is left out."""
    found = {}
    raw = os.environ.get("WYSEBEE_DESKTOP_VERSION", "").strip()
    match = _VERSION_RE.match(raw)
    if match:
        major, minor, patch = match.groups()
        found["desktop.version"] = f"{int(major)}.{int(minor)}.{int(patch or 0)}"
    for platform in ("osx", "win"):
        url = os.environ.get(f"WYSEBEE_DESKTOP_DOWNLOAD_URL_{platform.upper()}", "").strip()
        if url.startswith(("https://", "http://localhost", "http://127.0.0.1")):
            found[f"desktop.download_url_{platform}"] = url
    return found


def upgrade() -> None:
    table = op.create_table(
        'server_metadata',
        sa.Column('key', sa.String(64), primary_key=True),
        sa.Column('value', sa.Text(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    rows = [{"key": k, "value": v} for k, v in _from_env().items()]
    if rows:
        op.bulk_insert(table, rows)


def downgrade() -> None:
    op.drop_table('server_metadata')
