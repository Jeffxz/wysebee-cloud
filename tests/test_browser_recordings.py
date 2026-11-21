"""Browser recordings (apps/cloud/browser_recordings.py): the extension uploads a scenario
video with its link's secret; the person lists, plays (whole or a range) and deletes theirs.
Against the real test database (skipped without WYSEBEE_TEST_DATABASE_URL), the person faked
with X-Test-User, recordings kept in a folder of the test's own."""

import asyncio
import os
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud.agent_types import CHROME_ID, OSX_ID
from apps.cloud.browser_recordings import _part
from apps.cloud.recording_storage import FileRecordingStore, TooLarge, recording_name
from tests.cloud_agent_fixtures import _client, me  # noqa: F401 — fixtures
from tests.conftest import make_client, needs_db
from tests.test_browser_links import BASE, FAST, Extension, ext, paired, refusal

RECORDINGS = "/api/v1/browser-recordings"
WEBM = b"\x1aE\xdf\xa3" + os.urandom(3000)
QUERY = "name=Checkout%20with%20an%20expired%20card&started_at=2026-11-19T10:00:00.000Z&duration_ms=4200&origin=https%3A%2F%2Fshop.test"


@pytest.fixture
def client(ui_dist: Path, migrated_db_url: str, tmp_path: Path) -> Iterator[TestClient]:
    c = _client(ui_dist, migrated_db_url, tmp_path, recording_dir=tmp_path / "recordings", recording_max_bytes=10_000, recording_max_count=3, browser_link_starts_per_minute=10_000, **FAST)
    yield c
    c.__exit__(None, None, None)
    with create_engine(migrated_db_url).begin() as conn:
        conn.execute(text("DELETE FROM browser_links WHERE user_id IS NULL"))


def _upload(client: TestClient, e: Extension, body: bytes = WEBM, query: str = QUERY, secret: str | None = None, content_type: str = "video/webm"):
    return client.post(f"{BASE}/{e.id}/recordings?{query}", content=body, headers={**ext(secret or e.secret), "Content-Type": content_type})


# --- the store and the ranges, without a database ---------------------------------------------


def test_the_file_store_streams_both_ways_and_keeps_nothing_too_large(tmp_path: Path) -> None:
    store = FileRecordingStore(tmp_path)
    rid = uuid.uuid4().hex

    async def chunks(*parts: bytes):
        for p in parts:
            yield p

    async def run() -> None:
        assert await store.write("me", rid, chunks(b"abc", b"defg"), 7) == 7
        assert await store.size("me", rid) == 7
        assert b"".join([p async for p in store.read("me", rid, 2, 3)]) == b"cde"
        # A file shorter than the part asked for: what there is.
        assert b"".join([p async for p in store.read("me", rid, 5, 100)]) == b"fg"
        with pytest.raises(TooLarge):
            await store.write("me", uuid.uuid4().hex, chunks(b"abc", b"defg"), 6)
        assert [p.name for p in (tmp_path / "me").iterdir()] == [f"{rid}.webm"]  # no temporary file left
        await store.delete("me", rid)
        await store.delete("me", rid)
        assert await store.size("me", rid) is None

    asyncio.run(run())
    # Deleted between looking and measuring: no size, not an error.
    gone = uuid.uuid4().hex
    with pytest.MonkeyPatch.context() as m:
        m.setattr(Path, "is_file", lambda self: True)
        assert asyncio.run(store.size("me", gone)) is None
    for bad in ("../x", "A" * 32, "x"):
        with pytest.raises(ValueError):
            recording_name("me", bad)


def test_a_range_is_one_part_of_the_video() -> None:
    assert _part(None, 100) is None and _part("bytes=-", 100) is None and _part("bytes=0-1,5-6", 100) is None and _part("items=0-1", 100) is None
    assert (_part("bytes=0-", 100), _part("bytes=10-19", 100), _part("bytes=90-500", 100), _part("bytes=-30", 100), _part("bytes=-500", 100)) == ((0, 99), (10, 19), (90, 99), (70, 99), (0, 99))
    for bad in ("bytes=100-", "bytes=20-10", "bytes=-0"):
        with pytest.raises(ValueError):
            _part(bad, 100)


# --- uploading, listing, playing, deleting --------------------------------------------------


