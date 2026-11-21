"""The asset routes against a real database (skipped without WYSEBEE_TEST_DATABASE_URL)
and the file store, except the sign-in checks, which need neither.

The caller is faked by overriding ``current_user`` with the X-Test-User header, so
nothing reaches Auth0; test_auth.py covers real tokens. Limits are tiny so size and
count are exercised with a few bytes.
"""

import hashlib
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import Header
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud.assets import content_type_of
from apps.cloud.auth import User, current_user
from tests.conftest import make_client, needs_db

MAX_BYTES = 64
MAX_COUNT = 3
PNG = b"\x89PNG\r\n\x1a\n" + b"pretend-image"


def _fake_user(x_test_user: str = Header()) -> User:
    return User(sub=x_test_user)


@pytest.fixture
def asset_dir(tmp_path: Path) -> Path:
    return tmp_path / "assets"


@pytest.fixture
def client(ui_dist: Path, migrated_db_url: str, asset_dir: Path) -> Iterator[TestClient]:
    with make_client(
        ui_dist,
        database_url=migrated_db_url,
        asset_dir=asset_dir,
        asset_max_bytes=MAX_BYTES,
        asset_max_count=MAX_COUNT,
    ) as c:
        c.app.dependency_overrides[current_user] = _fake_user
        yield c


@pytest.fixture
def users(migrated_db_url: str) -> Iterator[list[str]]:
    subs = [f"test-{uuid.uuid4().hex}" for _ in range(2)]
    yield subs
    engine = create_engine(migrated_db_url)
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM cloud_assets WHERE user_id = ANY(:u)"), {"u": subs})
    engine.dispose()


def h(sub: str, content_type: str | None = "image/png") -> dict[str, str]:
    headers = {"X-Test-User": sub}
    if content_type is not None:
        headers["Content-Type"] = content_type
    return headers


def put(client, sub, data=PNG, content_type="image/png"):
    return client.put("/api/v1/assets", content=data, headers=h(sub, content_type))


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@needs_db
def test_put_get_delete(client, users, asset_dir):
    a = users[0]
    r = put(client, a)
    assert r.status_code == 200, r.text
    assert r.json() == {"id": sha(PNG), "content_type": "image/png", "size": len(PNG)}
    # Kept under the person's hashed folder, named by the hash of its bytes.
    assert (asset_dir / a / sha(PNG)).read_bytes() == PNG

    got = client.get(f"/api/v1/assets/{sha(PNG)}", headers=h(a, None))
    assert got.status_code == 200
    assert got.content == PNG
    assert got.headers["content-type"] == "image/png"
    assert got.headers["cache-control"] == "private, max-age=31536000, immutable"
    assert got.headers["x-content-type-options"] == "nosniff"
    assert got.headers["content-length"] == str(len(PNG))

    r = client.delete(f"/api/v1/assets/{sha(PNG)}", headers=h(a, None))
    assert r.status_code == 204
    assert not (asset_dir / a / sha(PNG)).exists()
    assert client.get(f"/api/v1/assets/{sha(PNG)}", headers=h(a, None)).status_code == 404
    assert client.delete(f"/api/v1/assets/{sha(PNG)}", headers=h(a, None)).status_code == 404


@needs_db
def test_putting_the_same_bytes_again_is_idempotent(client, users, migrated_db_url):
    a = users[0]
    first = put(client, a).json()
    # Even declared as another type: the bytes are the asset, and the first type stands.
    again = put(client, a, content_type="image/webp")
    assert again.status_code == 200 and again.json() == first
    engine = create_engine(migrated_db_url)
    with engine.connect() as conn:
        n = conn.execute(text("SELECT count(*) FROM cloud_assets WHERE user_id = :u"), {"u": a}).scalar()
    engine.dispose()
    assert n == 1


@needs_db
def test_assets_are_private_to_their_owner(client, users):
    a, b = users
    put(client, a)
    assert client.get(f"/api/v1/assets/{sha(PNG)}", headers=h(b, None)).status_code == 404
    assert client.delete(f"/api/v1/assets/{sha(PNG)}", headers=h(b, None)).status_code == 404
    # The other person's delete touched nothing.
    assert client.get(f"/api/v1/assets/{sha(PNG)}", headers=h(a, None)).status_code == 200
    # The same bytes are each person's own copy.
    assert put(client, b).status_code == 200
    assert client.delete(f"/api/v1/assets/{sha(PNG)}", headers=h(b, None)).status_code == 204
    assert client.get(f"/api/v1/assets/{sha(PNG)}", headers=h(a, None)).content == PNG


