"""A person's file storage (apps/cloud/storage.py): the bytes and files Wysebee Cloud keeps
for them in blob storage — assets, skill files and recordings — against the quota. Against a
real database (skipped without WYSEBEE_TEST_DATABASE_URL); the caller is faked with the
X-Test-User header, as in test_assets_api.py."""

import hashlib
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import Header
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud.auth import User, current_user
from apps.cloud.extensions import API, Extension, Policy
from tests.conftest import make_client, needs_db
from tests.test_assets_api import PNG

QUOTA = 4096
SCRIPT = b"#!/bin/sh\necho forecast\n"
TABLES = ["cloud_assets", "cloud_skill_files", "browser_recordings"]


def _fake_user(x_test_user: str = Header()) -> User:
    return User(sub=x_test_user)


@pytest.fixture
def client(ui_dist: Path, migrated_db_url: str, tmp_path: Path) -> Iterator[TestClient]:
    with make_client(ui_dist, database_url=migrated_db_url, asset_dir=tmp_path / "assets", skill_file_dir=tmp_path / "skill-files", storage_quota_bytes=QUOTA) as c:
        c.app.dependency_overrides[current_user] = _fake_user
        yield c


@pytest.fixture
def users(migrated_db_url: str) -> Iterator[list[str]]:
    subs = [f"test-{uuid.uuid4().hex}" for _ in range(2)]
    yield subs
    engine = create_engine(migrated_db_url)
    with engine.begin() as conn:
        for table in TABLES:
            conn.execute(text(f"DELETE FROM {table} WHERE user_id = ANY(:u)"), {"u": subs})
    engine.dispose()


def _storage(client: TestClient, sub: str) -> dict:
    r = client.get("/api/v1/storage", headers={"X-Test-User": sub})
    assert r.status_code == 200
    return r.json()


def test_storage_needs_a_sign_in(ui_dist: Path) -> None:
    with make_client(ui_dist, auth_issuer="https://wysebee-test.us.auth0.com/") as c:
        assert c.get("/api/v1/storage").status_code == 401


@needs_db
def test_nothing_stored_is_nothing_used(client: TestClient, users: list[str]) -> None:
    assert _storage(client, users[0]) == {
        "used": 0,
        "limit": QUOTA,
        "files": 0,
        "parts": [{"kind": "assets", "bytes": 0, "files": 0}, {"kind": "skill_files", "bytes": 0, "files": 0}, {"kind": "recordings", "bytes": 0, "files": 0}],
    }


@needs_db
def test_every_kind_of_file_counts_and_only_the_persons_own(client: TestClient, users: list[str], migrated_db_url: str) -> None:
    a, b = users
    assert client.put("/api/v1/assets", content=PNG, headers={"X-Test-User": a, "Content-Type": "image/png"}).status_code in (200, 201)
    for data in (SCRIPT, SCRIPT + b"# more\n"):
        assert client.put("/api/v1/skill-files", content=data, headers={"X-Test-User": a, "Content-Type": "application/octet-stream"}).status_code in (200, 201)
    skills = 2 * len(SCRIPT) + len(b"# more\n")
    # A browser recording's row (its upload: test_browser_recordings.py).
    with create_engine(migrated_db_url).begin() as conn:
        conn.execute(text("INSERT INTO browser_recordings (id, user_id, link_id, name, started_at, duration_ms, size) VALUES (:i, :u, :l, 'x', now(), 1, 700)"), {"i": uuid.uuid4().hex, "u": a, "l": "0" * 32})
    got = _storage(client, a)
    assert got["parts"] == [
        {"kind": "assets", "bytes": len(PNG), "files": 1},
        {"kind": "skill_files", "bytes": skills, "files": 2},
        {"kind": "recordings", "bytes": 700, "files": 1},
    ]
    assert (got["used"], got["limit"]) == (len(PNG) + skills + 700, QUOTA)
    assert got["files"] == 4
    # Another person's storage is their own.
    assert _storage(client, b)["used"] == 0

    # A file deleted is no longer counted.
    assert client.delete(f"/api/v1/assets/{hashlib.sha256(PNG).hexdigest()}", headers={"X-Test-User": a}).status_code in (200, 204)
    assert _storage(client, a)["parts"][0] == {"kind": "assets", "bytes": 0, "files": 0}


@needs_db
def test_an_extensions_policy_may_give_more_never_less(ui_dist: Path, migrated_db_url: str, users: list[str]) -> None:
    a, b = users

    class Quotas(Policy):
        async def storage_quota(self, session, user_id):
            return {a: 10 * QUOTA, b: 10}.get(user_id)

    ext = Extension("quotas", API, policy=Quotas())
    with make_client(ui_dist, [ext], database_url=migrated_db_url, storage_quota_bytes=QUOTA) as c:
        c.app.dependency_overrides[current_user] = _fake_user
        assert _storage(c, a)["limit"] == 10 * QUOTA
        # Less than the server's own is the server's own; none said, too.
        assert _storage(c, b)["limit"] == QUOTA
        assert _storage(c, "someone-else")["limit"] == QUOTA
