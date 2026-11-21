"""The skills of agents living in Wysebee Cloud (apps/cloud/agent_chat/tools.py), read from the
cloud and run as Wysebee Assistant runs them, against a real database (skipped without
WYSEBEE_TEST_DATABASE_URL). The caller is faked with X-Test-User."""

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud.agent_chat import tools
from tests.cloud_agent_fixtures import _agent, _box, _call, _skill, client, me  # noqa: F401 — fixtures
from tests.conftest import needs_db


def test_a_manifest_is_read_as_the_desktop_reads_it() -> None:
    assert tools.parse_manifest("Just text.") == ("Just text.", [])
    assert tools.parse_manifest("---\nscripts:\n  - name: 'it''s'\n    command: \"bad \\q\"\n---\nB")[1] == [{"name": "it's", "command": "bad \\q"}]


@needs_db
def test_a_cloud_agent_reads_its_skills_from_the_cloud(client: TestClient, me: dict[str, str], migrated_db_url: str) -> None:  # noqa: F811
    manifest = b'---\n# a comment\nname: forecast\ndescription: Weather.\nmetadata:\n  team: ops\nscripts:\n  - name: run\n    command: "python3 run.py"\n    description: Fetches it.\n  -\n    name: other\n    command: ./x.sh\n---\nRead notes.md first.\n'
    stored = {path: client.put("/api/v1/skill-files", content=data, headers=me).json() for path, data in (("notes.md", b"Sunny."), ("blob.bin", b"\0\1"), ("gone.md", b"Soon gone."))}
    _skill(client, me, "forecast", manifest, files=[{"path": p, "id": f["id"]} for p, f in stored.items()], description="Weather.")
    # Its file deleted from the store since: listed, not there.
    assert client.delete(f"/api/v1/skill-files/{stored['gone.md']['id']}", headers=me).status_code == 204
    bare = _skill(client, me, "bare", description="No files.")
    # A skill with no SKILL.md at all (none can be made so; one read as such is shown bare).
    with create_engine(migrated_db_url).begin() as conn:
        conn.execute(text("UPDATE user_skills SET files = '[]'::jsonb WHERE skill_id = CAST(:i AS uuid)"), {"i": bare["id"]})
    _agent(client, me, "sky", {"label": "Sky", "skills": ["forecast", "bare", "missing"]})
    calls = [
        ("load_skill", {"name": "forecast"}), ("skill_read_file", {"skill": "forecast", "path": "./notes.md"}), ("skill_read_file", {"skill": "forecast", "path": "blob.bin"}),
        ("skill_read_file", {"skill": "forecast", "path": "nope.md"}), ("skill_read_file", {"skill": "forecast", "path": "gone.md"}), ("load_skill", {"name": "missing"}), ("load_skill", {"name": "bare"}),
        ("skill_run_script", {"skill": "forecast", "script": "run"}),
    ]
    out = [_call(client, me, "sky", n, a) for n, a in calls]
    assert out[0].text.startswith("# Skill: forecast\n\nWeather.\n\nRead notes.md first.")
    assert "- notes.md (6 bytes)" in out[0].text and "- run — `python3 run.py`: Fetches it." in out[0].text and "- other — `./x.sh`" in out[0].text
    assert "not here" in out[0].text and "Wysebee Agent for Mac" in out[0].text
    assert (out[1].text, out[1].is_error) == ("Sunny.", False)
    assert out[2].text == "'blob.bin' is not a text file."
    assert "no file 'nope.md'" in out[3].text
    assert "not in Wysebee Cloud yet" in out[4].text
    assert "'missing' is not one of your skills" in out[5].text
    assert out[6].text.startswith("# Skill: bare\n\nNo files.")
    assert out[7].text == "'skill_run_script' is not one of your tools."
    box = _box(client, me, "sky")
    assert "- forecast: Weather." in box.skill_note and {"load_skill", "skill_read_file"} <= box.offered


@needs_db
def test_an_agent_is_found_by_handle_and_wysebee_has_its_defaults_until_stored(client: TestClient, me: dict[str, str]) -> None:  # noqa: F811
    from apps.cloud import agents

    async def found(name: str):
        async with client.app.state.db.sessionmaker() as session:
            return await agents.find(session, me["X-Test-User"], name)

    assert client.portal.call(found, "odd") is None and client.portal.call(found, 7) is None
    wysebee = client.portal.call(found, "@wysebee")
    assert (wysebee.agent_id, wysebee.name, wysebee.config) == (None, "wysebee", {"label": "Wysebee", "browser_access": False})
    # Not stored yet: no skills or tools, and nothing but its notification tool.
    box = _box(client, me, "wysebee")
    assert (box.skills, box.databases, box.offered) == ([], [], {"send_notification"})
    _agent(client, me, "wysebee", {"label": "Mine"})
    assert client.portal.call(found, "wysebee").config["label"] == "Mine"
