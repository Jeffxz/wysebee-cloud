"""Deleting an account. The database tests are skipped without WYSEBEE_TEST_DATABASE_URL.

The caller is faked by overriding ``current_user`` with the X-Test-User header, as in
test_userdata_api.py, and Auth0 by httpx's mock transport or a stand-in; what an extension holds,
by one of the tests' own.
"""

import uuid
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from fastapi import Header
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud import account_deletion
from apps.cloud.account_deletion import can_delete_identities, delete_identity, tables_to_erase
from apps.cloud.auth import User, current_user
from apps.cloud.config import Settings
from apps.cloud.extensions import API, Extension, Refusal
from tests.conftest import make_client, needs_db

AUTH0 = {"auth0_mgmt_domain": "tenant.us.auth0.com", "auth0_mgmt_client_id": "id", "auth0_mgmt_client_secret": "secret"}
PNG = b"\x89PNG\r\n\x1a\n" + b"pretend-image"


def _fake_user(x_test_user: str = Header()) -> User:
    return User(sub=x_test_user)


def test_needs_sign_in(ui_dist: Path) -> None:
    with make_client(ui_dist) as c:
        assert c.delete("/api/v1/account").status_code in (401, 503)


def test_refused_before_anything_without_auth0_credentials(ui_dist: Path) -> None:
    with make_client(ui_dist) as c:
        c.app.dependency_overrides[current_user] = _fake_user
        r = c.delete("/api/v1/account", headers={"X-Test-User": "someone"})
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "account_deletion_unavailable"


def test_credentials_are_all_or_nothing() -> None:
    assert not can_delete_identities(Settings(auth0_mgmt_domain="tenant.us.auth0.com"))
    assert can_delete_identities(Settings(**AUTH0))


def test_every_table_of_the_persons_is_erased_but_the_accounts() -> None:
    names = {t.name for t in tables_to_erase()}
    assert {"users", "user_conversations", "user_tasks", "cloud_assets", "user_agents", "browser_links", "browser_calls", "browser_recordings", "user_skills", "agent_tools", "usage_events"} <= names
    assert not names & {"admin_users", "server_metadata"}


def _auth0(deleting: int, seen: list[httpx.Request]) -> httpx.AsyncClient:
    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/oauth/token":
            return httpx.Response(200, json={"access_token": "mgmt-token"})
        return httpx.Response(deleting)

    return httpx.AsyncClient(transport=httpx.MockTransport(answer))


@pytest.mark.anyio
async def test_the_identity_is_deleted_by_its_escaped_sub() -> None:
    seen: list[httpx.Request] = []
    async with _auth0(204, seen) as http:
        await delete_identity(Settings(**AUTH0), "auth0|abc", http)
    assert str(seen[0].url) == "https://tenant.us.auth0.com/oauth/token"
    assert seen[1].method == "DELETE"
    assert seen[1].url.raw_path == b"/api/v2/users/auth0%7Cabc"
    assert seen[1].headers["Authorization"] == "Bearer mgmt-token"


@pytest.mark.anyio
async def test_an_identity_already_gone_is_done_and_a_refusal_is_raised() -> None:
    async with _auth0(404, []) as http:
        await delete_identity(Settings(**AUTH0), "auth0|abc", http)
    async with _auth0(403, []) as http:
        with pytest.raises(httpx.HTTPStatusError):
            await delete_identity(Settings(**AUTH0), "auth0|abc", http)


@pytest.mark.anyio
async def test_a_mock_sign_in_has_no_identity_to_delete() -> None:
    seen: list[httpx.Request] = []
    async with _auth0(204, seen) as http:
        await delete_identity(Settings(auth_mock=True, **AUTH0), "auth0|abc", http)
    assert seen == []


@pytest.mark.anyio
async def test_without_a_client_each_call_makes_its_own_and_closes_it(monkeypatch) -> None:
    seen: list[httpx.Request] = []
    made: list[httpx.AsyncClient] = []
    real = httpx.AsyncClient

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/oauth/token":
            return httpx.Response(200, json={"access_token": "mgmt-token"})
        return httpx.Response(200, json={"deleted": True})

    def own(**kwargs) -> httpx.AsyncClient:
        assert kwargs["timeout"] == 20
        made.append(real(transport=httpx.MockTransport(answer)))
        return made[-1]

    monkeypatch.setattr(account_deletion.httpx, "AsyncClient", own)
    await delete_identity(Settings(**AUTH0), "auth0|abc")
    assert [r.method + " " + r.url.path for r in seen] == ["POST /oauth/token", "DELETE /api/v2/users/auth0|abc"]
    assert len(made) == 1 and all(c.is_closed for c in made)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def client(ui_dist: Path, migrated_db_url: str, tmp_path: Path) -> Iterator[TestClient]:
    with make_client(
        ui_dist, database_url=migrated_db_url, asset_dir=tmp_path / "kept-assets", skill_file_dir=tmp_path / "skills", workspace_dir=tmp_path / "workspaces",
        recording_dir=tmp_path / "recordings", **AUTH0,
    ) as c:
        c.app.dependency_overrides[current_user] = _fake_user
        yield c