@needs_db
@pytest.mark.parametrize(
    "content_type, code",
    [
        ("image/png", 200),
        ("image/jpeg", 200),
        ("image/webp", 200),
        ("image/gif", 200),
        ("IMAGE/PNG; charset=binary", 200),
        ("image/svg+xml", 415),
        ("text/html", 415),
        ("application/octet-stream", 415),
        (None, 415),
    ],
)
def test_only_images_are_accepted(client, users, content_type, code):
    r = put(client, users[0], content_type=content_type)
    assert r.status_code == code, r.text
    if code == 200:
        assert r.json()["content_type"] == content_type_of(content_type)


@needs_db
def test_size_limits(client, users):
    a = users[0]
    assert put(client, a, data=b"x" * MAX_BYTES).status_code == 200
    r = put(client, a, data=b"y" * (MAX_BYTES + 1))
    assert r.status_code == 413
    assert put(client, a, data=b"").status_code == 422

    # A body with no Content-Length is counted as it arrives.
    def chunks():
        yield b"z" * 40
        yield b"z" * 40

    r = client.put("/api/v1/assets", content=chunks(), headers=h(a))
    assert r.status_code == 413


@needs_db
def test_count_limit(client, users):
    a, b = users
    ids = []
    for n in range(MAX_COUNT):
        r = put(client, a, data=PNG + bytes([n]))
        assert r.status_code == 200
        ids.append(r.json()["id"])
    r = put(client, a, data=PNG + b"one too many")
    assert r.status_code == 409
    assert f"most allowed is {MAX_COUNT}" in r.json()["detail"]
    # What is already stored can still be put again, and the cap is per person.
    assert put(client, a, data=PNG + bytes([0])).status_code == 200
    assert put(client, b, data=PNG + b"one too many").status_code == 200
    # Deleting one makes room.
    assert client.delete(f"/api/v1/assets/{ids[0]}", headers=h(a, None)).status_code == 204
    assert put(client, a, data=PNG + b"one too many").status_code == 200


@needs_db
@pytest.mark.parametrize("bad", ["abc", "A" * 64, "g" * 64, "a" * 63, "a" * 65, "a" * 32])
def test_a_bad_id_is_422(client, users, bad):
    assert client.get(f"/api/v1/assets/{bad}", headers=h(users[0], None)).status_code == 422
    assert client.delete(f"/api/v1/assets/{bad}", headers=h(users[0], None)).status_code == 422


@needs_db
def test_a_row_without_bytes_is_404_and_still_deletable(client, users, asset_dir):
    a = users[0]
    put(client, a)
    (asset_dir / a / sha(PNG)).unlink()
    assert client.get(f"/api/v1/assets/{sha(PNG)}", headers=h(a, None)).status_code == 404
    assert client.delete(f"/api/v1/assets/{sha(PNG)}", headers=h(a, None)).status_code == 204


@needs_db
def test_a_failed_byte_delete_still_deletes_the_asset(client, users):
    a = users[0]
    put(client, a)

    async def broken(sub, asset_id):
        raise OSError("disk went away")

    client.app.state.asset_store.delete = broken
    assert client.delete(f"/api/v1/assets/{sha(PNG)}", headers=h(a, None)).status_code == 204
    assert client.get(f"/api/v1/assets/{sha(PNG)}", headers=h(a, None)).status_code == 404


# --- sign-in (no database needed: the caller is checked first) -------------------------


@pytest.mark.parametrize(
    "method, path",
    [("PUT", "/api/v1/assets"), ("GET", f"/api/v1/assets/{'a' * 64}"), ("DELETE", f"/api/v1/assets/{'a' * 64}")],
)
def test_sign_in_is_required(ui_dist, tmp_path, method, path):
    store = tmp_path / "store"
    with make_client(ui_dist, asset_dir=store, auth_issuer="https://wysebee-test.us.auth0.com/") as c:
        r = c.request(method, path, content=PNG, headers={"Content-Type": "image/png"})
        assert r.status_code == 401
    with make_client(ui_dist, asset_dir=store) as c:
        r = c.request(method, path, content=PNG, headers={"Content-Type": "image/png"})
        assert r.status_code == 503
    assert not store.exists()


@needs_db
def test_a_user_id_that_cannot_name_a_folder_cannot_store_assets(client):
    r = put(client, "evil/../../x")
    assert r.status_code == 422
