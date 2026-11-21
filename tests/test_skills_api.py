"""Skills (apps/cloud/skills.py): the person's library, by id, and their agents' skills,
against a real database (skipped without WYSEBEE_TEST_DATABASE_URL). The caller is faked with
X-Test-User."""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud import skills
from tests.cloud_agent_fixtures import _agent, _agent_id, _skill, client, me  # noqa: F401 — fixtures
from tests.conftest import needs_db

pytestmark = needs_db

MANIFEST = b"---\nname: forecast\ndescription: Weather.\n---\nLook outside.\n"


def stored(client: TestClient, me: dict[str, str], data: bytes) -> dict:
    return client.put("/api/v1/skill-files", content=data, headers=me).json()


def detail(r) -> tuple[int, str]:
    return r.status_code, r.json()["detail"]


def skill_md(client: TestClient, me: dict[str, str], skill: dict) -> str:
    return client.get(f"/api/v1/skills/{skill['id']}/files/SKILL.md", headers=me).json()["content"]


def test_a_skill_is_made_read_renamed_and_deleted_by_its_id(client: TestClient, me: dict[str, str]) -> None:
    r = client.post("/api/v1/skills", json={"name": " forecast ", "description": " Weather. "}, headers=me)
    assert r.status_code == 201, r.text
    made = r.json()
    uuid.UUID(made["id"])
    # Trimmed; a SKILL.md made of them, a starter for instructions.
    assert (made["name"], made["description"], [f["path"] for f in made["files"]], made["folders"]) == ("forecast", "Weather.", ["SKILL.md"], [])
    assert skill_md(client, me, made).startswith('---\nname: forecast\ndescription: "Weather."\n---\n\n# forecast\n')
    assert client.get(f"/api/v1/skills/{made['id']}", headers=me).json() == made
    assert client.get("/api/v1/skills", headers=me).json() == {"skills": [made]}
    # With instructions and no description: those, and a description asking for one.
    other = client.post("/api/v1/skills", json={"name": "other", "instructions": "Do it."}, headers=me).json()
    assert other["description"] == "Say what other does and when to use it." and skill_md(client, me, other).endswith("---\n\nDo it.\n")
    # Renamed: the same id, its SKILL.md's name with it, and the old SKILL.md's bytes dropped.
    before = made["files"][0]["id"]
    r = client.put(f"/api/v1/skills/{made['id']}", json={"name": "weather"}, headers=me)
    assert r.status_code == 200, r.text
    assert (r.json()["id"], r.json()["name"], r.json()["description"]) == (made["id"], "weather", "Weather.")
    assert skill_md(client, me, made).startswith("---\nname: weather\n")
    assert client.get(f"/api/v1/skill-files/{before}", headers=me).status_code == 404
    # Deleted: its files go, but not one another skill still has.
    for skill in (made, other):
        assert client.put(f"/api/v1/skills/{skill['id']}/files/notes.md", json={"content": "Sunny."}, headers=me).status_code == 200
    notes = next(f["id"] for f in client.get(f"/api/v1/skills/{made['id']}", headers=me).json()["files"] if f["path"] == "notes.md")
    assert client.delete(f"/api/v1/skills/{made['id']}", headers=me).status_code == 204
    assert client.get(f"/api/v1/skill-files/{notes}", headers=me).status_code == 200
    assert client.delete(f"/api/v1/skills/{other['id']}", headers=me).status_code == 204
    assert client.get(f"/api/v1/skill-files/{notes}", headers=me).status_code == 404
    assert client.get("/api/v1/skills", headers=me).json() == {"skills": []}


def test_a_skill_is_checked_as_the_desktop_checks_it(client: TestClient, me: dict[str, str], monkeypatch) -> None:
    for sent, said in (
        ({"name": "Forecast"}, "'Forecast': a skill's name starts with a lowercase letter"),
        ({"name": "x" * 41}, "a skill's name starts"),
        ({"name": "forecast", "description": "x" * 1025}, "describe what it is for"),
    ):
        status, why = detail(client.post("/api/v1/skills", json=sent, headers=me))
        assert status == 422 and said in why, (sent["name"], why)
    # A name is the person's once.
    made = client.post("/api/v1/skills", json={"name": "forecast"}, headers=me).json()
    assert detail(client.post("/api/v1/skills", json={"name": "forecast"}, headers=me)) == (409, "There is already a skill named 'forecast'.")
    second = client.post("/api/v1/skills", json={"name": "second"}, headers=me).json()
    assert detail(client.put(f"/api/v1/skills/{second['id']}", json={"name": "forecast"}, headers=me)) == (409, "There is already a skill named 'forecast'.")
    assert client.put(f"/api/v1/skills/{second['id']}", json={"name": "Bad"}, headers=me).status_code == 422
    # …and a clash the check could not see is the same 409.
    async def free(*args, **kwargs) -> None:
        return None

    monkeypatch.setattr(skills, "_taken", free)
    assert detail(client.post("/api/v1/skills", json={"name": "forecast"}, headers=me)) == (409, "There is already a skill named 'forecast'.")
    monkeypatch.undo()
    # At most so many in the library.
    monkeypatch.setattr(skills, "MAX_SKILLS", 2)
    assert detail(client.post("/api/v1/skills", json={"name": "third"}, headers=me)) == (422, "The library holds at most 2 skills. Delete one first.")
    assert client.get(f"/api/v1/skills/{made['id']}", headers=me).status_code == 200


