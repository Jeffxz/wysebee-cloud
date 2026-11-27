"""Usage events (apps/cloud/usage_events.py): kept in ``usage_events`` and forwarded to Mixpanel.
The route's refusals need no database; keeping and purging run against the test database
(skipped without WYSEBEE_TEST_DATABASE_URL). The caller is faked with the X-Test-User header."""

import asyncio
import json
import logging
import types
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from fastapi import Header
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud import usage_events
from apps.cloud.agent_chat.postgres import RateLimit
from apps.cloud.auth import User
from apps.cloud.config import Settings
from apps.cloud.db import Database
from apps.cloud.models import UsageEvent
from tests.conftest import make_client, needs_db

ISSUER = "https://wysebee-test.us.auth0.com/"
NOW = datetime(2026, 11, 15, 12, 0, tzinfo=UTC)


def _fake_caller(x_test_user: str | None = Header(default=None)) -> User | None:
    return User(sub=x_test_user) if x_test_user else None


def _batch(**over) -> dict:
    return {"surface": "web", "app_version": "1.25.0", "language": "en", "events": [{"event": "Click", "properties": {"label": "Save"}}], **over}


class _Mixpanel:
    """Mixpanel's /track, answering ``status``; what it was sent is in ``seen``."""

    def __init__(self, status: int = 200) -> None:
        self.status = status
        self.seen: list[httpx.Request] = []

    def client(self) -> httpx.AsyncClient:
        def answer(request: httpx.Request) -> httpx.Response:
            self.seen.append(request)
            return httpx.Response(self.status, text='{"status": 1}')

        return httpx.AsyncClient(transport=httpx.MockTransport(answer))


@pytest.fixture
def logs(caplog, monkeypatch):
    monkeypatch.setattr(usage_events.logger, "disabled", False)
    with caplog.at_level(logging.INFO, "wysebee.cloud"):
        yield caplog


# --- what is kept, and what Mixpanel is sent ----------------------------------------------


def test_a_pages_properties_cannot_set_identity_and_none_are_kept_when_too_large() -> None:
    assert usage_events.clean({"label": "Save", "$user_id": "x", "distinct_id": "x", "ip": "1.2.3.4", "page": "/x"}) == {"label": "Save"}
    assert usage_events.clean({"label": "x" * (usage_events.PROPS_MAX_BYTES + 1)}) == {}


def test_a_pages_clock_is_believed_within_a_week_before_and_an_hour_after() -> None:
    ms = lambda d: int(d.timestamp() * 1000)  # noqa: E731
    assert usage_events.occurred(None, NOW) == NOW
    assert usage_events.occurred(ms(NOW - timedelta(days=6)), NOW) == NOW - timedelta(days=6)
    assert usage_events.occurred(ms(NOW - timedelta(days=8)), NOW) == NOW
    assert usage_events.occurred(ms(NOW + timedelta(hours=2)), NOW) == NOW
    assert usage_events.occurred(10**20, NOW) == NOW


def _row(**over) -> UsageEvent:
    fields = dict(
        occurred_at=NOW, event="Click", user_id=None, anonymous_id=None, session_id="s1", insert_id="i1",
        surface="web", page="/home", app_version=None, language="en", properties={"label": "Save"},
    )
    return UsageEvent(**{**fields, **over})


def test_mixpanel_gets_the_properties_the_pages_used_to_send() -> None:
    signed_in = usage_events.to_mixpanel(_row(user_id="auth0|me", anonymous_id="a" * 16, app_version="1.25.0"), "tok", "1.2.3.4")
    assert signed_in == {"event": "Click", "properties": {
        "label": "Save", "token": "tok", "time": int(NOW.timestamp() * 1000), "$insert_id": "i1", "surface": "web", "ip": "1.2.3.4",
        "session_id": "s1", "page": "/home", "app_version": "1.25.0", "language": "en",
        "$device_id": "a" * 16, "distinct_id": "auth0|me", "$user_id": "auth0|me", "user_id": "auth0|me",
    }}
    anonymous = usage_events.to_mixpanel(_row(anonymous_id="b" * 16, session_id=None, page=None), "tok", "1.2.3.4")["properties"]
    assert anonymous["distinct_id"] == f"$device:{'b' * 16}"
    assert "user_id" not in anonymous and "session_id" not in anonymous and "page" not in anonymous


