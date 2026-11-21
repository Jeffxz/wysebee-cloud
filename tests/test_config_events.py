"""The change feed (GET /api/v1/configs/events): a frame each time the person's revision
moves (apps/cloud/changes.py) — a task or agent saved or deleted.

Framing is checked without a database; the live paths need one (WYSEBEE_TEST_DATABASE_URL).
"""

import contextlib
import json
import threading
import time
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import Header
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud.auth import User, current_user
from apps.cloud.config_events import ChangeHub, _cursor, frame
from apps.cloud.config import Settings
from tests.conftest import make_client, needs_db


def read_events(response, until=None, limit=50) -> list[tuple[str, dict | None, str | None]]:
    """Parse SSE frames off a streaming response: (event, data, id); pings as ("ping", None, None)."""
    events: list[tuple[str, dict | None, str | None]] = []
    event, data, eid = None, None, None
    for line in response.iter_lines():
        if line.startswith(":"):
            events.append(("ping", None, None))
        elif line.startswith("event: "):
            event = line[7:]
        elif line.startswith("data: "):
            data = json.loads(line[6:])
        elif line.startswith("id: "):
            eid = line[4:]
        elif line == "" and event:
            events.append((event, data, eid))
            event, data, eid = None, None, None
        if (until and until(events)) or len(events) >= limit:
            break
    return events


# --- no database ----------------------------------------------------------------------


def test_frames_are_server_sent_events():
    assert frame("hello", {"revision": 3}) == 'event: hello\ndata: {"revision":3}\n\n'
    assert frame("changes", {"revision": 4}, 4).startswith("id: 4\nevent: changes\n")


def test_last_event_id_wins_over_since():
    assert _cursor(5, None) == 5
    assert _cursor(5, " 9 ") == 9
    assert _cursor(None, "nonsense") is None


def test_the_hub_wakes_one_person_or_everyone():
    import asyncio

    async def go():
        hub = ChangeHub(Settings(config_events_listen=False))
        with hub.subscribe("a") as ea, hub.subscribe("b") as eb:
            hub.wake("a")
            assert ea.is_set() and not eb.is_set()
            ea.clear()
            hub.wake()
            assert ea.is_set() and eb.is_set()
        assert hub._subscribers == {}
        hub.wake("gone")  # nobody listening: no error

    asyncio.run(go())


# --- with a database --------------------------------------------------------------------


def _fake_user(x_test_user: str = Header(), x_test_azp: str = Header(default="wysebee-desktop"),
               x_test_exp: str = Header(default="0")) -> User:
    return User(sub=x_test_user, client_id=x_test_azp, expires_at=float(x_test_exp))


@pytest.fixture
def me(migrated_db_url: str) -> Iterator[str]:
    sub = f"test-{uuid.uuid4().hex}"
    yield sub
    engine = create_engine(migrated_db_url)
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM user_tasks WHERE user_id = :u"), {"u": sub})
        conn.execute(text("DELETE FROM cloud_config_heads WHERE user_id = :u"), {"u": sub})
    engine.dispose()


def _client(ui_dist: Path, url: str, **settings) -> TestClient:
    settings = {"config_events_heartbeat_seconds": 0.2, "config_events_max_seconds": 5, **settings}
    c = make_client(ui_dist, database_url=url, **settings)
    c.app.dependency_overrides[current_user] = _fake_user
    return c


def put(client, sub, name):
    """Save a task: the person's revision moves."""
    r = client.post("/api/v1/tasks", headers={"X-Test-User": sub}, json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def head(url: str, sub: str) -> int:
    engine = create_engine(url)
    with engine.connect() as conn:
        found = conn.execute(text("SELECT revision FROM cloud_config_heads WHERE user_id = :u"), {"u": sub}).scalar()
    engine.dispose()
    return found or 0


@needs_db
def test_hello_then_changes_since_a_cursor_then_pings(ui_dist, migrated_db_url, me):
    with _client(ui_dist, migrated_db_url) as c:
        put(c, me, "a")
        cursor = head(migrated_db_url, me)
        made = put(c, me, "b")
        assert c.delete(f"/api/v1/tasks/{made['id']}", headers={"X-Test-User": me}).status_code == 204
        with c.stream("GET", f"/api/v1/configs/events?since={cursor}", headers={"X-Test-User": me}) as r:
            assert r.status_code == 200
            assert r.headers["content-type"].startswith("text/event-stream")
            events = read_events(r, until=lambda e: any(x[0] == "ping" for x in e))
    hello, changes = events[0], events[1]
    assert hello[0] == "hello" and hello[1]["revision"] == cursor + 2
    # It names nothing: the page reads again what it shows.
    assert changes == ("changes", {"revision": cursor + 2, "changes": []}, str(cursor + 2))
    assert events[2][0] == "ping"


@contextlib.contextmanager
def live_server(app) -> Iterator[str]:
    """Serve ``app`` on a real local port — TestClient buffers a streaming response
    until it ends, so it cannot show how fast a frame arrives."""
    import socket

    import uvicorn

    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=10)