@needs_db
def test_the_extension_uploads_and_the_person_lists_plays_and_deletes(client: TestClient, me: dict[str, str], tmp_path: Path) -> None:
    e = paired(client, me)
    r = _upload(client, e, query=f"{QUERY}&call_id={'c' * 32}")
    assert r.status_code == 201, r.text
    made = r.json()
    rid = made["id"]
    assert {k: made[k] for k in ("name", "duration_ms", "origin", "call_id", "size", "link_id", "content_type")} == {
        "name": "Checkout with an expired card", "duration_ms": 4200, "origin": "https://shop.test", "call_id": "c" * 32,
        "size": len(WEBM), "link_id": e.id, "content_type": "video/webm",
    }
    agent_id = next(link["agent_id"] for link in client.get(BASE, headers=me).json()["links"] if link["id"] == e.id)
    assert made["started_at"].startswith("2026-11-19T10:00:00") and made["agent_id"] == agent_id and agent_id
    assert (tmp_path / "recordings" / me["X-Test-User"] / f"{rid}.webm").read_bytes() == WEBM
    # Listed, newest first; by its agent too.
    second = _upload(client, e, query="started_at=2026-11-19T11:00:00Z&duration_ms=0").json()
    assert second["name"] == "scenario" and second["origin"] is None and second["call_id"] is None
    listed = client.get(RECORDINGS, headers=me).json()["recordings"]
    assert [x["id"] for x in listed] == [second["id"], rid]
    assert len(client.get(f"{RECORDINGS}?agent_id={agent_id}", headers=me).json()["recordings"]) == 2
    assert client.get(f"{RECORDINGS}?agent_id={uuid.uuid4()}", headers=me).json() == {"recordings": []}
    assert client.get(f"{RECORDINGS}?agent_id=nope", headers=me).json() == {"recordings": []}
    assert client.get(f"{RECORDINGS}/{rid}", headers=me).json() == made
    # Played whole, or the part a player asks for.
    whole = client.get(f"{RECORDINGS}/{rid}/video", headers=me)
    assert (whole.status_code, whole.content, whole.headers["content-type"], whole.headers["accept-ranges"]) == (200, WEBM, "video/webm", "bytes")
    assert "Checkout-with-an-expired-card.webm" in whole.headers["content-disposition"]
    part = client.get(f"{RECORDINGS}/{rid}/video", headers={**me, "Range": "bytes=10-19"})
    assert (part.status_code, part.content, part.headers["content-range"]) == (206, WEBM[10:20], f"bytes 10-19/{len(WEBM)}")
    tail = client.get(f"{RECORDINGS}/{rid}/video", headers={**me, "Range": "bytes=-5"})
    assert (tail.status_code, tail.content) == (206, WEBM[-5:])
    beyond = client.get(f"{RECORDINGS}/{rid}/video", headers={**me, "Range": f"bytes={len(WEBM)}-"})
    assert (beyond.status_code, beyond.headers["content-range"]) == (416, f"bytes */{len(WEBM)}")
    # Another person's are not there.
    other = {"X-Test-User": f"test-{uuid.uuid4().hex}"}
    assert client.get(RECORDINGS, headers=other).json() == {"recordings": []}
    for path in (f"{RECORDINGS}/{rid}", f"{RECORDINGS}/{rid}/video"):
        assert refusal(client.get(path, headers=other)) == (404, "recording_gone")
    assert refusal(client.delete(f"{RECORDINGS}/{rid}", headers=other)) == (404, "recording_gone")
    # Unpairing keeps them; deleting one takes its video too.
    assert e.unpair().status_code in (200, 204)
    assert len(client.get(RECORDINGS, headers=me).json()["recordings"]) == 2
    assert client.delete(f"{RECORDINGS}/{rid}", headers=me).status_code == 204
    assert not (tmp_path / "recordings" / me["X-Test-User"] / f"{rid}.webm").exists()
    assert refusal(client.get(f"{RECORDINGS}/{rid}", headers=me)) == (404, "recording_gone")
    assert [x["id"] for x in client.get(RECORDINGS, headers=me).json()["recordings"]] == [second["id"]]


@needs_db
def test_an_upload_is_refused_unless_it_is_a_paired_recorders_webm_within_the_limits(client: TestClient, me: dict[str, str], tmp_path: Path) -> None:
    e = paired(client, me)
    # Its own secret only; a link nobody claimed has no account to keep it for.
    assert refusal(_upload(client, e, secret="wrong")) == (401, "unpaired")
    waiting = Extension(client, "Waiting")
    assert refusal(_upload(client, waiting)) == (409, "not_claimed")
    # A WebM, of the size and with the fields the protocol says.
    assert refusal(_upload(client, e, content_type="video/mp4")) == (415, "not_webm")
    assert refusal(_upload(client, e, body=b"x" * 10_001)) == (413, "too_big")
    assert refusal(_upload(client, e, body=b"")) == (422, "empty_recording")
    for query in ("started_at=yesterday&duration_ms=1", "started_at=2026-11-19T10:00:00Z&duration_ms=-1", "started_at=2026-11-19T10:00:00Z&duration_ms=x",
                  f"started_at=2026-11-19T10:00:00Z&duration_ms=1&name={'n' * 121}", "started_at=2026-11-19T10:00:00Z&duration_ms=1&call_id=a/b",
                  f"started_at=2026-11-19T10:00:00Z&duration_ms=1&origin={'o' * 256}"):
        assert refusal(_upload(client, e, query=query)) == (422, "invalid_recording"), query
    assert not list((tmp_path / "recordings").rglob("*.webm"))
    # At most recording_max_count kept (3 here).
    for _ in range(3):
        assert _upload(client, e).status_code == 201
    assert refusal(_upload(client, e)) == (409, "too_many_recordings")
    assert len(list((tmp_path / "recordings").rglob("*.webm"))) == 3
    # Nothing left half-written by the refusals.
    assert not list((tmp_path / "recordings").rglob("*.tmp"))


