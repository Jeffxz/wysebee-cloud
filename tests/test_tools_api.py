"""Tools (apps/cloud/user_tools.py): the person's library, by id, and their agents' tools,
against a real database (skipped without WYSEBEE_TEST_DATABASE_URL). The connections' own
checks and runs are test_cloud_postgres.py's and test_cloud_snowflake.py's; a Mac's programs
test_cloud_agent_mac.py's and test_browser_links.py's."""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud import user_tools
from tests.cloud_agent_fixtures import _agent, _agent_id, _save_tool, client, me  # noqa: F401 — fixtures
from tests.conftest import needs_db

pytestmark = needs_db

SITE = {"description": "Work mail", "config": {"address": "https://mail.google.com/mail/u/0/"}}
PROGRAM = {"name": "word_count", "description": "Count words", "config": {"command": "wc", "args": [{"value": "-w"}]}}


def detail(r) -> tuple[int, str]:
    return r.status_code, r.json()["detail"]


def post(client: TestClient, me: dict[str, str], kind: str, body: dict):
    return client.post("/api/v1/tools", json={"kind": kind, **body}, headers=me)


def test_a_site_link_is_kept_by_its_address_renamed_and_deleted_by_its_id(client: TestClient, me: dict[str, str]) -> None:
    made = post(client, me, "gmail", {**SITE, "name": "ignored"}).json()
    assert (made["kind"], made["name"], made["description"], made["config"], made["has_secret"]) == ("gmail", SITE["config"]["address"], "Work mail", SITE["config"], False)
    assert client.get(f"/api/v1/tools/{made['id']}", headers=me).json() == made
    # Another address is a rename: the same id.
    moved = client.put(f"/api/v1/tools/{made['id']}", json={"description": "Mail", "config": {"address": "https://mail.google.com/mail/u/1/"}}, headers=me).json()
    assert (moved["id"], moved["name"], moved["description"]) == (made["id"], "https://mail.google.com/mail/u/1/", "Mail")
    # Each kind's list, or all; another person's none.
    post(client, me, "website", {"description": "Docs", "config": {"address": "http://docs.example.com/a"}})
    assert [t["kind"] for t in client.get("/api/v1/tools", headers=me).json()["tools"]] == ["gmail", "website"]
    assert [t["kind"] for t in client.get("/api/v1/tools?kind=website", headers=me).json()["tools"]] == ["website"]
    assert detail(client.get("/api/v1/tools?kind=docker", headers=me))[0] == 422
    assert client.get(f"/api/v1/tools/{made['id']}", headers={"X-Test-User": "someone-else"}).status_code == 404
    assert client.delete(f"/api/v1/tools/{made['id']}", headers=me).status_code == 204
    assert client.get(f"/api/v1/tools/{made['id']}", headers=me).status_code == 404


def test_a_tool_is_checked_by_its_kind(client: TestClient, me: dict[str, str], monkeypatch) -> None:
    bad = [
        ("docker", SITE, "A tool's kind is one of"),
        ("gmail", {**SITE, "config": {"address": "https://example.com/"}}, "starts with https://mail.google.com/"),
        ("website", {**SITE, "config": {"address": "ftp://example.com/"}}, "starts with https://"),
        ("website", {**SITE, "config": {"address": "https:///nohost"}}, "starts with https://"),
        ("news", {**SITE, "config": {"address": "https://a b.com/"}}, "starts with https://"),
        ("news", {**SITE, "config": {}}, "starts with https://"),
        ("news", {**SITE, "config": {"address": "https://x.com/" + "a" * 2048}}, "starts with https://"),
        ("travel", {"description": "", "config": {"address": "https://x.com/"}}, "Say what the link is for"),
        ("travel", {"description": "two\nlines", "config": {"address": "https://x.com/"}}, "Say what the link is for"),
        ("program", {**PROGRAM, "name": "Word"}, "A program has a name"),
        ("program", {**PROGRAM, "config": {"command": " "}}, "A program has a name"),
        ("program", {**PROGRAM, "config": {"command": "wc", "args": [{"param": "a"}, {"param": "a"}]}}, "named once"),
    ]
    for kind, body, said in bad:
        status, why = detail(post(client, me, kind, body))
        assert status == 422 and said in why, (kind, body, why)
    # A name is the person's once in each kind; a site link's address too.
    program = post(client, me, "program", PROGRAM).json()
    assert detail(post(client, me, "program", PROGRAM)) == (409, "There is already a program tool named 'word_count'.")
    other = post(client, me, "program", {**PROGRAM, "name": "other"}).json()
    assert detail(client.put(f"/api/v1/tools/{other['id']}", json=PROGRAM, headers=me)) == (409, "There is already a program tool named 'word_count'.")
    assert detail(client.put(f"/api/v1/tools/{other['id']}", json={**PROGRAM, "kind": "website"}, headers=me)) == (422, "A tool's kind cannot change.")
    assert client.put(f"/api/v1/tools/{other['id']}", json={**PROGRAM, "kind": "program", "name": "other"}, headers=me).status_code == 200
    # …a clash the check could not see is the same 409.
    async def free(*args, **kwargs) -> None:
        return None

    monkeypatch.setattr(user_tools, "_taken", free)
    assert detail(post(client, me, "program", PROGRAM)) == (409, "There is already a program tool named 'word_count'.")
    monkeypatch.undo()
    # At most so many in all.
    monkeypatch.setattr(user_tools, "MAX_TOOLS", 2)
    assert detail(post(client, me, "program", {**PROGRAM, "name": "third"})) == (422, "You have at most 2 tools. Delete one first.")
    # A secret sent with what is not a connection is ignored.
    assert client.put(f"/api/v1/tools/{program['id']}", json={**PROGRAM, "secret": "x"}, headers=me).json()["has_secret"] is False


