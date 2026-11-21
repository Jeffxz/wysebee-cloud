"""The person's Activity (apps/cloud/notifications.py): notifications their AI app sends through
Wysebee Assistant's send_notification, listed newest first, read, and announced on the change
feed — against a real database (skipped without WYSEBEE_TEST_DATABASE_URL)."""

import json
import time

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud import notifications
from apps.cloud.auth import current_user
from apps.cloud.config import Settings
from tests.cloud_agent_fixtures import client, me  # noqa: F401 — fixtures
from tests.conftest import needs_db
from tests.cloud_agent_fixtures import _agent, _agents
from tests.test_agent_mcp import _call, _mcp, _signed, fake_verifier  # noqa: F401 — fixtures
from tests.test_config_events import _client as feed_client
from tests.test_config_events import _fake_user, live_server


def _count(client: TestClient, me: dict[str, str]) -> int:  # noqa: F811
    return client.get("/api/v1/tool-calls", headers=me).json()["count"]


def _notify(client: TestClient, auth: dict, agent: str, arguments: dict) -> dict:  # noqa: F811
    """An agent's send_notification, as the AI app runs it."""
    return _call(client, auth, "call_agent_tool", {"agent": agent, "tool": "send_notification", "arguments": arguments})


@needs_db
def test_an_agent_sends_one_and_activity_lists_it_newest_first(client: TestClient, me: dict[str, str]):  # noqa: F811
    auth = _signed(client, me)
    assert client.get("/api/v1/notifications", headers=me).json() == {"notifications": [], "unread": 0}
    first = _notify(client, auth, "wysebee", {"title": "  Report ready ", "body": " **Done.** "})
    assert first == {"content": [{"type": "text", "text": "Sent from @wysebee: it shows on the person's Activity page in Wysebee."}], "isError": False}
    time.sleep(0.01)
    _notify(client, auth, "wysebee", {"title": "Second"})
    got = client.get("/api/v1/notifications", headers=me).json()
    assert got["unread"] == 2
    assert [(n["title"], n["body"], n["agent"], n["read"]) for n in got["notifications"]] == [("Second", "", "wysebee", False), ("Report ready", "**Done.**", "wysebee", False)]
    assert set(got["notifications"][0]) == {"id", "title", "body", "agent", "created_at", "read"}
    # Each one is a tool call answered: a credit.
    assert _count(client, me) == 2
    assert client.get("/api/v1/notifications?limit=1", headers=me).json()["notifications"][0]["title"] == "Second"
    assert client.get("/api/v1/notifications/unread", headers=me).json() == {"unread": 2}
    # Opening Activity reads them all; again, there is none left to read.
    assert client.post("/api/v1/notifications/read", headers=me).json() == {"read": 2}
    assert client.post("/api/v1/notifications/read", headers=me).json() == {"read": 0}
    got = client.get("/api/v1/notifications", headers=me).json()
    assert got["unread"] == 0 and all(n["read"] for n in got["notifications"])
    # Only the person's own.
    assert client.get("/api/v1/notifications", headers={"X-Test-User": "someone-else"}).json() == {"notifications": [], "unread": 0}
    # One deleted, by its owner only; then it is gone.
    first_id = got["notifications"][-1]["id"]
    assert client.delete(f"/api/v1/notifications/{first_id}", headers={"X-Test-User": "someone-else"}).status_code == 404
    assert client.delete(f"/api/v1/notifications/{first_id}", headers=me).status_code == 204
    assert [n["title"] for n in client.get("/api/v1/notifications", headers=me).json()["notifications"]] == ["Second"]
    assert client.delete(f"/api/v1/notifications/{first_id}", headers=me).json() == {"detail": "No such notification."}
    # An unread one deleted: no longer counted.
    _notify(client, auth, "wysebee", {"title": "Third"})
    third = client.get("/api/v1/notifications", headers=me).json()["notifications"][0]
    assert client.get("/api/v1/notifications/unread", headers=me).json() == {"unread": 1}
    assert client.delete(f"/api/v1/notifications/{third['id']}", headers=me).status_code == 204
    assert client.get("/api/v1/notifications/unread", headers=me).json() == {"unread": 0}


@needs_db
def test_a_notification_that_is_not_one_is_refused_and_costs_nothing(client: TestClient, me: dict[str, str]):  # noqa: F811
    auth = _signed(client, me)
    for args, said in [
        ({}, "Give a 'title': one line of text."),
        ({"title": "  "}, "Give a 'title': one line of text."),
        ({"title": "two\nlines"}, "Give a 'title': one line of text."),
        ({"title": "x", "body": 3}, "'body' must be text (Markdown)."),
        ({"title": "x" * 201}, "The title is too long: at most 200 characters."),
        ({"title": "x", "body": "y" * 10_001}, "The body is too long: at most 10000 characters."),
    ]:
        assert _notify(client, auth, "wysebee", args) == {"content": [{"type": "text", "text": said}], "isError": True}
    assert client.get("/api/v1/notifications/unread", headers=me).json() == {"unread": 0}
    assert _count(client, me) == 0


