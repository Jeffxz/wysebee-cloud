"""cloud_configs.secret: dropped

Cloud items once carried a secret, encrypted under WYSEBEE_CONFIG_SECRET_KEY, for the
credentials and database connections that went with tools (0006). No kind left used it, and
the setting is gone: what the cloud keeps secret is sealed under the key-encryption key
(apps/cloud/envelope.py). Any value still in the column is deleted with it.

Revision ID: 0041
Revises: 0040
Create Date: 2026-11-11 15:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0041'
down_revision: str | None = '0040'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column('cloud_configs', 'secret')


def downgrade() -> None:
    op.add_column('cloud_configs', sa.Column('secret', sa.String(), nullable=True))