def test_no_tool_or_another_persons_is_not_found(client: TestClient, me: dict[str, str]) -> None:
    made = post(client, me, "website", {**SITE, "config": {"address": "https://example.com/"}}).json()
    someone = {"X-Test-User": f"test-{uuid.uuid4().hex}"}
    for who, tool_id in ((someone, made["id"]), (me, str(uuid.uuid4())), (me, "-" * 32)):
        assert client.get(f"/api/v1/tools/{tool_id}", headers=who).status_code == 404, tool_id
        assert client.delete(f"/api/v1/tools/{tool_id}", headers=who).status_code == 404, tool_id
    assert client.get("/api/v1/tools/not-an-id", headers=me).status_code == 422


def test_an_agent_is_given_tools_of_a_kind_in_order(client: TestClient, me: dict[str, str], migrated_db_url: str) -> None:
    _agent(client, me, "sky", {"label": "Sky"})
    url = f"/api/v1/agents/{_agent_id(client, me, 'sky')}/tools"
    a = _save_tool(client, me, "postgres", "a", config={"host": "db.example.com", "database": "x", "user": "r"}).json()
    b = _save_tool(client, me, "postgres", "b", config={"host": "db.example.com", "database": "y", "user": "r"}).json()
    site = post(client, me, "website", {**SITE, "config": {"address": "https://example.com/"}}).json()
    r = client.put(url, json={"kind": "postgres", "tool_ids": [b["id"], a["id"].upper()]}, headers=me)
    assert r.status_code == 200, r.text
    assert [t["name"] for t in r.json()["tools"]] == ["b", "a"]
    # Refused: not ids, twice, another kind's, none; another person's agent, or none.
    assert detail(client.put(url, json={"kind": "postgres", "tool_ids": ["nope"]}, headers=me)) == (422, "'tool_ids' holds tools' ids.")
    assert detail(client.put(url, json={"kind": "postgres", "tool_ids": [a["id"], a["id"]]}, headers=me)) == (422, "A tool is in 'tool_ids' twice.")
    assert detail(client.put(url, json={"kind": "postgres", "tool_ids": [site["id"]]}, headers=me)) == (404, "There is no such postgres tool.")
    assert detail(client.put(url, json={"kind": "docker", "tool_ids": []}, headers=me))[0] == 422
    someone = {"X-Test-User": f"test-{uuid.uuid4().hex}"}
    for who, path in ((someone, url), (me, f"/api/v1/agents/{uuid.uuid4()}/tools"), (me, f"/api/v1/agents/{'-' * 32}/tools")):
        assert detail(client.get(path, headers=who)) == (404, "There is no such agent.")
        assert client.put(path, json={"kind": "postgres", "tool_ids": []}, headers=who).status_code == 404
    assert client.get("/api/v1/agents/nobody/tools", headers=me).status_code == 422
    # A tool deleted leaves the agent.
    assert client.delete(f"/api/v1/tools/{a['id']}", headers=me).status_code == 204
    assert [t["name"] for t in client.get(url, headers=me).json()["tools"]] == ["b"]
    # The agent renamed keeps its tools; deleted, its links go and the tools stay.
    agent = _agent_id(client, me, "sky")
    assert client.put(f"/api/v1/agents/{agent}", json={"name": "skye"}, headers=me).status_code == 200
    assert [t["name"] for t in client.get(url, headers=me).json()["tools"]] == ["b"]
    assert client.delete(f"/api/v1/agents/{agent}", headers=me).status_code == 204
    assert client.get(url, headers=me).status_code == 404
    with create_engine(migrated_db_url).begin() as conn:
        assert conn.execute(text("SELECT count(*) FROM agent_tools WHERE agent_id = :a"), {"a": agent}).scalar() == 0
    assert {t["name"] for t in client.get("/api/v1/tools?kind=postgres", headers=me).json()["tools"]} == {"b"}
