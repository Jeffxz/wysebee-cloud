"""A person's change counter (:class:`~apps.cloud.models.CloudConfigHead`): saving one of their
agents (apps/cloud/agents.py) or tasks (apps/cloud/tasks.py), or a pairing changing an agent,
bumps it in the same transaction, and the change feed (apps/cloud/config_events.py) tells
their open pages, which read again what they show."""

import json

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud.models import CloudConfigHead

# The change feed's channel (apps/cloud/config_events.py listens on it; so do the
# notifications, apps/cloud/notifications.py).
NOTIFY_CHANNEL = "wysebee_cloud_configs"


async def bump(session: AsyncSession, user_id: str) -> int:
    """The person's next revision, taking their counter's row lock for this transaction — so
    their writes are serialised — and queue the change feed's notice, which Postgres delivers
    on commit."""
    revision = await session.scalar(
        insert(CloudConfigHead)
        .values(user_id=user_id, revision=1)
        .on_conflict_do_update(
            index_elements=["user_id"],
            set_={"revision": CloudConfigHead.revision + 1, "updated_at": func.now()},
        )
        .returning(CloudConfigHead.revision)
    )
    assert revision is not None
    await session.execute(
        text("SELECT pg_notify(:channel, :payload)"),
        {"channel": NOTIFY_CHANNEL, "payload": json.dumps({"u": user_id, "r": revision})},
    )
    return revision


async def head(session: AsyncSession, user_id: str) -> int:
    """The person's revision now (0 before their first change)."""
    return await session.scalar(select(CloudConfigHead.revision).where(CloudConfigHead.user_id == user_id)) or 0