def test_another_persons_skill_or_no_skill_is_not_found(client: TestClient, me: dict[str, str]) -> None:
    made = _skill(client, me, "forecast", MANIFEST)
    someone = {"X-Test-User": f"test-{uuid.uuid4().hex}"}
    for who, skill_id in ((someone, made["id"]), (me, str(uuid.uuid4())), (me, "-" * 32)):
        assert client.get(f"/api/v1/skills/{skill_id}", headers=who).status_code == 404, skill_id
        assert client.delete(f"/api/v1/skills/{skill_id}", headers=who).status_code == 404, skill_id
    assert client.get("/api/v1/skills/not-an-id", headers=me).status_code == 422
    assert client.get("/api/v1/skills", headers=someone).json() == {"skills": []}


def test_a_file_whose_bytes_cannot_be_deleted_is_left_behind(client: TestClient, me: dict[str, str], monkeypatch) -> None:
    made = _skill(client, me, "forecast", MANIFEST)

    async def broken(user_id: str, file_id: str) -> None:
        raise OSError("the store is down")

    monkeypatch.setattr(client.app.state.skill_file_store, "delete", broken)
    assert client.delete(f"/api/v1/skills/{made['id']}", headers=me).status_code == 204
    assert client.get("/api/v1/skills", headers=me).json() == {"skills": []}


def test_an_agent_is_given_skills_in_order_and_keeps_them_through_a_rename(client: TestClient, me: dict[str, str], monkeypatch, migrated_db_url: str) -> None:
    _agent(client, me, "sky", {"label": "Sky"})
    agent = _agent_id(client, me, "sky")
    url = f"/api/v1/agents/{agent}/skills"
    a, b = _skill(client, me, "alpha"), _skill(client, me, "beta")
    assert client.get(url, headers=me).json() == {"skills": []}
    r = client.put(url, json={"skill_ids": [b["id"], a["id"].upper()]}, headers=me)
    assert r.status_code == 200, r.text
    assert [s["name"] for s in r.json()["skills"]] == ["beta", "alpha"]
    # Renamed, still the agent's — the skill, or the agent.
    client.put(f"/api/v1/skills/{b['id']}", json={"name": "gamma"}, headers=me)
    assert [s["name"] for s in client.get(url, headers=me).json()["skills"]] == ["gamma", "alpha"]
    assert client.put(f"/api/v1/agents/{agent}", json={"name": "skye"}, headers=me).json()["name"] == "skye"
    assert [s["name"] for s in client.get(url, headers=me).json()["skills"]] == ["gamma", "alpha"]
    # Refused: not ids, twice, too many, another person's or no skill.
    someone = {"X-Test-User": f"test-{uuid.uuid4().hex}"}
    theirs = _skill(client, someone, "theirs")
    try:
        assert detail(client.put(url, json={"skill_ids": ["nope"]}, headers=me)) == (422, "'skill_ids' holds skills' ids.")
        assert detail(client.put(url, json={"skill_ids": [a["id"], a["id"]]}, headers=me)) == (422, "A skill is in 'skill_ids' twice.")
        assert detail(client.put(url, json={"skill_ids": [theirs["id"]]}, headers=me)) == (404, "There is no such skill.")
        assert detail(client.put(url, json={"skill_ids": [str(uuid.uuid4())]}, headers=me)) == (404, "There is no such skill.")
        monkeypatch.setattr(skills, "MAX_ATTACHED", 1)
        assert detail(client.put(url, json={"skill_ids": [a["id"], b["id"]]}, headers=me)) == (422, "An agent has at most 1 skills.")
        # Another person's agent, none, or an id that is not one.
        for who, path in ((someone, url), (me, f"/api/v1/agents/{uuid.uuid4()}/skills"), (me, f"/api/v1/agents/{'-' * 32}/skills")):
            assert detail(client.get(path, headers=who)) == (404, "There is no such agent.")
            assert client.put(path, json={"skill_ids": []}, headers=who).status_code == 404
        assert client.get("/api/v1/agents/nobody/skills", headers=me).status_code == 422
    finally:
        client.delete(f"/api/v1/skills/{theirs['id']}", headers=someone)
    # A skill deleted leaves the agent; the agent deleted leaves its links, not the skills.
    assert client.delete(f"/api/v1/skills/{a['id']}", headers=me).status_code == 204
    assert [s["name"] for s in client.get(url, headers=me).json()["skills"]] == ["gamma"]
    assert client.delete(f"/api/v1/agents/{agent}", headers=me).status_code == 204
    assert client.get(url, headers=me).status_code == 404
    with create_engine(migrated_db_url).begin() as conn:
        assert conn.execute(text("SELECT count(*) FROM agent_skills WHERE agent_id = :a"), {"a": agent}).scalar() == 0
    again = _agent(client, me, "sky", {"label": "Sky"})
    assert again != agent and client.get(f"/api/v1/agents/{again}/skills", headers=me).json() == {"skills": []}
    assert [s["name"] for s in client.get("/api/v1/skills", headers=me).json()["skills"]] == ["gamma"]


def test_a_skill_says_which_of_the_persons_agents_have_it(client: TestClient, me: dict[str, str]) -> None:
    skill = _skill(client, me, "forecast")
    url = f"/api/v1/skills/{skill['id']}/agents"
    assert client.get(url, headers=me).json() == {"agents": []}
    sky = _agent(client, me, "sky", {"label": "Sky"})
    plain = _agent(client, me, "plain", {})
    _agent(client, me, "other", {"label": "Other"})
    for agent_id in (sky, plain):
        assert client.put(f"/api/v1/agents/{agent_id}/skills", json={"skill_ids": [skill["id"]]}, headers=me).status_code == 200
    assert client.get(url, headers=me).json() == {"agents": [
        {"id": plain, "name": "plain", "label": "plain"}, {"id": sky, "name": "sky", "label": "Sky"},
    ]}
    assert client.get(f"/api/v1/skills/{uuid.uuid4()}/agents", headers=me).status_code == 404
