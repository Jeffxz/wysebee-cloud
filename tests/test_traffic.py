"""Relay traffic counted per person and month (apps/cloud/traffic.py), and the devices counted
(apps/cloud/browser_links.py, ``device_counts``) — the usage an extension's policy may limit.
The database tests are skipped without WYSEBEE_TEST_DATABASE_URL."""

import asyncio
import json
import logging
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud import browser_links, traffic
from tests.cloud_agent_fixtures import _client, me  # noqa: F401 — fixtures
from tests.conftest import needs_db
from tests.test_browser_links import BASE, FAST, paired


def test_traffic_is_counted_best_effort(caplog: pytest.LogCaptureFixture) -> None:
    class Broken:
        def sessionmaker(self):
            raise ConnectionError("database down")

    # Nothing to count, or nobody's: the database is not asked.
    asyncio.run(traffic.add_now(SimpleNamespace(db=Broken()), None, 10))
    asyncio.run(traffic.add_now(SimpleNamespace(db=Broken()), "someone", 0))
    assert caplog.text == ""
    caplog.set_level(logging.WARNING)
    asyncio.run(traffic.add_now(SimpleNamespace(db=Broken()), "someone", 10))
    assert "relay_traffic_count_failed: ConnectionError" in caplog.text
    assert traffic.month_of(datetime(2026, 12, 9, tzinfo=UTC)) == "2026-12"
    assert traffic.next_month(datetime(2026, 12, 9, tzinfo=UTC)) == datetime(2027, 1, 1, tzinfo=UTC)


@pytest.fixture
def client(ui_dist: Path, migrated_db_url: str, tmp_path: Path) -> Iterator[TestClient]:
    c = _client(ui_dist, migrated_db_url, tmp_path, browser_link_starts_per_minute=10_000, **FAST)
    yield c
    c.__exit__(None, None, None)
    with create_engine(migrated_db_url).begin() as conn:
        conn.execute(text("DELETE FROM browser_links WHERE user_id IS NULL"))


def _used(client: TestClient, user: str) -> int:
    async def go() -> int:
        async with client.app.state.db.sessionmaker() as session:
            return await traffic.used(session, user)

    return client.portal.call(go)


def _devices(client: TestClient, user: str) -> tuple[int, int]:
    async def go() -> tuple[int, int]:
        async with client.app.state.db.sessionmaker() as session:
            return await browser_links.device_counts(session, client.app.state.settings, user)

    return client.portal.call(go)


@needs_db
def test_a_calls_arguments_and_result_are_counted_and_the_devices_too(client: TestClient, me: dict[str, str], migrated_db_url: str) -> None:  # noqa: F811
    user = me["X-Test-User"]
    assert _used(client, user) == 0 and _devices(client, user) == (0, 0)
    a = paired(client, me, "Alpha")
    paired(client, me, "Beta")
    assert _devices(client, user) == (2, 2)
    with create_engine(migrated_db_url).begin() as conn:
        conn.execute(text("UPDATE browser_links SET last_seen = now() - interval '1 hour' WHERE id = :i"), {"i": a.id})
    assert _devices(client, user) == (2, 1)
    a.poll()
    args = {"note": "x" * 100}
    assert client.post(f"{BASE}/{a.id}/calls?wait=0", json={"op": "ping", "args": args}, headers=me).status_code == 200
    sent = _used(client, user)
    assert sent == len(json.dumps(args).encode())
    [taken] = a.poll().json()["calls"]
    assert a.result(taken["id"], ok=True, result={"text": "y" * 300}).status_code == 204
    assert _used(client, user) > sent + 300
