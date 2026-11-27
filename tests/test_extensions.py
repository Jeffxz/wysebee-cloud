"""Extensions (apps/cloud/extensions.py): loading them, their policy asked at every point it
decides — routes, pairing, calls, Wysebee Assistant's tools, tasks — their routes and what the
pages are told, and their own migrations. The extension is the tests' own
(tests/fake_extension); the database tests are skipped without WYSEBEE_TEST_DATABASE_URL."""

import asyncio
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud import extensions
from apps.cloud.config import Settings
from apps.cloud.extensions import API, Extension, Policy
from tests import fake_extension
from tests.cloud_agent_fixtures import _client
from tests.conftest import make_client, needs_db
from tests.test_agent_mcp import _call, _signed, fake_verifier  # noqa: F401 — fixtures
from tests.test_browser_links import BASE, FAST, Extension as Device, refusal
from tests.test_task_runner import _due_now, _run_due, _task

FAKE = "tests.fake_extension"


# --- pure ------------------------------------------------------------------------------------


def test_the_settings_name_the_extensions_and_each_must_match_the_interface() -> None:
    assert extensions.names(Settings()) == []
    assert extensions.names(Settings(extensions=f" {FAKE} , ,tests.old_extension")) == [FAKE, "tests.old_extension"]
    [ext] = extensions.load(Settings(extensions=FAKE))
    assert ext.name == FAKE and ext.web_features == {"billing": True}
    with pytest.raises(RuntimeError, match="extension API 3"):
        extensions.load(Settings(extensions="tests.old_extension"))
    with pytest.raises(ModuleNotFoundError):
        extensions.load(Settings(extensions="tests.no_such_extension"))


def test_the_last_policy_decides_and_the_default_refuses_nothing() -> None:
    assert type(extensions.policy_of([])) is Policy
    mine, theirs = Policy(), Policy()
    assert extensions.policy_of([Extension("a", API, policy=mine), Extension("b", API, policy=theirs), Extension("c", API)]) is theirs
    assert extensions.web_features([Extension("a", API, web_features={"billing": True, "x": True}), Extension("b", API, web_features={"x": False})]) == {"billing": True, "x": False}
    default = Policy()
    now = datetime.now(UTC)
    said = [asyncio.run(c) for c in (default.may_use(None, "u"), default.may_pair(None, "u"), default.may_call(None, "u", "l", now), default.may_share(None, "u"), default.storage_quota(None, "u"))]
    assert said == [None, None, None, None, None]


def test_without_an_extension_the_pages_get_no_billing(ui_dist: Path) -> None:
    with make_client(ui_dist) as c:
        assert c.get("/api/v1/web/config").json()["features"] == {"billing": False}
        assert c.get("/api/v1/plan").status_code != 200


def test_an_extensions_routes_and_features_are_served(ui_dist: Path) -> None:
    with make_client(ui_dist, extensions=FAKE) as c:
        assert c.get("/api/v1/web/config").json()["features"] == {"billing": True}
        assert c.get("/api/v1/plan").json() == {"allowed": True}


# --- with the database ------------------------------------------------------------------------


@pytest.fixture
def client(ui_dist: Path, migrated_db_url: str, tmp_path: Path) -> Iterator[TestClient]:
    c = _client(ui_dist, migrated_db_url, tmp_path, [fake_extension.register(None)], browser_link_starts_per_minute=10_000, **FAST)
    yield c
    c.__exit__(None, None, None)
    with create_engine(migrated_db_url).begin() as conn:
        conn.execute(text("DELETE FROM browser_links WHERE user_id IS NULL"))


@pytest.fixture
def person(migrated_db_url: str) -> Iterator[callable]:
    made: list[str] = []

    def make(kind: str) -> dict[str, str]:
        made.append(f"test-{kind}-{uuid.uuid4().hex}")
        return {"X-Test-User": made[-1]}

    yield make
    with create_engine(migrated_db_url).begin() as conn:
        for table in ("browser_calls", "browser_links", "user_task_runs", "task_schedules", "user_tasks", "user_notifications", "agent_tools", "user_agents", "relay_traffic", "ai_turn_counts", "cloud_config_heads", "users"):
            conn.execute(text(f"DELETE FROM {table} WHERE user_id = ANY(:u)"), {"u": made})


@needs_db
def test_a_refused_person_reaches_only_their_account(client: TestClient, person) -> None:
    me = person("no-use")
    r = client.get("/api/v1/agents", headers=me)
    assert (r.status_code, r.json()) == (402, {"detail": "Choose a plan.", "code": "no_plan", "billing_url": "/billing"})
    assert client.get("/api/v1/pages/" + str(uuid.uuid4()), headers=me).status_code == 402
    for path in ("/api/v1/profile", "/api/v1/storage", "/api/v1/tool-calls", "/api/v1/browser-links", "/api/v1/plan"):
        assert client.get(path, headers=me).status_code == 200, path
    assert client.get("/api/v1/tool-calls", headers=me).json()["billing_url"] == "http://testserver/app/#/account/billing"
    # Anyone else: everything.
    assert client.get("/api/v1/agents", headers=person("fine")).status_code == 200


@needs_db
def test_pairing_and_calls_are_as_the_policy_says(client: TestClient, person) -> None:
    pairing, calling = person("no-pair"), person("no-call")
    device = Device(client, "Scout")
    r = client.post(f"{BASE}/claim", json={"code": device.code}, headers=pairing)
    assert refusal(r) == (402, "device_limit")
    # The code stays good: someone the policy lets pair takes it.
    assert client.post(f"{BASE}/claim", json={"code": device.code}, headers=calling).status_code == 200
    device.poll()
    r = client.post(f"{BASE}/{device.id}/calls?wait=0", json={"op": "ping"}, headers=calling)
    assert refusal(r) == (402, "relay_limit") and device.id in r.json()["detail"]


@needs_db
def test_wysebee_assistant_and_tasks_say_the_policys_refusal(client: TestClient, person, migrated_db_url: str) -> None:
    me = person("no-use")
    got = _call(client, _signed(client, me), "list_agents", {})
    assert got["isError"] is True and got["content"][0]["text"] == "Choose a plan."
    task_id = _task(client, me, "t", "Check", {"trigger": {"type": "manual"}})
    _due_now(client, me, task_id)
    assert _run_due(client) >= 1
    with create_engine(migrated_db_url).begin() as conn:
        status, output = conn.execute(text("SELECT status, output FROM user_task_runs WHERE task_id = :t"), {"t": task_id}).one()
    assert status == "failed" and "Choose a plan." in output


@needs_db
def test_an_extensions_migrations_run_apart_from_the_servers(migrated_db_url: str) -> None:
    settings = Settings(database_url=migrated_db_url, extensions=FAKE)
    engine = create_engine(migrated_db_url)
    try:
        assert extensions.migrate(settings) == [FAKE]
        # Again: nothing to do. One without migrations is passed over.
        assert extensions.migrate(settings, [Extension("none", API), *extensions.load(settings)]) == [FAKE]
        with engine.begin() as conn:
            assert conn.execute(text("SELECT version_num FROM alembic_version_fake_extension")).scalar() == "f001"
            assert conn.execute(text("SELECT count(*) FROM fake_extension_rows")).scalar() == 0
    finally:
        with engine.begin() as conn:
            conn.execute(text("DROP TABLE IF EXISTS fake_extension_rows"))
            conn.execute(text("DROP TABLE IF EXISTS alembic_version_fake_extension"))
        engine.dispose()