@pytest.fixture
def people(migrated_db_url: str) -> Iterator[list[str]]:
    subs = [f"test-{uuid.uuid4().hex}" for _ in range(2)]
    yield subs
    engine = create_engine(migrated_db_url)
    with engine.begin() as conn:
        for t in tables_to_erase():
            conn.execute(text(f"DELETE FROM {t} WHERE user_id = ANY(:u)"), {"u": subs})
    engine.dispose()


class Holder:
    """An extension holding something of the person's: asked first, then in the erase."""

    def __init__(self, refuse: bool = False) -> None:
        self.refuse, self.asked, self.erased = refuse, [], []

    async def before(self, state, session, sub):
        self.asked.append(sub)
        return Refusal(502, "held", "Something of yours could not be let go, so nothing was deleted. Try again.") if self.refuse else None

    async def erase(self, session, sub):
        # In the erasing transaction: it sees the person's rows gone.
        self.erased.append((await session.execute(text("SELECT count(*) FROM users WHERE user_id = :u"), {"u": sub})).scalar())

    def extension(self) -> Extension:
        return Extension("holder", API, before_account_delete=self.before, on_account_erase=self.erase)


@needs_db
def test_an_extension_is_asked_first_and_erases_its_own_with_the_rest(ui_dist: Path, migrated_db_url: str, people: list[str], tmp_path: Path, monkeypatch) -> None:
    async def identity(settings, sub):
        pass

    monkeypatch.setattr(account_deletion, "delete_identity", identity)
    holder, quiet = Holder(), Extension("quiet", API)
    with make_client(ui_dist, [quiet, holder.extension()], database_url=migrated_db_url, asset_dir=tmp_path / "a", **AUTH0) as c:
        c.app.dependency_overrides[current_user] = _fake_user
        me = {"X-Test-User": people[0]}
        c.put("/api/v1/profile", json={"display_name": "Someone"}, headers=me)
        assert c.delete("/api/v1/account", headers=me).status_code == 200
    assert holder.asked == [people[0]] and holder.erased == [0]


@needs_db
def test_an_extension_that_refuses_deletes_nothing(ui_dist: Path, migrated_db_url: str, people: list[str], tmp_path: Path, monkeypatch) -> None:
    called = []
    monkeypatch.setattr(account_deletion, "delete_identity", lambda *a: called.append(a))
    holder = Holder(refuse=True)
    with make_client(ui_dist, [holder.extension()], database_url=migrated_db_url, asset_dir=tmp_path / "a", **AUTH0) as c:
        c.app.dependency_overrides[current_user] = _fake_user
        me = {"X-Test-User": people[0]}
        c.put("/api/v1/data/reminders/t1", json={"text": "Work", "due_at": "2026-11-06T00:00:00Z"}, headers=me)
        r = c.delete("/api/v1/account", headers=me)
        assert r.status_code == 502 and r.json()["detail"]["code"] == "held"
        assert c.get("/api/v1/data/reminders/t1", headers=me).status_code == 200
    assert not called and holder.erased == []


@needs_db
def test_everything_of_the_persons_goes_and_nobody_elses(client: TestClient, people: list[str], migrated_db_url: str, tmp_path: Path, monkeypatch) -> None:
    deleted: list[str] = []

    async def identity(settings, sub):
        deleted.append(sub)

    monkeypatch.setattr(account_deletion, "delete_identity", identity)
    me, other = ({"X-Test-User": p} for p in people)
    for who in (me, other):
        client.put("/api/v1/data/reminders/t1", json={"text": "Work", "due_at": "2026-11-06T00:00:00Z"}, headers=who)
        client.put("/api/v1/data/settings/shared", json={"config": {}, "updated_at": "2026-11-06T00:00:00Z"}, headers=who)
        client.put("/api/v1/profile", json={"display_name": "Someone"}, headers=who)
        assert client.put("/api/v1/assets", content=PNG, headers={**who, "Content-Type": "image/png"}).status_code in (200, 201)
        assert client.post("/api/v1/workspaces", json={"name": "Docs"}, headers=who).status_code == 201
    files = lambda: [p for p in (tmp_path / "kept-assets").rglob("*") if p.is_file()]  # noqa: E731
    assert len(files()) == 2
    # A browser recording each: its video in the recording store, its row.
    engine = create_engine(migrated_db_url)
    with engine.begin() as conn:
        for sub in people:
            rid = uuid.uuid4().hex
            (tmp_path / "recordings" / sub).mkdir(parents=True)
            (tmp_path / "recordings" / sub / f"{rid}.webm").write_bytes(b"webm")
            conn.execute(text("INSERT INTO browser_recordings (id, user_id, link_id, name, started_at, duration_ms, size) VALUES (:i, :u, :l, 'x', now(), 1, 4)"), {"i": rid, "u": sub, "l": "0" * 32})
    engine.dispose()
    r = client.delete("/api/v1/account", headers=me)
    assert (r.status_code, r.json()) == (200, {"deleted": True})
    assert deleted == [people[0]]

    assert client.get("/api/v1/data/reminders/t1", headers=me).status_code == 404
    assert client.get("/api/v1/data/settings/shared", headers=me).status_code == 404
    assert client.get("/api/v1/data/reminders/t1", headers=other).status_code == 200
    assert client.get("/api/v1/data/settings/shared", headers=other).status_code == 200
    assert len(files()) == 1
    # Their workspace's folder went; the other person's stays.
    assert not (tmp_path / "workspaces" / people[0]).exists() or not any((tmp_path / "workspaces" / people[0]).iterdir())
    assert len(list((tmp_path / "workspaces" / people[1]).glob("*/README.md"))) == 1
    assert not list((tmp_path / "recordings" / people[0]).iterdir()) and len(list((tmp_path / "recordings" / people[1]).iterdir())) == 1
    engine = create_engine(migrated_db_url)
    with engine.begin() as conn:
        for t in tables_to_erase():
            left = conn.execute(text(f"SELECT count(*) FROM {t} WHERE user_id = :u"), {"u": people[0]}).scalar()
            assert left == 0, t.name
        assert conn.execute(text("SELECT count(*) FROM users WHERE user_id = :u"), {"u": people[1]}).scalar() == 1
    engine.dispose()

    # Asked again (the identity failed the first time, say), it still finishes.
    assert client.delete("/api/v1/account", headers=me).status_code == 200
    assert deleted == [people[0], people[0]]


