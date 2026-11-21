"""Who made and last changed each agent, tool, skill, workspace and task (apps/cloud/people.py,
migration 0066): stamped on every save, answered as ``{id, name, email}`` from ``users``."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud import people
from tests.cloud_agent_fixtures import _client, _skill, me  # noqa: F401 — fixtures
from tests.conftest import needs_db

pytestmark = needs_db


@pytest.fixture
def client(ui_dist: Path, migrated_db_url: str, tmp_path: Path) -> Iterator[TestClient]:
    c = _client(ui_dist, migrated_db_url, tmp_path, workspace_dir=tmp_path / "workspaces")
    yield c
    c.__exit__(None, None, None)


def _profile(url: str, sub: str, **fields: str) -> None:
    with create_engine(url).begin() as conn:
        conn.execute(text("INSERT INTO users (user_id, email, name, display_name) VALUES (:u, :e, :n, :d)"), {
            "u": sub, "e": fields.get("email", ""), "n": fields.get("name", ""), "d": fields.get("display_name", ""),
        })


def _set(url: str, table: str, key: str, value: str, column: str, to: str) -> None:
    with create_engine(url).begin() as conn:
        conn.execute(text(f"UPDATE {table} SET {column} = :to WHERE {key} = :v"), {"to": to, "v": value})


def test_each_kind_is_made_and_changed_by_its_caller(client: TestClient, me: dict[str, str], migrated_db_url: str) -> None:
    sub = me["X-Test-User"]
    _profile(migrated_db_url, sub, email="sam@example.com", name="Sam Smith", display_name="Sam")
    sam = {"id": sub, "name": "Sam", "email": "sam@example.com"}
    agent = client.post("/api/v1/agents", json={"name": "helper", "config": {"label": "Helper"}}, headers=me).json()
    tool = client.post("/api/v1/tools", json={"kind": "website", "description": "Docs.", "config": {"address": "https://x.test"}}, headers=me).json()
    skill = _skill(client, me, "forecast")
    workspace = client.post("/api/v1/workspaces", json={"name": "Docs"}, headers=me).json()
    task = client.post("/api/v1/tasks", json={"name": "Daily"}, headers=me).json()
    for made in (agent, tool, skill, workspace, task):
        assert (made["created_by"], made["updated_by"]) == (sam, sam)
    assert task["creator"] == "sam@example.com"
    # Listed so too.
    assert client.get("/api/v1/agents", headers=me).json()["agents"][1]["created_by"] == sam
    assert client.get("/api/v1/tools", headers=me).json()["tools"][0]["updated_by"] == sam
    assert client.get("/api/v1/skills", headers=me).json()["skills"][0]["created_by"] == sam
    assert client.get("/api/v1/workspaces", headers=me).json()["workspaces"][0]["created_by"] == sam
    assert client.get("/api/v1/tasks", headers=me).json()["rows"][0]["updated_by"] == sam

    # Someone else changed each last (as an editor will); the caller's change is theirs again.
    for table, key, value in (
        ("user_agents", "agent_id", agent["id"]), ("user_tools", "tool_id", tool["id"]), ("user_skills", "skill_id", skill["id"]),
        ("user_workspaces", "workspace_id", workspace["id"]), ("user_tasks", "task_id", task["id"]),
    ):
        _set(migrated_db_url, table, key, value, "updated_by", "someone-else")
    nobody = {"id": "someone-else", "name": "", "email": ""}
    assert client.get(f"/api/v1/agents/{agent['id']}", headers=me).json()["updated_by"] == nobody
    assert client.put(f"/api/v1/agents/{agent['id']}", json={"name": "aide"}, headers=me).json()["updated_by"] == sam
    assert client.put(f"/api/v1/tools/{tool['id']}", json={"description": "Docs.", "config": {"address": "https://y.test"}}, headers=me).json()["updated_by"] == sam
    files = skill["files"]
    assert client.put(f"/api/v1/skills/{skill['id']}", json={"name": "weather", "description": "W.", "files": files}, headers=me).json()["updated_by"] == sam
    assert client.put(f"/api/v1/workspaces/{workspace['id']}", json={"name": "Guides"}, headers=me).json()["updated_by"] == sam
    assert client.put(f"/api/v1/tasks/{task['id']}", json={"name": "Nightly"}, headers=me).json()["updated_by"] == sam
    # A file of a workspace is a change to it; who made it stays.
    _set(migrated_db_url, "user_workspaces", "workspace_id", workspace["id"], "updated_by", "someone-else")
    assert client.put(f"/api/v1/workspaces/{workspace['id']}/files/notes.md", json={"content": "x"}, headers=me).status_code == 200
    detail = client.get(f"/api/v1/workspaces/{workspace['id']}", headers=me).json()
    assert (detail["created_by"], detail["updated_by"]) == (sam, sam)


def test_a_person_the_cloud_knows_nothing_of_is_named_by_id_only(client: TestClient, me: dict[str, str], migrated_db_url: str) -> None:
    sub = me["X-Test-User"]
    task = client.post("/api/v1/tasks", json={"name": "Daily"}, headers=me).json()
    assert (task["created_by"], task["creator"]) == ({"id": sub, "name": "", "email": ""}, None)
    # A name with no display name is the name.
    _profile(migrated_db_url, sub, name="Sam Smith")
    assert client.get(f"/api/v1/tasks/{task['id']}", headers=me).json()["created_by"]["name"] == "Sam Smith"
    assert people.named({}, None) == people.Person(id="", name="", email="")