@needs_db
def test_an_upload_is_held_to_the_persons_storage_quota(ui_dist: Path, migrated_db_url: str, tmp_path: Path, me: dict[str, str]) -> None:
    # Room for two of WEBM (3004 bytes each), not three.
    c = _client(ui_dist, migrated_db_url, tmp_path, recording_dir=tmp_path / "recordings", recording_max_bytes=10_000, storage_quota_bytes=7000, browser_link_starts_per_minute=10_000, **FAST)
    try:
        e = paired(c, me)
        first = _upload(c, e).json()
        assert _upload(c, e).status_code == 201
        # Said up front by its length...
        assert refusal(_upload(c, e)) == (409, "storage_full")

        # ...and, sent without one, cut off once it passes what is left.
        def chunked():
            yield WEBM[:1000]
            yield WEBM[1000:]

        assert refusal(c.post(f"{BASE}/{e.id}/recordings?{QUERY}", content=chunked(), headers={**ext(e.secret), "Content-Type": "video/webm"})) == (409, "storage_full")
        assert len(list((tmp_path / "recordings").rglob("*.webm"))) == 2
        assert not list((tmp_path / "recordings").rglob("*.tmp"))
        # Room made, it uploads again.
        assert c.delete(f"{RECORDINGS}/{first['id']}", headers=me).status_code == 204
        assert _upload(c, e).status_code == 201
    finally:
        c.__exit__(None, None, None)
        with create_engine(migrated_db_url).begin() as conn:
            conn.execute(text("DELETE FROM browser_links WHERE user_id IS NULL"))


@needs_db
def test_only_a_type_that_lists_browser_record_uploads(client: TestClient, me: dict[str, str], migrated_db_url: str) -> None:
    e = paired(client, me)
    engine = create_engine(migrated_db_url)
    try:
        # A Mac's link (its type does not film): refused, as an op it does not take would be.
        with engine.begin() as conn:
            conn.execute(text("UPDATE browser_links SET agent_type_id = CAST(:t AS uuid) WHERE id = :i"), {"t": OSX_ID, "i": e.id})
        assert refusal(_upload(client, e)) == (422, "invalid_op")
    finally:
        with engine.begin() as conn:
            conn.execute(text("UPDATE browser_links SET agent_type_id = CAST(:t AS uuid) WHERE id = :i"), {"t": CHROME_ID, "i": e.id})
        engine.dispose()
    assert _upload(client, e).status_code == 201


def test_the_person_must_be_signed_in(ui_dist: Path) -> None:
    with make_client(ui_dist, auth_issuer="https://wysebee-test.us.auth0.com/") as c:
        for path in (RECORDINGS, f"{RECORDINGS}/{'a' * 32}", f"{RECORDINGS}/{'a' * 32}/video"):
            assert c.get(path).status_code == 401
        assert c.delete(f"{RECORDINGS}/{'a' * 32}").status_code == 401


@needs_db
def test_a_video_whose_file_is_gone_is_said_to_be_gone(client: TestClient, me: dict[str, str], tmp_path: Path) -> None:
    e = paired(client, me)
    rid = _upload(client, e).json()["id"]
    (tmp_path / "recordings" / me["X-Test-User"] / f"{rid}.webm").unlink()
    # The row is still listed; its video is not there to play.
    assert client.get(f"{RECORDINGS}/{rid}", headers=me).status_code == 200
    assert refusal(client.get(f"{RECORDINGS}/{rid}/video", headers=me)) == (404, "recording_gone")


@needs_db
def test_a_recording_that_cannot_be_kept_leaves_no_video_behind(client: TestClient, me: dict[str, str], migrated_db_url: str, tmp_path: Path, monkeypatch) -> None:
    e = paired(client, me)
    agent_id = next(link["agent_id"] for link in client.get(BASE, headers=me).json()["links"] if link["id"] == e.id)
    store = client.app.state.recording_store
    written = store.write

    async def write_then_lose_the_agent(*args, **kwargs):
        size = await written(*args, **kwargs)
        # The agent deleted while its video uploaded: the row cannot name it.
        with create_engine(migrated_db_url).begin() as conn:
            conn.execute(text("DELETE FROM user_agents WHERE agent_id = CAST(:a AS uuid)"), {"a": agent_id})
        return size

    monkeypatch.setattr(store, "write", write_then_lose_the_agent)
    with pytest.raises(Exception, match="foreign key"):
        _upload(client, e)
    assert not list((tmp_path / "recordings").rglob("*.webm"))
    assert client.get(RECORDINGS, headers=me).json() == {"recordings": []}
