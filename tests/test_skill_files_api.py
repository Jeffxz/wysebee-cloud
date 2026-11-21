"""The skill file routes against a real database (skipped without
WYSEBEE_TEST_DATABASE_URL) and the file store, except the sign-in checks, which need
neither. The caller is faked with the X-Test-User header, as in test_assets_api.py."""

import hashlib
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import Header
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud.auth import User, current_user
from apps.cloud.config import Settings
from apps.cloud.skill_files import make_skill_file_store
from tests.conftest import make_client, needs_db

MAX_BYTES = 64
MAX_COUNT = 3
SCRIPT = b"#!/bin/sh\necho forecast\n"


def _fake_user(x_test_user: str = Header()) -> User:
    return User(sub=x_test_user)


@pytest.fixture
def file_dir(tmp_path: Path) -> Path:
    return tmp_path / "skill-files"


@pytest.fixture
def client(ui_dist: Path, migrated_db_url: str, file_dir: Path) -> Iterator[TestClient]:
    with make_client(ui_dist, database_url=migrated_db_url, skill_file_dir=file_dir, skill_file_max_bytes=MAX_BYTES, skill_file_max_count=MAX_COUNT) as c:
        c.app.dependency_overrides[current_user] = _fake_user
        yield c


@pytest.fixture
def users(migrated_db_url: str) -> Iterator[list[str]]:
    subs = [f"test-{uuid.uuid4().hex}" for _ in range(2)]
    yield subs
    engine = create_engine(migrated_db_url)
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM cloud_skill_files WHERE user_id = ANY(:u)"), {"u": subs})
    engine.dispose()


def h(sub: str) -> dict[str, str]:
    return {"X-Test-User": sub, "Content-Type": "application/octet-stream"}


def put(client, sub, data=SCRIPT):
    return client.put("/api/v1/skill-files", content=data, headers=h(sub))


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@needs_db
def test_put_get_delete_any_bytes(client, users, file_dir):
    a = users[0]
    r = put(client, a)
    assert r.status_code == 200, r.text
    assert r.json() == {"id": sha(SCRIPT), "size": len(SCRIPT)}
    assert (file_dir / a / sha(SCRIPT)).read_bytes() == SCRIPT
    # Any declared type is the same file.
    assert client.put("/api/v1/skill-files", content=SCRIPT, headers={"X-Test-User": a, "Content-Type": "text/html"}).json()["id"] == sha(SCRIPT)
    got = client.get(f"/api/v1/skill-files/{sha(SCRIPT)}", headers=h(a))
    assert got.status_code == 200 and got.content == SCRIPT
    assert got.headers["content-type"] == "application/octet-stream"
    assert got.headers["content-disposition"] == "attachment"
    assert got.headers["x-content-type-options"] == "nosniff"
    assert client.delete(f"/api/v1/skill-files/{sha(SCRIPT)}", headers=h(a)).status_code == 204
    assert not (file_dir / a / sha(SCRIPT)).exists()
    assert client.get(f"/api/v1/skill-files/{sha(SCRIPT)}", headers=h(a)).status_code == 404
    assert client.delete(f"/api/v1/skill-files/{sha(SCRIPT)}", headers=h(a)).status_code == 404


@needs_db
def test_files_are_private_and_bounded(client, users, file_dir):
    a, b = users
    put(client, a)
    assert client.get(f"/api/v1/skill-files/{sha(SCRIPT)}", headers=h(b)).status_code == 404
    assert put(client, a, data=b"x" * (MAX_BYTES + 1)).status_code == 413
    assert put(client, a, data=b"").status_code == 422

    def chunks():
        yield b"z" * 40
        yield b"z" * 40

    assert client.put("/api/v1/skill-files", content=chunks(), headers=h(a)).status_code == 413
    for n in range(MAX_COUNT - 1):
        assert put(client, a, data=bytes([n])).status_code == 200
    r = put(client, a, data=b"one too many")
    assert r.status_code == 409 and f"most allowed is {MAX_COUNT}" in r.json()["detail"]
    assert put(client, a).status_code == 200, "what is stored can be put again"
    # A row whose bytes went is 404, and still deletable; a failed byte delete still deletes.
    (file_dir / a / sha(SCRIPT)).unlink()
    assert client.get(f"/api/v1/skill-files/{sha(SCRIPT)}", headers=h(a)).status_code == 404
    assert client.delete(f"/api/v1/skill-files/{sha(SCRIPT)}", headers=h(a)).status_code == 204

    async def broken(sub, file_id):
        raise OSError("disk went away")

    client.app.state.skill_file_store.delete = broken
    assert client.delete(f"/api/v1/skill-files/{sha(bytes([0]))}", headers=h(a)).status_code == 204
    assert put(client, "evil/../../x").status_code == 422
    assert client.get(f"/api/v1/skill-files/{'A' * 64}", headers=h(a)).status_code == 422


@pytest.mark.parametrize("method, path", [("PUT", "/api/v1/skill-files"), ("GET", f"/api/v1/skill-files/{'a' * 64}"), ("DELETE", f"/api/v1/skill-files/{'a' * 64}")])
def test_sign_in_is_required(ui_dist, tmp_path, method, path):
    store = tmp_path / "store"
    with make_client(ui_dist, skill_file_dir=store, auth_issuer="https://wysebee-test.us.auth0.com/") as c:
        assert c.request(method, path, content=SCRIPT).status_code == 401
    assert not store.exists()


def test_the_store_is_a_folder_or_its_own_azure_container(tmp_path, monkeypatch):
    assert make_skill_file_store(Settings(skill_file_dir=tmp_path)).root == tmp_path
    with pytest.raises(RuntimeError):
        make_skill_file_store(Settings(asset_store="azure"))
    made = {}
    monkeypatch.setattr("apps.cloud.skill_files.AzureBlobAssetStore.from_account_url", classmethod(lambda cls, url, name: made.setdefault("args", (url, name))))
    make_skill_file_store(Settings(asset_store="azure", asset_azure_account_url="https://acct.blob.core.windows.net"))
    assert made["args"] == ("https://acct.blob.core.windows.net", "user-skills")
