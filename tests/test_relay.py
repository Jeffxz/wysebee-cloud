"""What is left of the relay (apps/cloud/relay.py): the hub that wakes waiters across replicas
for the browser link, and the purge of the rows the relay to Wysebee Desktop left (it ended on
2026-11-13: an AI app connects to agents living in Wysebee Cloud, tests/test_agent_mcp.py)."""

import asyncio
from pathlib import Path

import pytest

from apps.cloud import relay
from apps.cloud.config import Settings
from tests.conftest import UNREACHABLE_DB_URL, make_client


def test_the_hub_wakes_one_key_or_everyone():
    async def go():
        hub = relay.RelayHub(Settings(database_url=UNREACHABLE_DB_URL, config_events_listen=False))
        hub.start()  # listening off: starts nothing
        with hub.subscribe("a") as a, hub.subscribe("b") as b:
            hub.wake("a")
            assert a.is_set() and not b.is_set()
            hub.wake()
            assert b.is_set()
        assert hub._waiters == {}
        hub.wake("gone")
        await hub.stop()
        assert not await relay._wait(asyncio.Event(), 0.01)

    asyncio.run(go())


def test_the_hub_keeps_trying_to_listen(monkeypatch):
    async def go():
        monkeypatch.setattr(relay, "RECONNECT_MAX_SECONDS", 0.01)
        hub = relay.RelayHub(Settings(database_url=UNREACHABLE_DB_URL))
        hub.start()
        await asyncio.sleep(0.05)
        assert not hub.listening
        await hub.stop()
        await hub.stop()  # twice is fine

    asyncio.run(go())


class _Notice:
    def __init__(self, payload: str) -> None:
        self.payload = payload


class _Conn:
    """A LISTENing connection that delivers ``payloads`` and then closes."""

    def __init__(self, payloads: list[str]) -> None:
        self.payloads = payloads
        self.executed: list[str] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, sql: str) -> None:
        self.executed.append(sql)

    async def notifies(self):
        for p in self.payloads:
            yield _Notice(p)


def test_the_hub_wakes_only_the_key_a_readable_notice_names_and_backs_off(monkeypatch):
    async def go():
        hub = relay.RelayHub(Settings(database_url=UNREACHABLE_DB_URL, config_events_listen=False))
        woken: list[str | None] = []
        monkeypatch.setattr(hub, "wake", lambda key=None: woken.append(key))
        conn = _Conn(["not json", '{"x": 1}', "[]", '{"k": "link:a"}'])
        calls = 0

        async def connect(dsn, autocommit):
            nonlocal calls
            calls += 1
            if calls == 1:
                return conn
            if calls == 2:
                raise OSError("connection refused")
            raise asyncio.CancelledError

        slept: list[float] = []

        async def sleep(delay, *a, **k):
            slept.append(delay)

        monkeypatch.setattr(relay.psycopg.AsyncConnection, "connect", connect)
        monkeypatch.setattr(relay.asyncio, "sleep", sleep)
        with pytest.raises(asyncio.CancelledError):
            await hub._run()
        assert conn.executed == [f"LISTEN {relay.NOTIFY_CHANNEL}"]
        # Every key on connect, then only "link:a": the three unreadable notices are skipped.
        assert woken == [None, "link:a"]
        assert not hub.listening
        # Closed: 1 s before connecting again; refused: twice that before the next try.
        assert slept == [1.0, 2.0]

    asyncio.run(go())


def test_the_desktop_relay_is_gone(ui_dist: Path):
    with make_client(ui_dist, auth_issuer="https://tenant.example.auth0.com/", relay_enabled=True) as c:
        for path in ("/api/v1/relay/poll", "/api/v1/relay/leave", "/api/v1/relay/calls/x/result"):
            assert c.post(path, json={"instance_id": "i"}).status_code in (404, 405), path
        assert c.get("/api/v1/relay/status").status_code == 404
