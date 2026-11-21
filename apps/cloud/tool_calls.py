"""Each person's tool calls, counted per calendar month (2026-11-03, the person's call;
``GET /ai-turns`` until 2026-11-14, when it became ``GET /tool-calls``). They were **credits**, priced by the plans, until
2026-11-21: now a statistic, with no limit here (a deployment's extension may read it,
apps/cloud/extensions.py).

**One is one tool call answered** (2026-11-14): every tool the person's AI app runs through
Wysebee Assistant, ``/assistant/mcp`` (apps/cloud/agent_mcp.py) — an agent's tool through
``call_agent_tool``, or one of the page tools — and every step of a scheduled task
(apps/cloud/task_runner.py). ``list_agents`` and ``list_agent_tools`` only show what there
is: not counted. A call refused or that failed is not counted.

**Per calendar month, UTC** (``YYYY-MM``): one row per person and month in
``ai_turn_counts``, added to in one statement (an upsert, so replicas never lose a count). A
new month is a new row, so the count starts over at 00:00 UTC on the 1st; earlier months
stay as history.

**Never in the way**: counting is best effort — a database that cannot be written logs a
warning and the person still gets their answer.

- ``GET /tool-calls`` — ``{month, count, resets_at, billing_url}``: the signed-in person's
  this month (0 before any), when the count starts over (the next month's first instant,
  UTC) and the website's Billing page (null unless an extension serves one).
"""

import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud import extensions
from apps.cloud.auth import User, current_user
from apps.cloud.deps import get_session
from apps.cloud.models import AiTurnCount
from apps.cloud.relay import public_base

logger = logging.getLogger("wysebee.cloud.tool_calls")

router = APIRouter(prefix="/v1", tags=["Tool calls"])

# The website's Billing page, after the site's address.
BILLING_PATH = "/app/#/account/billing"


def month_of(now: datetime | None = None) -> str:
    """The calendar month a moment falls in, in UTC: ``2026-11``."""
    return (now or datetime.now(UTC)).astimezone(UTC).strftime("%Y-%m")


def next_month(now: datetime | None = None) -> datetime:
    """When the count starts over: the first instant of the next calendar month, UTC."""
    t = (now or datetime.now(UTC)).astimezone(UTC)
    return datetime(t.year + (t.month == 12), t.month % 12 + 1, 1, tzinfo=UTC)


async def count_one(state: Any, user_id: str, now: datetime | None = None) -> None:
    """One more tool call for ``user_id`` this month. Never raises."""
    at = now or datetime.now(UTC)
    row = {"user_id": user_id, "month": month_of(at), "count": 1, "updated_at": at}
    statement = insert(AiTurnCount).values(**row).on_conflict_do_update(
        index_elements=[AiTurnCount.user_id, AiTurnCount.month],
        set_={"count": AiTurnCount.count + 1, "updated_at": at},
    )
    try:
        async with state.db.sessionmaker() as session:
            await session.execute(statement)
            await session.commit()
    except Exception as exc:  # noqa: BLE001 — a count must never cost the person their answer
        logger.warning("tool_call_count_failed: %s", type(exc).__name__)


@router.get("/tool-calls")
async def this_month(request: Request, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    now = datetime.now(UTC)
    month = month_of(now)
    row = await session.get(AiTurnCount, (user.sub, month))
    return {
        "month": month,
        "count": row.count if row is not None else 0,
        "resets_at": next_month(now).isoformat(),
        # The Billing page, where an extension serves one (apps/cloud/extensions.py).
        "billing_url": public_base(request) + BILLING_PATH if extensions.web_features(request.app.state.extensions).get("billing") else None,
    }
