"""Tool calls counted per person and month (apps/cloud/tool_calls.py) — one a tool call answered
through Wysebee Assistant (tests/test_agent_mcp.py, tests/test_workspace_assistant.py), a
statistic with no limit since 2026-11-21 — against a real database (skipped without
WYSEBEE_TEST_DATABASE_URL)."""

import asyncio
import logging
from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud import tool_calls
from tests.cloud_agent_fixtures import client, me  # noqa: F401 — fixtures
from tests.conftest import needs_db

def _count(client: TestClient, me: dict[str, str]) -> int:  # noqa: F811
    got = client.get("/api/v1/tool-calls", headers=me).json()
    assert got["month"] == tool_calls.month_of()
    return got["count"]


def test_the_count_starts_over_at_the_next_months_first_instant() -> None:
    assert tool_calls.next_month(datetime(2026, 11, 3, 12, tzinfo=UTC)) == datetime(2026, 12, 1, tzinfo=UTC)
    assert tool_calls.next_month(datetime(2026, 12, 31, 23, 59, tzinfo=UTC)) == datetime(2027, 1, 1, tzinfo=UTC)
    assert tool_calls.next_month() > datetime.now(UTC)


def test_a_month_is_its_utc_calendar_month() -> None:
    assert tool_calls.month_of(datetime(2026, 11, 3, 12, tzinfo=UTC)) == "2026-11"
    # 23:30 on Oct 31 in New York is already November in UTC.
    from zoneinfo import ZoneInfo

    assert tool_calls.month_of(datetime(2026, 10, 31, 23, 30, tzinfo=ZoneInfo("America/New_York"))) == "2026-11"
    assert len(tool_calls.month_of()) == 7


@needs_db
def test_the_count_starts_over_each_month_and_keeps_the_last(client: TestClient, me: dict[str, str], migrated_db_url: str) -> None:  # noqa: F811
    user = me["X-Test-User"]
    state = client.app.state

    async def counts() -> None:
        await tool_calls.count_one(state, user, datetime(2026, 10, 31, 23, 59, tzinfo=UTC))
        await tool_calls.count_one(state, user, datetime(2026, 10, 31, 23, 59, 59, tzinfo=UTC))
        await tool_calls.count_one(state, user, datetime(2026, 11, 1, 0, 0, tzinfo=UTC))

    client.portal.call(counts)
    with create_engine(migrated_db_url).begin() as conn:
        rows = conn.execute(text("SELECT month, count FROM ai_turn_counts WHERE user_id = :u ORDER BY month"), {"u": user}).all()
    assert [tuple(r) for r in rows] == [("2026-10", 2), ("2026-11", 1)]


@needs_db
def test_counts_made_at_once_are_all_kept(client: TestClient, me: dict[str, str]) -> None:  # noqa: F811
    user = me["X-Test-User"]
    state = client.app.state

    async def many() -> None:
        await asyncio.gather(*(tool_calls.count_one(state, user) for _ in range(20)))

    client.portal.call(many)
    assert _count(client, me) == 20


def test_a_count_that_cannot_be_written_never_costs_the_answer(caplog, monkeypatch) -> None:
    # Running the migrations (alembic's logging config) switches existing loggers off.
    monkeypatch.setattr(tool_calls.logger, "disabled", False)
    class Broken:
        def sessionmaker(self):
            raise ConnectionError("database down")

    state = type("State", (), {"db": Broken()})()
    caplog.set_level(logging.WARNING)
    asyncio.run(tool_calls.count_one(state, "someone"))
    assert "tool_call_count_failed: ConnectionError" in caplog.text


@needs_db
def test_the_month_is_told_with_when_it_starts_over(client: TestClient, me: dict[str, str]) -> None:  # noqa: F811
    got = client.get("/api/v1/tool-calls", headers=me).json()
    # No limit: plans are sized by devices and relay traffic (apps/cloud/billing.py).
    assert got == {
        "month": tool_calls.month_of(),
        "count": 0,
        "resets_at": tool_calls.next_month().isoformat(),
        # No extension serves a Billing page here (tests/test_extensions.py has one that does).
        "billing_url": None,
    }