@needs_db
def test_every_agent_has_it_and_a_notification_is_the_agents_that_sent_it(client: TestClient, me: dict[str, str]):  # noqa: F811
    auth = _signed(client, me)
    _agent(client, me, "desk", {"label": "Desk"})
    _agent(client, me, "off", {"label": "Off"})
    client.put("/api/v1/mcp/agents/off", json={"exposed": False}, headers=me)
    # Offered with each agent's own tools — an agent with nothing else has it too.
    listed = _call(client, auth, "list_agent_tools", {"agent": "desk"})["content"][0]["text"]
    assert '"send_notification"' in listed and "It has no tools." not in listed
    assert [t["name"] for t in client.get("/api/v1/mcp/status?agent=desk", headers=me).json()["tools"]] == ["send_notification"]
    # Wysebee Assistant itself has none: a notification is always an agent's.
    assert "send_notification" not in [t["name"] for t in _mcp(client, auth, "tools/list")["tools"]]
    assert _notify(client, auth, "desk", {"title": "From desk"})["content"][0]["text"].startswith("Sent from @desk:")
    # One turned off for AI apps sends none.
    assert _notify(client, auth, "off", {"title": "Hidden"})["isError"] is True
    got = client.get("/api/v1/notifications", headers=me).json()["notifications"]
    assert [(n["title"], n["agent"]) for n in got] == [("From desk", "desk")]
    # Kept by id: renamed, it shows the new handle; deleted, none.
    desk = _agents(client, me)["desk"]
    assert client.put(f"/api/v1/agents/{desk}", json={"name": "bureau"}, headers=me).status_code == 200
    assert client.get("/api/v1/notifications", headers=me).json()["notifications"][0]["agent"] == "bureau"
    assert client.delete(f"/api/v1/agents/{desk}", headers=me).status_code == 204
    assert client.get("/api/v1/notifications", headers=me).json()["notifications"][0]["agent"] is None


@needs_db
def test_wysebees_own_agent_gets_its_row_when_it_first_sends_one(client: TestClient, me: dict[str, str], migrated_db_url: str):  # noqa: F811
    auth = _signed(client, me)
    with create_engine(migrated_db_url).begin() as conn:
        assert conn.execute(text("SELECT count(*) FROM user_agents WHERE user_id = :u"), {"u": me["X-Test-User"]}).scalar() == 0
    assert _notify(client, auth, "wysebee", {"title": "Hello"})["isError"] is False
    assert client.get("/api/v1/notifications", headers=me).json()["notifications"][0]["agent"] == "wysebee"
    with create_engine(migrated_db_url).begin() as conn:
        assert conn.execute(text("SELECT name FROM user_agents WHERE user_id = :u"), {"u": me["X-Test-User"]}).scalars().all() == ["wysebee"]


@needs_db
def test_a_person_keeps_their_newest(client: TestClient, me: dict[str, str], monkeypatch):  # noqa: F811
    monkeypatch.setattr(notifications, "KEEP", 2)
    state = client.app.state

    async def three() -> None:
        for title in ("one", "two", "three"):
            async with state.db.sessionmaker() as session:
                await notifications.send(session, me["X-Test-User"], title, "")

    client.portal.call(three)
    got = client.get("/api/v1/notifications", headers=me).json()["notifications"]
    assert [n["title"] for n in got] == ["three", "two"]


@needs_db
def test_the_change_feed_announces_the_unread_count_at_once(ui_dist, migrated_db_url):
    import uuid

    import httpx

    from apps.cloud.main import create_app

    sub = f"test-{uuid.uuid4().hex}"
    # A long heartbeat: only the LISTEN/NOTIFY wake-up can deliver it this fast.
    settings = Settings(database_url=migrated_db_url, config_events_heartbeat_seconds=30, config_events_max_seconds=30)
    listener = create_app(ui_dist=ui_dist, settings=settings)
    listener.dependency_overrides[current_user] = _fake_user
    try:
        with live_server(listener) as base, feed_client(ui_dist, migrated_db_url) as writer:
            deadline = time.time() + 5
            while not listener.state.change_hub.listening and time.time() < deadline:
                time.sleep(0.05)
            with httpx.stream("GET", f"{base}/api/v1/configs/events", headers={"X-Test-User": sub}, timeout=10) as r:
                lines = r.iter_lines()

                def next_frame() -> list[str]:
                    got = []
                    for line in lines:
                        if line == "":
                            return got
                        got.append(line)
                    return got  # pragma: no cover - the stream ended

                assert next_frame()[0] == "event: hello"

                async def send() -> None:
                    async with writer.app.state.db.sessionmaker() as session:
                        await notifications.send(session, sub, "Done", "")

                started = time.time()
                writer.portal.call(send)
                frame = next_frame()
                assert frame[0] == "event: activity" and json.loads(frame[1][6:]) == {"unread": 1}
                assert time.time() - started < 1
                writer.post("/api/v1/notifications/read", headers={"X-Test-User": sub})
                frame = next_frame()
                assert frame[0] == "event: activity" and json.loads(frame[1][6:]) == {"unread": 0}
    finally:
        engine = create_engine(migrated_db_url)
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM user_notifications WHERE user_id = :u"), {"u": sub})
        engine.dispose()
