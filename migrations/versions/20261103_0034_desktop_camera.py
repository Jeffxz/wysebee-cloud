"""user_desktops.camera: the desktop shares its camera with paired devices

A desktop reports ``camera: true`` while the person lets paired devices watch its camera
(wysebee-desktop's camera_share.rs, docs/desktop-camera.md); another desktop then shows a
camera button for the agents living on it. False for every desktop until it reports.

Revision ID: 0034
Revises: 0033
Create Date: 2026-11-03 21:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0034'
down_revision: str | None = '0033'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('user_desktops', sa.Column('camera', sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade() -> None:
    op.drop_column('user_desktops', 'camera')
