"""The test extension's one table."""

import sqlalchemy as sa
from alembic import op

revision = "f001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("fake_extension_rows", sa.Column("id", sa.Integer, primary_key=True))


def downgrade() -> None:
    op.drop_table("fake_extension_rows")