def test_forwarding_posts_to_track_on_the_projects_host() -> None:
    mixpanel = _Mixpanel()
    asyncio.run(usage_events.forward(mixpanel.client(), Settings(mixpanel_api_host="https://api-eu.mixpanel.com/"), [{"event": "Click"}]))
    [sent] = mixpanel.seen
    assert str(sent.url) == "https://api-eu.mixpanel.com/track?ip=0&verbose=1"
    assert json.loads(sent.content) == [{"event": "Click"}]
    asyncio.run(usage_events.forward(mixpanel.client(), Settings(), []))
    assert mixpanel.seen[1].url.host == "api.mixpanel.com"


def test_a_refusal_or_an_outage_at_mixpanel_is_logged_and_dropped(logs) -> None:
    asyncio.run(usage_events.forward(_Mixpanel(400).client(), Settings(), [{"event": "Click"}]))
    assert "Mixpanel refused 1 events: 400" in logs.text

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route")

    asyncio.run(usage_events.forward(httpx.AsyncClient(transport=httpx.MockTransport(down)), Settings(), [{"event": "Click"}]))
    assert "Mixpanel unreachable, 1 events not forwarded" in logs.text


CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"


@pytest.mark.parametrize("agent", [
    None, "", "  ",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "facebookexternalhit/1.1", "Mozilla/5.0 (compatible; bingbot/2.0)", "python-requests/2.32.3", "curl/8.7.1",
    "Go-http-client/1.1", "Mozilla/5.0 (compatible; UptimeRobot/2.0)", "Mozilla/5.0 (Linux) Chrome-Lighthouse",
])
def test_crawlers_previewers_headless_browsers_and_scripts_are_bots(agent) -> None:
    assert usage_events.is_bot(agent)


@pytest.mark.parametrize("agent", [
    CHROME_MAC,
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (Linux; Android 10; CUBOT P40) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
])
def test_peoples_browsers_are_not_bots(agent) -> None:
    assert not usage_events.is_bot(agent)


def test_mixpanel_is_told_the_browser_and_system_as_its_library_names_them() -> None:
    names = usage_events.browser_and_os
    assert names(CHROME_MAC) == {"$browser": "Chrome", "$os": "Mac OS X"}
    assert names("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1") == {"$browser": "Mobile Safari", "$os": "iOS"}
    assert names("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0") == {"$browser": "Microsoft Edge", "$os": "Windows"}
    assert names("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0") == {"$browser": "Firefox", "$os": "Windows"}
    assert names("Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36") == {"$browser": "Samsung Internet", "$os": "Android"}
    assert names("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15") == {"$browser": "Safari", "$os": "Mac OS X"}
    assert names("something else") == {}
    assert names(None) == {}
    row = _row(anonymous_id="a" * 16)
    assert usage_events.to_mixpanel(row, "tok", "1.2.3.4", {"$browser": "Chrome"})["properties"]["$browser"] == "Chrome"


# --- the route's refusals -----------------------------------------------------------------


def test_off_it_answers_404(ui_dist: Path) -> None:
    with make_client(ui_dist, events_enabled=False) as c:
        assert c.post("/api/v1/events", json=_batch(anonymous_id="a" * 16)).status_code == 404


def test_without_a_token_it_needs_an_anonymous_id(ui_dist: Path) -> None:
    with make_client(ui_dist) as c:
        r = c.post("/api/v1/events", json=_batch())
    assert (r.status_code, r.json()["detail"]) == (422, "Sign in, or give an anonymous_id.")


def test_a_token_given_must_be_valid(ui_dist: Path) -> None:
    with make_client(ui_dist, auth_issuer=ISSUER) as c:
        r = c.post("/api/v1/events", json=_batch(anonymous_id="a" * 16), headers={"Authorization": "Bearer not-a-token"})
    assert r.status_code == 401


