"""Agent types (apps/cloud/agent_types.py; 2026-11-13, later): the rows, read and checked,
cached a minute, and listed for the apps."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud import agent_types
from tests.cloud_agent_fixtures import _client, me  # noqa: F401 — fixtures
from tests.conftest import needs_db

GOOD = {"id": "6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c09", "key": "wysebee-test", "name": " Test Agent ", "description": "", "link_field": "mac_link", "ops": ["ping"], "tool_kinds": [], "enabled": True}


def test_a_row_is_a_type_only_within_the_tables_limits(monkeypatch) -> None:
    good = agent_types.parse(SimpleNamespace(**GOOD))
    assert good == agent_types.AgentType(GOOD["id"], "wysebee-test", "Test Agent", "", "mac_link", frozenset({"ping"}), frozenset(), True)
    assert (good.kind, good.out()) == ("osx", {"id": GOOD["id"], "key": "wysebee-test", "name": "Test Agent"})
    assert agent_types.parse(SimpleNamespace(**{**GOOD, "key": "wysebee-" + "a" * 56, "name": "n" * 60, "description": "d" * 500, "ops": [f"op_{i}" for i in range(100)]})) is not None
    bad = [
        {"key": "wysebee"}, {"key": "wysebee-" + "a" * 57}, {"key": "other-agent"}, {"key": "wysebee-Chrome"}, {"key": None},
        {"name": "  "}, {"name": "n" * 61}, {"name": 5}, {"description": "d" * 501}, {"description": None},
        {"link_field": "phone_link"}, {"ops": "ping"}, {"ops": ["ping", "ping"]}, {"ops": ["Ping"]}, {"ops": [5]}, {"ops": [{"a": 1}, {"a": 1}]},
        {"ops": [f"op_{i}" for i in range(101)]}, {"tool_kinds": None}, {"tool_kinds": ["x" * 65]}, {"enabled": "yes"},
    ]
    said: list[str] = []
    monkeypatch.setattr(agent_types.logger, "warning", lambda message, *args: said.append(message % args))
    for over in bad:
        assert agent_types.parse(SimpleNamespace(**{**GOOD, **over})) is None, over
    # Each is logged, by its id (never its contents), and left out.
    assert len(said) == len(bad) and said[0] == f"agent type {GOOD['id']} is not one: it breaks the table's limits, and is left out"


class Session:
    """A session whose table holds ``rows``, counting the reads."""

    def __init__(self, rows) -> None:
        self.rows, self.reads = rows, 0

    async def execute(self, _):
        self.reads += 1
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: self.rows))


def test_the_rows_are_read_at_most_a_minute_ago_enabled_first(monkeypatch) -> None:
    now = [1000.0]
    monkeypatch.setattr(agent_types.time, "monotonic", lambda: now[0])
    off = SimpleNamespace(**{**GOOD, "id": "6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c0a", "key": "wysebee-a-off", "enabled": False})
    session = Session([off, SimpleNamespace(**GOOD), SimpleNamespace(**{**GOOD, "key": "broken!"})])
    run = asyncio.run
    assert [t.key for t in run(agent_types.all_types(session))] == ["wysebee-test", "wysebee-a-off"]
    now[0] += 59
    run(agent_types.all_types(session))
    assert session.reads == 1
    now[0] += 1
    assert run(agent_types.by_id(session, GOOD["id"])).key == "wysebee-test" and session.reads == 2
    assert run(agent_types.by_id(session, "nobody")) is None
    # Starting: an enabled type's key; a disabled one, an unknown one or not text is none.
    assert run(agent_types.for_start(session, "wysebee-test")).id == GOOD["id"]
    for kind in ("wysebee-a-off", "wysebee-nobody", 7, ["wysebee-test"]):
        assert run(agent_types.for_start(session, kind)) is None, kind
    # Builds from before types: "osx", "browser" or nothing name the seeded types.
    seeded = Session([SimpleNamespace(**{**GOOD, "id": agent_types.OSX_ID, "key": agent_types.OSX}), SimpleNamespace(**{**GOOD, "id": agent_types.CHROME_ID, "key": agent_types.CHROME, "link_field": "browser_link"})])
    agent_types.forget()
    assert [run(agent_types.for_start(seeded, k)).key for k in ("osx", "browser", None)] == [agent_types.OSX, agent_types.CHROME, agent_types.CHROME]


@pytest.fixture
def client(ui_dist, migrated_db_url, tmp_path):  # noqa: F811
    c = _client(ui_dist, migrated_db_url, tmp_path)
    yield c
    c.__exit__(None, None, None)


@needs_db
def test_the_types_are_listed_for_the_apps_signed_in(client: TestClient, me: dict[str, str], migrated_db_url: str) -> None:  # noqa: F811
    seeded = [
        {"id": agent_types.ANDROID_ID, "key": "wysebee-android", "name": "Wysebee Android Agent", "description": "An agent that operates your Android phone as you would — reads the screen, taps, types, swipes and opens apps — only in the apps you allow, through Wysebee Agent for Android.", "enabled": True},
        {"id": agent_types.CHROME_ID, "key": "wysebee-browser-chrome", "name": "Wysebee Chrome Agent", "description": "An agent that works in your Chrome browser, through the Wysebee Agent extension.", "enabled": True},
        {"id": agent_types.LINUX_ID, "key": "wysebee-linux", "name": "Wysebee Linux Agent", "description": "An agent that runs the programs, skill scripts, folder and developer tools you allow on your Linux machine or server, through Wysebee Agent for Linux.", "enabled": True},
        {"id": agent_types.OSX_ID, "key": "wysebee-osx", "name": "Wysebee OSX Agent", "description": "An agent that runs the programs, skill scripts and folder tools you allow on your Mac, through Wysebee Agent for Mac.", "enabled": True},
        {"id": agent_types.WINDOWS_ID, "key": "wysebee-windows", "name": "Wysebee Windows Agent", "description": "An agent that runs the programs, skill scripts and folder tools you allow on your Windows PC, through Wysebee Agent for Windows.", "enabled": True},
    ]
    def names(types: list[dict]) -> list[dict]:
        return [{k: t[k] for k in ("id", "key", "name", "description", "enabled")} for t in types]

    got = client.get("/api/v1/agent-types", headers=me).json()["types"]
    assert names(got) == seeded
    # Each with its link, the tools only its agents may have (the row's) and the switches its
    # pack draws that the row allows: a Linux machine has no screen, only a Mac the iPhone toolkit.
    by_key = {t["key"]: t for t in got}
    assert (by_key["wysebee-android"]["kind"], by_key["wysebee-android"]["link_field"], by_key["wysebee-android"]["settings"]) == ("android", "android_link", [])
    assert [s["field"] for s in by_key["wysebee-browser-chrome"]["settings"]] == ["browser_access", "browser_devtools"]
    assert by_key["wysebee-browser-chrome"]["settings"][1] == {"field": "browser_devtools", "label": "Web development tools", "tool_kind": "devtools", "description": ""}
    assert "devtools" in by_key["wysebee-browser-chrome"]["tool_kinds"]
    switches = {k: [s["field"] for s in by_key[k]["settings"]] for k in ("wysebee-osx", "wysebee-windows", "wysebee-linux")}
    assert switches == {
        "wysebee-osx": ["run_any_program", "screen_control", "developer_access", "android_toolkit", "ios_toolkit"],
        "wysebee-windows": ["run_any_program", "screen_control", "developer_access", "android_toolkit"],
        "wysebee-linux": ["run_any_program", "developer_access", "android_toolkit"],
    }

    def listed() -> list[dict]:
        return names(client.get("/api/v1/agent-types", headers=me).json()["types"])

    # Disabled by Admin: listed after the enabled ones, once the minute is up.
    engine = create_engine(migrated_db_url)
    try:
        with engine.begin() as conn:
            conn.execute(text("UPDATE agent_types SET enabled = false WHERE key = 'wysebee-browser-chrome'"))
        assert listed() == seeded
        agent_types.forget()
        assert listed() == [seeded[0], seeded[2], seeded[3], seeded[4], {**seeded[1], "enabled": False}]
    finally:
        with engine.begin() as conn:
            conn.execute(text("UPDATE agent_types SET enabled = true WHERE key = 'wysebee-browser-chrome'"))
        engine.dispose()