@needs_db
def test_an_identity_that_could_not_be_deleted_says_so(client: TestClient, people: list[str], monkeypatch) -> None:
    async def identity(settings, sub):
        raise httpx.ConnectError("no")

    monkeypatch.setattr(account_deletion, "delete_identity", identity)
    r = client.delete("/api/v1/account", headers={"X-Test-User": people[0]})
    assert r.status_code == 502
    assert r.json()["detail"]["code"] == "identity_not_deleted"


@needs_db
def test_an_erase_that_fails_deletes_nothing_and_says_so(client: TestClient, people: list[str], monkeypatch) -> None:
    called = []

    def broken():
        raise OSError("database gone")

    monkeypatch.setattr(account_deletion, "tables_to_erase", broken)
    monkeypatch.setattr(account_deletion, "delete_identity", lambda *a: called.append(a))
    me = {"X-Test-User": people[0]}
    client.put("/api/v1/data/reminders/t1", json={"text": "Work", "due_at": "2026-11-06T00:00:00Z"}, headers=me)
    r = client.delete("/api/v1/account", headers=me)
    assert r.status_code == 502
    assert r.json()["detail"]["code"] == "account_not_deleted"
    assert not called
    assert client.get("/api/v1/data/reminders/t1", headers=me).status_code == 200


@needs_db
def test_the_persons_skill_files_go_and_nobody_elses(client: TestClient, people: list[str], migrated_db_url: str, monkeypatch) -> None:
    async def identity(settings, sub):
        pass

    monkeypatch.setattr(account_deletion, "delete_identity", identity)
    me, other = ({"X-Test-User": p} for p in people)
    ids = {}
    for who, data in ((me, b"# mine\n"), (other, b"# theirs\n")):
        put = client.put("/api/v1/skill-files", content=data, headers=who)
        assert put.status_code in (200, 201), put.text
        ids[who["X-Test-User"]] = put.json()["id"]
    assert client.delete("/api/v1/account", headers=me).status_code == 200
    assert client.get(f"/api/v1/skill-files/{ids[people[0]]}", headers=me).status_code == 404
    assert client.get(f"/api/v1/skill-files/{ids[people[1]]}", headers=other).content == b"# theirs\n"
    engine = create_engine(migrated_db_url)
    with engine.begin() as conn:
        assert conn.execute(text("SELECT count(*) FROM cloud_skill_files WHERE user_id = :u"), {"u": people[0]}).scalar() == 0
    engine.dispose()


@needs_db
def test_their_usage_events_go_with_those_from_before_they_signed_in(client: TestClient, people: list[str], migrated_db_url: str, monkeypatch) -> None:
    async def nothing(*_args):
        pass

    monkeypatch.setattr(account_deletion, "delete_identity", nothing)
    mine, theirs = uuid.uuid4().hex, uuid.uuid4().hex
    engine = create_engine(migrated_db_url)
    insert = text("INSERT INTO usage_events (occurred_at, event, user_id, anonymous_id, insert_id, surface) VALUES (now(), 'Click', :u, :a, 'i', 'landing')")
    with engine.begin() as conn:
        # Before signing in, and after, on the same browser; and someone else's browser.
        conn.execute(insert, {"u": None, "a": mine})
        conn.execute(insert, {"u": people[0], "a": mine})
        conn.execute(insert, {"u": None, "a": theirs})
    assert client.delete("/api/v1/account", headers={"X-Test-User": people[0]}).status_code == 200
    with engine.begin() as conn:
        left = conn.execute(text("SELECT anonymous_id FROM usage_events WHERE anonymous_id IN (:m, :t)"), {"m": mine, "t": theirs}).scalars().all()
        conn.execute(text("DELETE FROM usage_events WHERE anonymous_id = :t"), {"t": theirs})
    engine.dispose()
    assert left == [theirs]