def test_a_batch_is_at_most_fifty_events_of_a_known_surface(ui_dist: Path) -> None:
    with make_client(ui_dist) as c:
        many = [{"event": "Click"}] * (usage_events.MAX_EVENTS + 1)
        assert c.post("/api/v1/events", json=_batch(anonymous_id="a" * 16, events=many)).status_code == 422
        assert c.post("/api/v1/events", json=_batch(anonymous_id="a" * 16, surface="desktop")).status_code == 422
        assert c.post("/api/v1/events", json=_batch(anonymous_id="a" * 16, events=[])).status_code == 422


def test_too_many_batches_a_minute_are_refused(ui_dist: Path) -> None:
    with make_client(ui_dist) as c:
        c.app.state.event_batches = RateLimit(0)
        r = c.post("/api/v1/events", json=_batch(anonymous_id="a" * 16))
    assert r.status_code == 429


# --- kept, forwarded and purged -----------------------------------------------------------


@pytest.fixture
def ids(migrated_db_url: str) -> Iterator[tuple[str, str]]:
    me, device = f"test-{uuid.uuid4().hex}", uuid.uuid4().hex
    yield me, device
    with create_engine(migrated_db_url).begin() as conn:
        conn.execute(text("DELETE FROM usage_events WHERE user_id = :u OR anonymous_id = :a"), {"u": me, "a": device})


@pytest.fixture
def client(ui_dist: Path, migrated_db_url: str) -> Iterator[TestClient]:
    with make_client(ui_dist, database_url=migrated_db_url, mixpanel_token="tok") as c:
        c.app.dependency_overrides[usage_events.caller] = _fake_caller
        yield c


def _kept(url: str, where: str, **params) -> list[dict]:
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            return [dict(r._mapping) for r in conn.execute(text(f"SELECT * FROM usage_events WHERE {where} ORDER BY id"), params)]
    finally:
        engine.dispose()


@needs_db
def test_a_signed_in_batch_is_kept_as_theirs_and_forwarded(client: TestClient, ids: tuple[str, str], migrated_db_url: str) -> None:
    me, device = ids
    mixpanel = _Mixpanel()
    client.app.state.events_http = mixpanel.client()
    when = int((datetime.now(UTC) - timedelta(minutes=5)).timestamp() * 1000)
    batch = _batch(events=[
        {"event": "Page Viewed", "time": when, "insert_id": "ins-1", "session_id": "sess", "page": "/home/agent/:name",
         "properties": {"distinct_id": "someone-else", "$user_id": "someone-else"}},
        {"event": "Click", "properties": {"label": "Save", "checked": True}},
    ], anonymous_id=device)
    r = client.post("/api/v1/events", json=batch, headers={"X-Test-User": me, "X-Forwarded-For": "10.0.0.1, 203.0.113.9", "User-Agent": CHROME_MAC})
    assert r.status_code == 204

    viewed, clicked = _kept(migrated_db_url, "user_id = :u", u=me)
    assert (viewed["event"], viewed["insert_id"], viewed["session_id"], viewed["page"], viewed["anonymous_id"]) == ("Page Viewed", "ins-1", "sess", "/home/agent/:name", device)
    assert int(viewed["occurred_at"].timestamp() * 1000) == when
    # The page cannot say who it is: that comes from the token.
    assert viewed["properties"] == {}
    assert (viewed["surface"], viewed["app_version"], viewed["language"]) == ("web", "1.25.0", "en")
    assert clicked["properties"] == {"label": "Save", "checked": True}
    # An event without its own id gets one.
    assert clicked["insert_id"] and clicked["insert_id"] != "ins-1"
    # Neither the address nor anything else of the person's is kept.
    assert "203.0.113.9" not in json.dumps(viewed, default=str)

    [sent] = mixpanel.seen
    events = json.loads(sent.content)
    assert [e["event"] for e in events] == ["Page Viewed", "Click"]
    assert events[0]["properties"]["distinct_id"] == me
    assert events[0]["properties"]["ip"] == "203.0.113.9"
    assert events[0]["properties"]["token"] == "tok"
    assert (events[0]["properties"]["$browser"], events[1]["properties"]["$os"]) == ("Chrome", "Mac OS X")


