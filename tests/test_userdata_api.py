"""The user data routes against a real database (skipped without
WYSEBEE_TEST_DATABASE_URL), except the sign-in check, which needs none.

The caller is faked by overriding ``current_user`` with the X-Test-User header, as in
test_assets_api.py.
"""

import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import Header
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud.auth import User, current_user
from apps.cloud.userdata import TABLES
from tests.conftest import make_client, needs_db


def _fake_user(x_test_user: str = Header()) -> User:
    return User(sub=x_test_user)


@pytest.fixture
def client(ui_dist: Path, migrated_db_url: str) -> Iterator[TestClient]:
    with make_client(ui_dist, database_url=migrated_db_url) as c:
        c.app.dependency_overrides[current_user] = _fake_user
        yield c


@pytest.fixture
def users(migrated_db_url: str) -> Iterator[list[str]]:
    subs = [f"test-{uuid.uuid4().hex}" for _ in range(2)]
    yield subs
    engine = create_engine(migrated_db_url)
    with engine.begin() as conn:
        for table in ("user_topics", "user_conversations", "user_task_runs", "user_tasks", "user_reminders", "user_settings", "user_nav_order", "cloud_config_heads"):
            conn.execute(text(f"DELETE FROM {table} WHERE user_id = ANY(:u)"), {"u": subs})
    engine.dispose()


def test_needs_sign_in(ui_dist: Path) -> None:
    with make_client(ui_dist) as c:
        assert c.get("/api/v1/data/reminders").status_code in (401, 503)


@needs_db
def test_rows_are_the_callers_and_round_trip(client: TestClient, users: list[str]) -> None:
    me, other = ({"X-Test-User": u} for u in users)
    # A reminder: stored whole, its key from the path; listed in order; another person sees nothing.
    r = client.put("/api/v1/data/reminders/t2", json={"text": "Work", "due_at": "2026-10-25T10:00:00Z", "created_at": "2026-10-24T10:00:00Z"}, headers=me)
    assert r.json()["id"] == "t2" and r.json()["text"] == "Work" and r.json()["created_at"] == "2026-10-24T10:00:00Z"
    client.put("/api/v1/data/reminders/t1", json={"text": "Home", "due_at": "2026-10-24T10:00:00Z"}, headers=me)
    assert [t["id"] for t in client.get("/api/v1/data/reminders", headers=me).json()["rows"]] == ["t1", "t2"]
    assert client.get("/api/v1/data/reminders", headers=other).json() == {"rows": []}
    assert client.get("/api/v1/data/reminders/t1", headers=other).status_code == 404
    # An update replaces the row.
    assert client.put("/api/v1/data/reminders/t2", json={"text": "WORK", "due_at": "2026-10-25T10:00:00Z"}, headers=me).status_code == 200
    assert client.get("/api/v1/data/reminders/t2", headers=me).json()["text"] == "WORK"
    # Home's topics and conversations went with chat (2026-11-14).
    assert client.get("/api/v1/data/topics", headers=me).status_code == 404
    assert client.put("/api/v1/data/conversations/chat", json={"messages": []}, headers=me).status_code == 404

    # Task runs: of a task of the person's (apps/cloud/tasks.py), newest first, by task; a task's
    # runs deleted at once.
    a, b = (client.post("/api/v1/tasks", json={"name": n}, headers=me).json()["id"] for n in ("A", "B"))
    for run, task, started in [("r1", a, "1"), ("r2", a, "2"), ("r3", b, "3")]:
        assert client.put(f"/api/v1/data/task_runs/{run}", json={"task_id": task, "status": "succeeded", "started_at": started, "messages": [{"role": "user"}]}, headers=me).status_code == 200
    assert [r["run_id"] for r in client.get(f"/api/v1/data/task_runs?task_id={a}", headers=me).json()["rows"]] == ["r2", "r1"]
    assert [r["run_id"] for r in client.get("/api/v1/data/task_runs?limit=1", headers=me).json()["rows"]] == ["r3"]
    assert client.delete(f"/api/v1/data/task_runs?task_id={a.replace('-', '')}", headers=me).json() == {"deleted": 2}
    assert client.delete("/api/v1/data/task_runs", headers=me).status_code == 422
    # A task that is not one, or no task at all: refused, not a database error.
    for task in ("a", str(uuid.uuid4())):
        assert client.put("/api/v1/data/task_runs/r9", json={"task_id": task, "status": "x"}, headers=me).status_code == 422
    assert client.get("/api/v1/data/task_runs?task_id=a", headers=me).status_code == 422
    assert client.delete("/api/v1/data/task_runs?task_id=a", headers=me).status_code == 422

    # Settings and the Tasks order.
    client.put("/api/v1/data/settings/shared", json={"config": {"language": "fr"}}, headers=me)
    assert client.get("/api/v1/data/settings/shared", headers=me).json()["config"] == {"language": "fr"}
    client.put("/api/v1/data/nav_order/tasks", json={"config": {"order": ["a"]}}, headers=me)
    assert client.get("/api/v1/data/nav_order", headers=me).json()["rows"][0]["scope"] == "tasks"

    # Deletes.
    assert client.delete("/api/v1/data/reminders/t1", headers=me).status_code == 204
    assert client.delete("/api/v1/data/reminders/t1", headers=me).status_code == 404


@needs_db
def test_reminders_are_delivered_once(client: TestClient, users: list[str]) -> None:
    me = {"X-Test-User": users[0]}
    client.put("/api/v1/data/reminders/soon", json={"text": "Tea", "due_at": "2026-01-01T00:00:00Z"}, headers=me)
    client.put("/api/v1/data/reminders/later", json={"text": "Walk", "due_at": "2099-01-01T00:00:00Z"}, headers=me)
    due = client.get("/api/v1/data/reminders?pending=1&due_before=2026-06-01T00:00:00Z", headers=me).json()["rows"]
    assert [r["id"] for r in due] == ["soon"]
    assert client.post("/api/v1/data/reminders/soon/deliver", headers=me).json() == {"delivered": True}
    assert client.post("/api/v1/data/reminders/soon/deliver", headers=me).json() == {"delivered": False}
    assert client.post("/api/v1/data/reminders/nope/deliver", headers=me).status_code == 404
    assert [r["id"] for r in client.get("/api/v1/data/reminders?pending=1", headers=me).json()["rows"]] == ["later"]


@needs_db
def test_what_cannot_be_stored_is_refused(client: TestClient, users: list[str]) -> None:
    me = {"X-Test-User": users[0]}
    assert client.get("/api/v1/data/secrets", headers=me).status_code == 404
    assert client.put("/api/v1/data/settings/a b", json={"config": {}}, headers=me).status_code == 422
    assert client.put("/api/v1/data/settings/x", json={"config": {}, "nope": 1}, headers=me).status_code == 422
    assert client.put("/api/v1/data/settings/x", json=[1], headers=me).status_code == 422
    assert client.put("/api/v1/data/settings/x", content=b"not json", headers=me).status_code == 422
    big = "x" * (TABLES["settings"].max_bytes + 1)
    assert client.put("/api/v1/data/settings/x", json={"config": {"v": big}}, headers=me).status_code == 413
    # A missing required column cannot be stored.
    assert client.put("/api/v1/data/reminders/r", json={"text": "no due time"}, headers=me).status_code == 422
