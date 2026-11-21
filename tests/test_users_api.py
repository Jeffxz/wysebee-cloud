"""The people (apps/cloud/users.py): their profile, who their app says they are, and the
command line's list — against a real database (skipped without WYSEBEE_TEST_DATABASE_URL), except the sign-in
check, which needs none. The caller is faked with the X-Test-User header, as in
test_desktops_api.py."""

import asyncio
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import Header
from sqlalchemy import create_engine, text

from apps.cloud import users as users_module
from apps.cloud.auth import User, current_user
from apps.cloud.config import Settings
from apps.cloud.db import Database
from tests.conftest import make_client, needs_db


def _fake_user(x_test_user: str = Header()) -> User:
    return User(sub=x_test_user)


@pytest.fixture
def users(migrated_db_url: str) -> Iterator[list[str]]:
    subs = [f"test-{uuid.uuid4().hex}" for _ in range(2)]
    yield subs
    with create_engine(migrated_db_url).begin() as conn:
        conn.execute(text("DELETE FROM users WHERE user_id = ANY(:u)"), {"u": subs})


def _cli(url: str, argv: list[str]) -> tuple[int, str]:
    db = Database(Settings(database_url=url))

    async def go() -> tuple[int, str]:
        try:
            async for session in db.session():
                return await users_module.run(argv, session)
        finally:
            await db.dispose()
        raise AssertionError("no session")

    return asyncio.run(go())


def test_needs_sign_in(ui_dist: Path) -> None:
    with make_client(ui_dist) as c:
        assert c.get("/api/v1/profile").status_code in (401, 503)
        # The waitlist and the chat it gated are gone.
        assert c.get("/api/v1/waitlist").status_code in (404, 405)


@needs_db
def test_the_list_names_each_person_and_nothing_else_is_a_command(ui_dist: Path, users: list[str], migrated_db_url: str) -> None:
    me, other = users
    with make_client(ui_dist, database_url=migrated_db_url) as c:
        c.app.dependency_overrides[current_user] = _fake_user
        assert c.put("/api/v1/me", json={"email": "sam@example.com", "name": "Sam"}, headers={"X-Test-User": me}).status_code == 204
        assert c.put("/api/v1/me", json={}, headers={"X-Test-User": other}).status_code == 204
    code, listed = _cli(migrated_db_url, ["list"])
    assert code == 0
    lines = listed.splitlines()
    assert f"sam@example.com  Sam  {me}" in lines
    assert f"-  -  {other}" in lines
    assert _cli(migrated_db_url, ["enable", "sam@example.com"]) == (2, users_module.USAGE)


@needs_db
def test_an_empty_list_says_so(migrated_db_url: str) -> None:
    with create_engine(migrated_db_url).begin() as conn:
        if conn.execute(text("SELECT count(*) FROM users")).scalar_one():
            pytest.skip("the test database has people in it")
    assert _cli(migrated_db_url, ["list"]) == (0, "(nobody yet)")


@needs_db
def test_the_profile_is_kept_on_the_persons_row(ui_dist: Path, users: list[str], migrated_db_url: str) -> None:
    me, _ = users
    asset = "asset:" + "a" * 64
    with make_client(ui_dist, database_url=migrated_db_url) as c:
        c.app.dependency_overrides[current_user] = _fake_user
        h = {"X-Test-User": me}
        assert c.get("/api/v1/profile", headers=h).json() == {"display_name": "", "avatar": ""}
        # Only what is sent changes.
        assert c.put("/api/v1/profile", json={"display_name": "  Sam  "}, headers=h).json() == {"display_name": "Sam", "avatar": ""}
        assert c.put("/api/v1/profile", json={"avatar": asset}, headers=h).json() == {"display_name": "Sam", "avatar": asset}
        assert c.put("/api/v1/profile", json={"avatar": "🐝"}, headers=h).json()["avatar"] == "🐝"
        assert c.put("/api/v1/profile", json={}, headers=h).json() == {"display_name": "Sam", "avatar": "🐝"}
        # Null or "" clears.
        assert c.put("/api/v1/profile", json={"avatar": None, "display_name": ""}, headers=h).json() == {"display_name": "", "avatar": ""}
        for bad in ({"display_name": "a\nb"}, {"display_name": "x" * 81}, {"avatar": "not an emoji at all, too long"}, {"avatar": "asset:nothex"}):
            assert c.put("/api/v1/profile", json=bad, headers=h).status_code == 422, bad
        # Saying who they are leaves the profile alone, and the other way round.
        c.put("/api/v1/profile", json={"display_name": "Sam"}, headers=h)
        c.put("/api/v1/me", json={"email": "s@example.com", "name": "Samuel"}, headers=h)
        assert c.get("/api/v1/profile", headers=h).json()["display_name"] == "Sam"
    with create_engine(migrated_db_url).begin() as conn:
        assert tuple(conn.execute(text("SELECT email, name, display_name FROM users WHERE user_id = :u"), {"u": me}).one()) == ("s@example.com", "Samuel", "Sam")


@needs_db
def test_the_app_says_who_the_person_is(ui_dist: Path, users: list[str], migrated_db_url: str) -> None:
    me, _ = users
    with make_client(ui_dist, database_url=migrated_db_url) as c:
        c.app.dependency_overrides[current_user] = _fake_user
        h = {"X-Test-User": me}
        assert c.put("/api/v1/me", json={"email": " sam@example.com ", "name": "Sam"}, headers=h).status_code == 204
        # A blank keeps what was there; a new one replaces it.
        assert c.put("/api/v1/me", json={"name": "Sam B"}, headers=h).status_code == 204
        assert c.put("/api/v1/me", json={"email": "x" * 321}, headers=h).status_code == 422
    with create_engine(migrated_db_url).begin() as conn:
        row = conn.execute(text("SELECT email, name FROM users WHERE user_id = :u"), {"u": me}).one()
    assert tuple(row) == ("sam@example.com", "Sam B")


def test_the_migration_reads_a_profile_off_wysebees_settings():
    import importlib.util

    path = next(Path(__file__).resolve().parent.parent.joinpath("migrations", "versions").glob("*_0020_*.py"))
    spec = importlib.util.spec_from_file_location("m0020", path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)  # type: ignore[union-attr]
    as_text = {"CONFIG": '{"label": "Wysebee", "profile": {"display_name": " Sam ", "avatar": "asset:x"}}'}
    assert m.profile_of(as_text) == ("Sam", "asset:x")
    assert m.profile_of({"CONFIG": {"profile": {"display_name": "Sam"}}}) == ("Sam", "")
    assert m.profile_of({"CONFIG": {"profile": {"avatar": 5, "display_name": "x" * 90}}}) == ("x" * 80, "")
    for nothing in (None, {}, {"CONFIG": "{not json"}, {"CONFIG": "[]"}, {"CONFIG": {"profile": "x"}}, {"CONFIG": {"profile": {}}}):
        assert m.profile_of(nothing) is None, nothing