@needs_db
def test_a_write_elsewhere_reaches_an_open_stream_within_a_second(ui_dist, migrated_db_url, me):
    import httpx

    from apps.cloud.main import create_app

    # A long heartbeat: only the LISTEN/NOTIFY wake-up can deliver it this fast.
    settings = Settings(database_url=migrated_db_url, config_events_heartbeat_seconds=30, config_events_max_seconds=30)
    listener_app = create_app(ui_dist=ui_dist, settings=settings)
    listener_app.dependency_overrides[current_user] = _fake_user
    with live_server(listener_app) as base, _client(ui_dist, migrated_db_url) as writer:
        deadline = time.time() + 5
        while not listener_app.state.change_hub.listening and time.time() < deadline:
            time.sleep(0.05)
        assert listener_app.state.change_hub.listening

        with httpx.stream("GET", f"{base}/api/v1/configs/events", headers={"X-Test-User": me}, timeout=10) as r:
            lines = r.iter_lines()
            assert next(lines) == "event: hello"
            next(lines), next(lines)  # its data and the blank line
            started = time.time()
            put(writer, me, "from-elsewhere")
            frame_lines = []
            for line in lines:
                if line == "":
                    break
                frame_lines.append(line)
            elapsed = time.time() - started
    assert frame_lines[1] == "event: changes"
    assert json.loads(frame_lines[2][6:]) == {"revision": head(migrated_db_url, me), "changes": []}
    assert elapsed < 1


@needs_db
def test_last_event_id_resumes_and_skips_nothing(ui_dist, migrated_db_url, me):
    with _client(ui_dist, migrated_db_url) as c:
        put(c, me, "a")
        put(c, me, "b")
        now = head(migrated_db_url, me)
        # Behind (Last-Event-ID over ?since=): told at once where it stands now.
        with c.stream("GET", f"/api/v1/configs/events?since={now}", headers={"X-Test-User": me, "Last-Event-ID": str(now - 1)}) as r:
            events = read_events(r, until=lambda e: any(x[0] in ("changes", "ping") for x in e))
        assert events[1] == ("changes", {"revision": now, "changes": []}, str(now))
        # Up to date: nothing to say until something changes.
        with c.stream("GET", f"/api/v1/configs/events?since={now}", headers={"X-Test-User": me}) as r:
            events = read_events(r, until=lambda e: any(x[0] in ("changes", "ping") for x in e))
    assert [e[0] for e in events] == ["hello", "ping"]


@needs_db
def test_the_stream_ends_when_the_token_expires(ui_dist, migrated_db_url, me):
    with _client(ui_dist, migrated_db_url) as c:
        started = time.time()
        headers = {"X-Test-User": me, "X-Test-Exp": str(time.time() + 0.5)}
        with c.stream("GET", "/api/v1/configs/events", headers=headers) as r:
            events = read_events(r, limit=1000)
        assert time.time() - started < 3
    assert events[0][0] == "hello"


@needs_db
def test_the_feed_needs_sign_in(ui_dist, migrated_db_url):
    with make_client(ui_dist, database_url=migrated_db_url) as c:
        assert c.get("/api/v1/configs/events").status_code in (401, 503)


# --- the listener and the stream, faked --------------------------------------------------


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


def test_the_hub_wakes_only_the_person_a_readable_notice_names_and_backs_off(monkeypatch):
    import asyncio

    from apps.cloud import config_events

    async def go():
        hub = ChangeHub(Settings(config_events_listen=False))
        woken: list[str | None] = []
        monkeypatch.setattr(hub, "wake", lambda user_id=None: woken.append(user_id))
        calls = 0

        async def connect(dsn, autocommit):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("connection refused")
            if calls > 2:
                raise asyncio.CancelledError
            return _Conn(["not json", '{"x": 1}', "[]", json.dumps({"u": "a"})])

        slept: list[float] = []

        async def sleep(delay, *a, **k):
            slept.append(delay)

        monkeypatch.setattr(config_events.psycopg.AsyncConnection, "connect", connect)
        monkeypatch.setattr(config_events.asyncio, "sleep", sleep)
        with pytest.raises(asyncio.CancelledError):
            await hub._run()
        # Everyone on connect, then only "a": the three unreadable notices are skipped.
        assert woken == [None, "a"]
        assert not hub.listening
        # Closed: 1 s before connecting again; refused: twice that before the next try.
        assert slept == [1.0, 2.0]

    asyncio.run(go())


class _Request:
    def __init__(self, settings: Settings, hub: ChangeHub, disconnected: list[bool]) -> None:
        from types import SimpleNamespace

        self.app = SimpleNamespace(state=SimpleNamespace(settings=settings, change_hub=hub))
        self._disconnected = disconnected

    async def is_disconnected(self) -> bool:
        return self._disconnected.pop(0)


def test_each_move_is_one_frame_and_a_gone_client_ends_it(monkeypatch):
    import asyncio

    from apps.cloud import config_events

    heads = [5, 7, 7]
    unreads = [0, 0, 2]

    async def head(request, user):
        return heads.pop(0)

    async def unread(request, user):
        return unreads.pop(0)

    monkeypatch.setattr(config_events, "_head", head)
    monkeypatch.setattr(config_events, "_unread", unread)
    settings = Settings(config_events_listen=False, config_events_heartbeat_seconds=0.01, config_events_max_seconds=5)

    async def go() -> list[str]:
        hub = ChangeHub(settings)
        # Connected before the first wait and at its ping; gone at the second.
        request = _Request(settings, hub, [False, False, False, True])
        response = await config_events.config_events(request, None, User(sub="u1", client_id="c"), None)
        return [chunk async for chunk in response.body_iterator]

    out = asyncio.run(go())
    assert out == [
        frame("hello", {"revision": 5}),
        frame("changes", {"revision": 7, "changes": []}, 7),
        ": ping\n\n",
        frame("activity", {"unread": 2}),
    ]
