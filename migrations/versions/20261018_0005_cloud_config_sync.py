"""cloud items: revisions, tombstones and per-user heads for sync

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-18 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0005'
down_revision: str | None = '0004'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('cloud_configs', sa.Column('revision', sa.BigInteger(), server_default=sa.text('0'), nullable=False))
    op.add_column('cloud_configs', sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('cloud_configs', sa.Column('changed_by', sa.String(length=128), nullable=True))

    # Unique among live items only, so a deleted item's name can be used again.
    op.drop_index('ux_cloud_configs_name', table_name='cloud_configs')
    op.create_index(
        'ux_cloud_configs_name', 'cloud_configs', ['user_id', 'kind', 'name'], unique=True,
        postgresql_where=sa.text('deleted_at IS NULL'),
    )
    op.create_index('ix_cloud_configs_user_revision', 'cloud_configs', ['user_id', 'revision'], unique=False)

    op.create_table('cloud_config_heads',
    sa.Column('user_id', sa.String(length=255), nullable=False),
    sa.Column('revision', sa.BigInteger(), nullable=False),
    sa.Column('purged_through', sa.BigInteger(), server_default=sa.text('0'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('user_id')
    )

    # Existing items: revisions 1..n per person in the order they were last written,
    # and each person's head at their highest.
    op.execute("""
        UPDATE cloud_configs c SET revision = r.rn
        FROM (
            SELECT user_id, kind, item_id,
                   row_number() OVER (PARTITION BY user_id ORDER BY updated_at, kind, item_id) AS rn
            FROM cloud_configs
        ) r
        WHERE c.user_id = r.user_id AND c.kind = r.kind AND c.item_id = r.item_id
    """)
    op.execute("""
        INSERT INTO cloud_config_heads (user_id, revision)
        SELECT user_id, max(revision) FROM cloud_configs GROUP BY user_id
    """)


def downgrade() -> None:
    op.drop_table('cloud_config_heads')
    op.execute("DELETE FROM cloud_configs WHERE deleted_at IS NOT NULL")
    op.drop_index('ix_cloud_configs_user_revision', table_name='cloud_configs')
    op.drop_index('ux_cloud_configs_name', table_name='cloud_configs')
    op.create_index('ux_cloud_configs_name', 'cloud_configs', ['user_id', 'kind', 'name'], unique=True)
    op.drop_column('cloud_configs', 'changed_by')
    op.drop_column('cloud_configs', 'deleted_at')
    op.drop_column('cloud_configs', 'revision')