@needs_db
def test_a_bots_batch_is_answered_but_neither_kept_nor_forwarded(client: TestClient, ids: tuple[str, str], migrated_db_url: str) -> None:
    _, device = ids
    mixpanel = _Mixpanel()
    client.app.state.events_http = mixpanel.client()
    headless = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36"
    started = _batch(surface="landing", anonymous_id=device, events=[{"event": "Sign In Started", "properties": {"automatic": True}}])
    assert client.post("/api/v1/events", json=started, headers={"User-Agent": headless}).status_code == 204
    assert _kept(migrated_db_url, "anonymous_id = :a", a=device) == []
    assert mixpanel.seen == []


@needs_db
def test_an_anonymous_batch_is_kept_by_its_browser_id(client: TestClient, ids: tuple[str, str], migrated_db_url: str) -> None:
    _, device = ids
    client.app.state.events_http = _Mixpanel().client()
    assert client.post("/api/v1/events", json=_batch(surface="landing", anonymous_id=device)).status_code == 204
    [row] = _kept(migrated_db_url, "anonymous_id = :a", a=device)
    assert (row["user_id"], row["surface"]) == (None, "landing")


@needs_db
def test_without_a_mixpanel_project_events_are_only_kept(ui_dist: Path, migrated_db_url: str, ids: tuple[str, str]) -> None:
    _, device = ids
    mixpanel = _Mixpanel()
    with make_client(ui_dist, database_url=migrated_db_url) as c:
        c.app.state.events_http = mixpanel.client()
        assert c.post("/api/v1/events", json=_batch(anonymous_id=device)).status_code == 204
    assert len(_kept(migrated_db_url, "anonymous_id = :a", a=device)) == 1
    assert mixpanel.seen == []


def _purge(url: str, settings: Settings, now: datetime) -> int:
    db = Database(Settings(database_url=url))

    async def go() -> int:
        try:
            async with db.sessionmaker() as session:
                return await usage_events.purge(session, settings, now)
        finally:
            await db.dispose()

    return asyncio.run(go())


@needs_db
def test_events_past_their_keeping_time_are_deleted(migrated_db_url: str, ids: tuple[str, str]) -> None:
    me, _ = ids
    engine = create_engine(migrated_db_url)
    with engine.begin() as conn:
        for name, when in (("Old", NOW - timedelta(days=400)), ("Recent", NOW - timedelta(days=30))):
            conn.execute(text(
                "INSERT INTO usage_events (occurred_at, event, user_id, insert_id, surface) VALUES (:t, :e, :u, :e, 'web')"
            ), {"t": when, "e": name, "u": me})
    engine.dispose()
    # Kept for good: nothing goes.
    assert _purge(migrated_db_url, Settings(events_retention_days=0), NOW) == 0
    assert _purge(migrated_db_url, Settings(), NOW) >= 1
    assert [r["event"] for r in _kept(migrated_db_url, "user_id = :u", u=me)] == ["Recent"]


class _Stop(Exception):
    pass


class _Sessions:
    def sessionmaker(self):
        import contextlib

        @contextlib.asynccontextmanager
        async def session():
            yield object()

        return session()


def _one_round(monkeypatch, purge) -> None:
    async def stop(_seconds):
        raise _Stop

    monkeypatch.setattr(usage_events, "asyncio", types.SimpleNamespace(sleep=stop))
    monkeypatch.setattr(usage_events, "purge", purge)


def test_the_purge_logs_what_it_deleted(monkeypatch, logs) -> None:
    async def purge(*_args):
        return 3

    _one_round(monkeypatch, purge)
    with pytest.raises(_Stop):
        asyncio.run(usage_events.purge_often(_Sessions(), Settings()))
    assert "deleted 3 usage events" in logs.text


def test_a_purge_that_fails_waits_for_the_next_round(monkeypatch, logs) -> None:
    async def purge(*_args):
        raise OSError("database gone")

    _one_round(monkeypatch, purge)
    with pytest.raises(_Stop):
        asyncio.run(usage_events.purge_often(_Sessions(), Settings()))
    assert "usage event purge skipped: database gone" in logs.text
