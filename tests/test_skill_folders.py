"""A skill edited as a folder (apps/cloud/skill_folders.py): its files and folders, one at a
time, against the real test database and a file store in a temporary folder."""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud import browser_links, skills
from tests.cloud_agent_fixtures import _put_skill_file, _revision, client, me  # noqa: F401 — fixtures
from tests.conftest import needs_db

pytestmark = needs_db


def make(client: TestClient, me: dict[str, str], name: str = "forecast") -> dict:
    r = client.post("/api/v1/skills", json={"name": name, "description": "Weather."}, headers=me)
    assert r.status_code == 201, r.text
    return r.json()


def url(skill: dict, kind: str, path: str) -> str:
    return f"/api/v1/skills/{skill['id']}/{kind}/{path}"


def write(client: TestClient, me: dict[str, str], skill: dict, path: str, content: str):
    return client.put(url(skill, "files", path), json={"content": content}, headers=me)


def read(client: TestClient, me: dict[str, str], skill: dict, path: str):
    return client.get(url(skill, "files", path), headers=me)


def paths(client: TestClient, me: dict[str, str], skill: dict) -> tuple[list[str], list[str]]:
    got = client.get(f"/api/v1/skills/{skill['id']}", headers=me).json()
    return [f["path"] for f in got["files"]], got["folders"]


def test_files_are_written_as_text_or_bytes_and_read_back(client: TestClient, me: dict[str, str]) -> None:
    skill = make(client, me)
    before = _revision(client, me)
    r = write(client, me, skill, "/scripts/run.py/", "print('hi')\n")
    assert r.status_code == 200, r.text
    assert [f["path"] for f in r.json()["files"]] == ["SKILL.md", "scripts/run.py"]
    assert _revision(client, me) > before
    assert read(client, me, skill, "scripts/run.py").json() == {"path": "scripts/run.py", "content": "print('hi')\n", "size": 12}
    # An upload: its bytes as they are; not text, so not read here.
    assert _put_skill_file(client, me, skill["id"], "assets/logo.png", b"\x89PNG\xff").status_code == 200
    assert read(client, me, skill, "assets/logo.png").status_code == 422
    assert read(client, me, skill, "nope.md").status_code == 404
    # A JSON body that is not {content}, an empty upload, a path that is not one.
    bad_json = client.put(url(skill, "files", "x.md"), content=b'{"text": 1}', headers={**me, "Content-Type": "application/json"})
    assert bad_json.status_code == 422
    assert _put_skill_file(client, me, skill["id"], "empty.txt", b"").status_code == 422
    assert write(client, me, skill, "a//b.md", "x").status_code == 422


def test_skill_md_is_the_skills_card(client: TestClient, me: dict[str, str]) -> None:
    skill = make(client, me)
    # Its description is the skill's; its name is the skill's whatever was written.
    r = write(client, me, skill, "SKILL.md", "---\nname: other\ndescription: Rain or shine.\n---\nLook up.\n")
    assert r.status_code == 200 and r.json()["description"] == "Rain or shine."
    assert read(client, me, skill, "SKILL.md").json()["content"] == "---\nname: forecast\ndescription: Rain or shine.\n---\nLook up.\n"
    # What cannot be read, or is not text, is refused and nothing changes.
    unreadable = write(client, me, skill, "SKILL.md", "---\nname: forecast\n---\n")
    assert unreadable.status_code == 422 and "describe what it is for" in unreadable.json()["detail"]
    assert _put_skill_file(client, me, skill["id"], "SKILL.md", b"\xff\xfe").json()["detail"] == "SKILL.md is text."
    assert client.delete(url(skill, "files", "SKILL.md"), headers=me).json()["detail"] == "A skill needs its SKILL.md."
    assert client.get(f"/api/v1/skills/{skill['id']}", headers=me).json()["description"] == "Rain or shine."


def test_what_a_skill_may_hold(client: TestClient, me: dict[str, str], monkeypatch) -> None:
    skill = make(client, me)
    secret = write(client, me, skill, "conf/.env", "KEY=1")
    assert secret.status_code == 422 and "looks like it holds a secret" in secret.json()["detail"]
    assert write(client, me, skill, "notes.md", "x").status_code == 200
    assert write(client, me, skill, "Notes.md", "x").json()["detail"] == "Two files are at 'Notes.md'."
    assert write(client, me, skill, "notes.md/more.md", "x").json()["detail"] == "'notes.md' is a file, and also a folder."
    assert client.post(url(skill, "folders", "notes.md"), headers=me).json()["detail"] == "'notes.md' is a file, and also a folder."
    # Too large, as text or as an upload; too many files.
    monkeypatch.setattr(client.app.state.settings, "skill_file_max_bytes", 8)
    assert write(client, me, skill, "big.md", "x" * 9).status_code == 413
    assert _put_skill_file(client, me, skill["id"], "big.bin", b"x" * 9).status_code == 413
    monkeypatch.setattr(skills, "MAX_FILES", 2)
    assert write(client, me, skill, "third.md", "x").json()["detail"] == "A skill keeps at most 2 files in Wysebee Cloud."
    # Replacing one is not one more.
    assert write(client, me, skill, "notes.md", "y").status_code == 200


def test_folders_are_made_kept_when_emptied_and_deleted_with_what_they_hold(client: TestClient, me: dict[str, str]) -> None:
    skill = make(client, me)
    assert client.post(url(skill, "folders", "scripts/lib"), headers=me).status_code == 201
    # Again, or a folder above it, or one that holds files: nothing more.
    assert client.post(url(skill, "folders", "scripts/lib"), headers=me).status_code == 201
    assert paths(client, me, skill) == (["SKILL.md"], ["scripts/lib"])
    # A file in it: no longer an empty folder.
    write(client, me, skill, "scripts/lib/util.py", "x")
    assert client.post(url(skill, "folders", "scripts"), headers=me).status_code == 201
    assert paths(client, me, skill) == (["SKILL.md", "scripts/lib/util.py"], [])
    # Its last file deleted: the folder stays.
    assert client.delete(url(skill, "files", "scripts/lib/util.py"), headers=me).status_code == 204
    assert paths(client, me, skill) == (["SKILL.md"], ["scripts/lib"])
    assert client.delete(url(skill, "files", "scripts/lib/util.py"), headers=me).status_code == 404
    # A folder deleted with what it holds; its parent stays.
    write(client, me, skill, "scripts/lib/a.py", "a")
    write(client, me, skill, "scripts/lib/deep/b.py", "b")
    assert client.delete(url(skill, "folders", "scripts/lib"), headers=me).status_code == 204
    assert paths(client, me, skill) == (["SKILL.md"], ["scripts"])
    assert client.delete(url(skill, "folders", "scripts"), headers=me).status_code == 204
    assert paths(client, me, skill) == (["SKILL.md"], [])
    assert client.delete(url(skill, "folders", "scripts"), headers=me).status_code == 404
    # A file at the top deleted leaves nothing behind; a folder at the top deleted, none either.
    write(client, me, skill, "top.md", "x")
    assert client.delete(url(skill, "files", "top.md"), headers=me).status_code == 204
    write(client, me, skill, "refs/a.md", "x")
    assert client.delete(url(skill, "folders", "refs"), headers=me).status_code == 204
    assert paths(client, me, skill) == (["SKILL.md"], [])


def test_a_change_drops_unused_bytes_and_wakes_the_macs(client: TestClient, me: dict[str, str], monkeypatch) -> None:
    skill = make(client, me)
    woken: list[str] = []
    real = browser_links.wake_for_skill

    async def spy(session, user_id, skill_id):
        woken.append(skill_id)
        await real(session, user_id, skill_id)

    monkeypatch.setattr(browser_links, "wake_for_skill", spy)
    old = write(client, me, skill, "notes.md", "One.").json()["files"][1]["id"]
    write(client, me, skill, "notes.md", "Two.")
    assert client.get(f"/api/v1/skill-files/{old}", headers=me).status_code == 404
    assert woken == [skill["id"], skill["id"]]


def test_a_rename_with_no_skill_md_kept_only_renames(client: TestClient, me: dict[str, str], migrated_db_url: str) -> None:
    skill = make(client, me)
    with create_engine(migrated_db_url).begin() as conn:
        conn.execute(text("UPDATE user_skills SET files = '[]'::jsonb WHERE skill_id = CAST(:i AS uuid)"), {"i": skill["id"]})
    r = client.put(f"/api/v1/skills/{skill['id']}", json={"name": "renamed"}, headers=me)
    assert (r.status_code, r.json()["name"], r.json()["files"]) == (200, "renamed", [])


def test_another_persons_skill_is_not_there(client: TestClient, me: dict[str, str], migrated_db_url: str) -> None:
    skill = make(client, me)
    someone = {"X-Test-User": f"test-{uuid.uuid4().hex}"}
    for method, kind in (("GET", "files"), ("PUT", "files"), ("DELETE", "files"), ("POST", "folders"), ("DELETE", "folders")):
        r = client.request(method, url(skill, kind, "x.md"), json={"content": "x"}, headers=someone)
        assert r.status_code == 404, (method, kind)
    with create_engine(migrated_db_url).begin() as conn:
        conn.execute(text("DELETE FROM cloud_config_heads WHERE user_id = :u"), {"u": someone["X-Test-User"]})


def test_a_name_clash_only_the_index_sees_is_a_409(client: TestClient, me: dict[str, str], monkeypatch) -> None:
    import asyncio

    import pytest
    from fastapi import HTTPException
    from sqlalchemy.exc import IntegrityError

    make(client, me, "alpha")
    beta = make(client, me, "beta")

    async def free(*args, **kwargs) -> None:
        return None

    monkeypatch.setattr(skills, "_taken", free)
    r = client.put(f"/api/v1/skills/{beta['id']}", json={"name": "alpha"}, headers=me)
    assert (r.status_code, r.json()["detail"]) == (409, "There is already a skill named 'alpha'.")

    class Clashing:
        rolled_back = False

        async def commit(self) -> None:
            raise IntegrityError("COMMIT", {}, Exception("ix_user_skills_user_name"))

        async def rollback(self) -> None:
            self.rolled_back = True

    session = Clashing()
    with pytest.raises(HTTPException) as refused:
        asyncio.run(skills._commit(session, "alpha"))  # type: ignore[arg-type]
    assert refused.value.status_code == 409 and session.rolled_back
