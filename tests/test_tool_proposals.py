"""What the person's AI app may only propose through Wysebee Assistant (apps/cloud/tool_drafts.py,
docs/ai-apps-propose.md): a change to a SQL tool, a site link, a program, a switch turned on —
each kept for the person, never used until they accept it on the website."""

import json

from fastapi.testclient import TestClient

from apps.cloud.agent_chat import toolbox  # noqa: F401 — the agent's tools
from tests.cloud_agent_fixtures import (  # noqa: F401 — fixtures
    _agent,
    _agent_id,
    _agents,
    _box,
    _config,
    _connect,
    _give_tools,
    _offered,
    _save_config,
    _save_tool,
    client,
    me,
)
from tests.conftest import needs_db
from tests.test_agent_mcp import _call as _assistant
from tests.test_agent_mcp import _signed, fake_verifier  # noqa: F401 — fixtures
from tests.test_cloud_agent_browser import _paired
from tests.test_cloud_agent_mac import _web_mac
from tests.test_cloud_postgres import _cfg, _db, loopback, table  # noqa: F401 — fixtures
from tests.test_cloud_snowflake import GOOD, Snow, rows


def _ask(client: TestClient, me: dict[str, str], tool: str, args: dict) -> tuple[str, bool]:
    out = _assistant(client, _signed(client, me), tool, args)
    return out["content"][0]["text"], out["isError"]


def _tool(client: TestClient, me: dict[str, str], kind: str, name: str) -> dict:
    return next(t for t in client.get(f"/api/v1/tools?kind={kind}", headers=me).json()["tools"] if t["name"] == name)


@needs_db
def test_a_change_to_a_sql_tool_waits_while_the_tool_runs_as_it_was(client: TestClient, me: dict[str, str], loopback, table: str) -> None:  # noqa: F811
    conn = _connect(client, me, "sky", "postgres", "shop", _cfg(password=_db()["password"])).json()["id"]
    body = {"connection_id": conn, "params": [], "sql": f"SELECT count(*) FROM {table}"}
    assert _save_tool(client, me, "sql", "count_rows", description="Counts.", config=body).status_code == 201
    _give_tools(client, me, "sky", "sql", ["count_rows"])
    new = {"agent": "sky", "tool": "count_rows", "name": "count_some", "description": "Counts some.", "connection": "shop", "sql": f"SELECT count(*) FROM {table} WHERE id > 1"}
    said, err = _ask(client, me, "propose_sql_tool_change", new)
    assert not err and "goes on using count_rows as it is" in json.loads(said)["note"]
    kept = _tool(client, me, "sql", "count_rows")
    assert kept["config"]["pending"]["name"] == "count_some" and kept["config"]["sql"] == body["sql"]
    # The live version runs; the agent sees no change.
    assert _offered(client, me, "sky") == {"send_notification", "count_rows"}
    assert "(a change proposed, waiting for the person)" in _ask(client, me, "list_database_connections", {"agent": "sky"})[0]
    assert client.get("/api/v1/notifications", headers=me).json()["notifications"][0]["title"] == "Review a change to the SQL tool count_rows"
    # Refused: a tool it does not have, a name another tool has.
    assert _ask(client, me, "propose_sql_tool_change", {**new, "tool": "nope"}) == ("Say which of @sky's SQL tools, by its name now: count_rows.", True)
    assert _save_tool(client, me, "sql", "other", description="O.", config=body).status_code == 201
    assert _ask(client, me, "propose_sql_tool_change", {**new, "name": "other"})[0].startswith("The person already has a SQL tool named 'other'")
    # The person applies it from the website: the new version, nothing pending.
    p = kept["config"]["pending"]
    applied = _save_tool(client, me, "sql", p["name"], description=p["description"], config=p["config"], tool_id=kept["id"])
    assert applied.status_code == 200 and "pending" not in applied.json()["config"]
    assert _offered(client, me, "sky") == {"send_notification", "count_some"}
    # A draft is simply redrafted.
    draft = {"agent": "sky", "name": "drafty", "description": "D.", "connection": "shop", "sql": "SELECT 1"}
    assert not _ask(client, me, "draft_sql_tool", draft)[1]
    assert not _ask(client, me, "propose_sql_tool_change", {**draft, "tool": "drafty", "sql": "SELECT 2"})[1]
    redrafted = _tool(client, me, "sql", "drafty")["config"]
    assert (redrafted["sql"], redrafted["draft"], "pending" in redrafted) == ("SELECT 2", True, False)


@needs_db
def test_a_site_link_is_drafted_for_a_browser_agent_only(client: TestClient, me: dict[str, str]) -> None:
    _agent(client, me, "plain", {"label": "Plain"})
    link = {"agent": "plain", "kind": "news", "address": "https://bbc.com/news", "description": "World news."}
    said, err = _ask(client, me, "draft_site_link", link)
    assert err and "browser extension" in said
    _paired(client, me, "Scout")
    said, err = _ask(client, me, "draft_site_link", {**link, "agent": "scout"})
    assert not err and json.loads(said)["drafted"] == "https://bbc.com/news"
    kept = _tool(client, me, "news", "https://bbc.com/news")
    assert kept["config"] == {"address": "https://bbc.com/news", "draft": True}
    assert [t["name"] for t in client.get(f"/api/v1/agents/{_agent_id(client, me, 'scout')}/tools", headers=me).json()["tools"] if t["kind"] == "news"] == ["https://bbc.com/news"]
    # Refused: a link that is not one, a kind that is not one, one the person has.
    assert _ask(client, me, "draft_site_link", {**link, "agent": "scout", "address": "ftp://x"})[0].startswith("Give a link")
    assert _ask(client, me, "draft_site_link", {**link, "agent": "scout", "kind": "maps"})[1]
    assert "already has a news link" in _ask(client, me, "draft_site_link", {**link, "agent": "scout"})[0]
    # Created from the website: no longer a draft.
    created = _save_tool(client, me, "news", "https://bbc.com/news", description="World news.", config={"address": "https://bbc.com/news"}, tool_id=kept["id"])
    assert created.status_code == 200 and "draft" not in created.json()["config"]


@needs_db
def test_a_program_is_drafted_and_never_sent_to_the_mac_until_created(client: TestClient, me: dict[str, str]) -> None:
    m = _web_mac(client, me)
    handle = next(n for n in _agents(client, me) if n != "wysebee")
    program = {"agent": handle, "name": "say", "description": "Speaks.", "command": "/usr/bin/say", "args": [{"param": "text", "description": "What to say."}]}
    said, err = _ask(client, me, "draft_program", program)
    assert not err and "asks them to allow it" in json.loads(said)["note"]
    # Not the agent's, not the Mac's.
    assert "local_say" not in _offered(client, me, handle)
    assert m.poll().json().get("programs", []) == []
    kept = _tool(client, me, "program", "say")
    assert kept["config"]["draft"] is True
    assert _ask(client, me, "draft_program", {**program, "name": "Bad"})[0].startswith("A program has a name")
    assert _ask(client, me, "draft_program", program) == (f"The person already has a program named 'say': pick another name, or ask them to give it to @{handle} on its Tools tab.", True)
    _agent(client, me, "plain", {"label": "Plain"})
    assert "Wysebee Agent for Mac" in _ask(client, me, "draft_program", {**program, "agent": "plain"})[0]
    # Created: the Mac hears of it.
    assert _save_tool(client, me, "program", "say", description="Speaks.", config={"command": "/usr/bin/say", "args": program["args"]}, tool_id=kept["id"]).status_code == 200
    assert [p["name"] for p in m.poll().json()["programs"]] == ["say"]


@needs_db
def test_a_switch_is_only_requested(client: TestClient, me: dict[str, str]) -> None:
    _web_mac(client, me)
    handle = next(n for n in _agents(client, me) if n != "wysebee")
    asked = {"agent": handle, "switch": "screen_control", "reason": "To read the chart in Numbers."}
    said, err = _ask(client, me, "request_switch", asked)
    assert not err and json.loads(said)["requested"] == "screen_control"
    config = _config(client, me, handle)
    assert config.get("screen_control") is not True and config["switch_requests"] == {"screen_control": {"reason": "To read the chart in Numbers."}}
    assert client.get("/api/v1/notifications", headers=me).json()["notifications"][0]["title"] == "Your AI app asks to turn on Screen control"
    assert "screen_tap" not in str(_offered(client, me, handle))
    # Refused: a switch this agent may not have, one that is not one, no reason, one already on.
    assert "browser extension" in _ask(client, me, "request_switch", {**asked, "switch": "browser_access"})[0]
    assert _ask(client, me, "request_switch", {**asked, "switch": "root"})[1]
    assert _ask(client, me, "request_switch", {**asked, "reason": ""})[1]
    assert _save_config(client, me, handle, {**config, "screen_control": True}).status_code == 200
    assert _ask(client, me, "request_switch", asked) == (f"Screen control is on for @{handle} already.", True)
    _agent(client, me, "plain", {"label": "Plain"})
    assert _ask(client, me, "request_switch", {**asked, "agent": "plain"})[1]


@needs_db
def test_a_skill_is_only_requested_until_the_person_gives_it(client: TestClient, me: dict[str, str]) -> None:
    from tests.cloud_agent_fixtures import _skill

    _agent(client, me, "sky", {"label": "Sky"})
    sky = _agent_id(client, me, "sky")
    skill = _skill(client, me, "forecast", description="Weather.")
    asked = {"agent": "sky", "skill": "forecast", "reason": "To answer weather questions."}
    said, err = _ask(client, me, "propose_skill", asked)
    assert not err and "does not have forecast until the person gives it" in json.loads(said)["note"]
    # Not the agent's: only asked.
    assert client.get(f"/api/v1/agents/{sky}/skills", headers=me).json()["skills"] == []
    waiting = client.get(f"/api/v1/agents/{sky}/skill-requests", headers=me).json()["requests"]
    assert [(r["skill_id"], r["name"], r["reason"]) for r in waiting] == [(skill["id"], "forecast", "To answer weather questions.")]
    assert client.get("/api/v1/notifications", headers=me).json()["notifications"][0]["title"] == "Your AI app asks to give @sky the skill forecast"
    # Asked again: one request, its reason the newest.
    _ask(client, me, "propose_skill", {**asked, "reason": "Again."})
    assert [r["reason"] for r in client.get(f"/api/v1/agents/{sky}/skill-requests", headers=me).json()["requests"]] == ["Again."]
    # Refused: no reason, a skill the person does not have.
    assert _ask(client, me, "propose_skill", {**asked, "reason": ""})[1]
    assert _ask(client, me, "propose_skill", {**asked, "skill": "nope"})[0].startswith("The person has no skill named 'nope'")
    # Declined: gone, nothing given.
    assert client.delete(f"/api/v1/agents/{sky}/skill-requests/{skill['id']}", headers=me).status_code == 204
    assert client.delete(f"/api/v1/agents/{sky}/skill-requests/{skill['id']}", headers=me).status_code == 404
    assert client.get(f"/api/v1/agents/{sky}/skills", headers=me).json()["skills"] == []
    # Given by the person: the agent has it, and asking again says so.
    _ask(client, me, "propose_skill", asked)
    given = client.post(f"/api/v1/agents/{sky}/skill-requests/{skill['id']}/give", headers=me)
    assert given.status_code == 200 and [s["name"] for s in given.json()["skills"]] == ["forecast"]
    assert client.get(f"/api/v1/agents/{sky}/skill-requests", headers=me).json() == {"requests": []}
    assert _ask(client, me, "propose_skill", asked) == ("@sky has the skill forecast already.", True)
    assert client.post(f"/api/v1/agents/{sky}/skill-requests/nope/give", headers=me).status_code == 404
    # Given on the Skills tab instead: the request is answered too.
    other = _skill(client, me, "tides", description="Tides.")
    _ask(client, me, "propose_skill", {**asked, "skill": "tides"})
    assert client.put(f"/api/v1/agents/{sky}/skills", json={"skill_ids": [skill["id"], other["id"]]}, headers=me).status_code == 200
    assert client.get(f"/api/v1/agents/{sky}/skill-requests", headers=me).json() == {"requests": []}


@needs_db
def test_an_instruction_is_only_proposed(client: TestClient, me: dict[str, str]) -> None:
    _agent(client, me, "sky", {"label": "Sky", "instructions": "Be brief."})
    asked = {"agent": "sky", "text": "Be brief. Answer in French.", "reason": "The person asked for French."}
    said, err = _ask(client, me, "propose_instruction", asked)
    assert not err and "stays as it is" in json.loads(said)["note"]
    config = _config(client, me, "sky")
    assert config["instructions"] == "Be brief." and config["instruction_proposal"] == {"text": "Be brief. Answer in French.", "reason": "The person asked for French."}
    # AI apps still read the agent's own.
    tools = _assistant(client, _signed(client, me), "list_agent_tools", {"agent": "sky"})["content"][0]["text"]
    assert "Be brief." in tools and "French" not in tools
    assert client.get("/api/v1/notifications", headers=me).json()["notifications"][0]["title"] == "Your AI app proposes a new Instruction for @sky"
    # Refused: nothing, no reason, the same text.
    assert _ask(client, me, "propose_instruction", {**asked, "text": " "})[1]
    assert _ask(client, me, "propose_instruction", {**asked, "reason": ""})[1]
    assert _ask(client, me, "propose_instruction", {**asked, "text": "Be brief."}) == ("That is @sky's Instruction already.", True)
    # The person saves it from the website: theirs now, nothing waiting.
    saved = {k: v for k, v in config.items() if k != "instruction_proposal"}
    assert _save_config(client, me, "sky", {**saved, "instructions": "Be brief. Answer in French."}).status_code == 200
    assert "instruction_proposal" not in _config(client, me, "sky")


@needs_db
def test_a_draft_tool_names_the_agent_it_is_for(client: TestClient, me: dict[str, str]) -> None:
    for args in ({}, {"agent": "  "}, {"agent": 7}):
        assert _ask(client, me, "list_database_connections", args) == ("Give the agent's handle as 'agent' (list_agents names them).", True)


@needs_db
def test_an_ai_app_describes_and_checks_snowflake_within_the_calls_a_minute(client: TestClient, me: dict[str, str]) -> None:
    from apps.cloud.agent_chat import snowflake as sf

    snow = Snow()
    client.app.state.ai_http = snow.http()
    assert _connect(client, me, "sky", "snowflake", "sales", {**GOOD, "secret": "pat-1"}).status_code == 201
    snow.replies.append((200, rows(["S", "T", "C", "D", "N"], [["PUBLIC", "ORDERS", "ID", "NUMBER", "NO"]])))
    said, err = _ask(client, me, "describe_database", {"agent": "sky", "connection": "sales"})
    assert not err and json.loads(said)["tables"] == [{"table": "PUBLIC.ORDERS", "columns": [{"name": "ID", "type": "NUMBER", "nullable": False}]}]
    assert snow.sent[-1]["headers"]["authorization"] == "Bearer pat-1"
    # Checked: explained by Snowflake, its value bound, never run.
    tool = {"agent": "sky", "name": "orders_in", "description": "Orders in a region.", "connection": "sales",
            "params": [{"name": "region", "type": "string", "required": True}], "sql": "SELECT COUNT(*) FROM {database}.PUBLIC.ORDERS WHERE REGION = {region}"}
    said, err = _ask(client, me, "check_sql_tool", tool)
    assert not err and said.startswith("Valid: the database accepts the statement (it was not run).")
    assert snow.sent[-1]["body"]["statement"] == "EXPLAIN USING TEXT SELECT COUNT(*) FROM SHOP.PUBLIC.ORDERS WHERE REGION = ?"
    snow.replies.append((422, {"code": "002003", "message": "SQL compilation error: Object 'NOWHERE' does not exist."}))
    assert _ask(client, me, "check_sql_tool", {**tool, "sql": "SELECT * FROM NOWHERE WHERE REGION = {region}"}) == ("Snowflake: SQL compilation error: Object 'NOWHERE' does not exist.", True)
    # At most so many Snowflake calls a minute: refused before Snowflake is asked.
    sent = len(snow.sent)
    client.app.state.snowflake_limit.per_minute = 0
    try:
        for name, args in (("describe_database", {"agent": "sky", "connection": "sales"}), ("check_sql_tool", tool)):
            assert _ask(client, me, name, args) == (f"At most {sf.CALLS_PER_MINUTE} Snowflake calls a minute: wait a moment before the next.", True)
    finally:
        client.app.state.snowflake_limit.per_minute = sf.CALLS_PER_MINUTE
    assert len(snow.sent) == sent


@needs_db
def test_a_draft_is_held_to_the_persons_and_the_agents_limits(client: TestClient, me: dict[str, str], monkeypatch) -> None:
    from apps.cloud import user_tools

    _paired(client, me, "Scout")
    link = {"agent": "scout", "kind": "news", "address": "https://bbc.com/news", "description": "World news."}
    with monkeypatch.context() as m:
        m.setattr(user_tools, "MAX_TOOLS", 0)
        assert _ask(client, me, "draft_site_link", link) == ("The person has 0 tools, the most they may: they delete one first.", True)
    monkeypatch.setitem(user_tools.PER_AGENT, "news", 1)
    assert not _ask(client, me, "draft_site_link", link)[1]
    assert _ask(client, me, "draft_site_link", {**link, "address": "https://apnews.com"}) == ("@scout has 1 of these, the most it may.", True)


@needs_db
def test_the_iphone_toolkit_is_a_macs_alone_whatever_a_type_lists(client: TestClient, me: dict[str, str], migrated_db_url: str) -> None:
    from sqlalchemy import create_engine, text

    from apps.cloud import agent_types
    from tests.test_browser_links import AGENT, Extension

    pc = Extension(client, "Studio PC", kind="wysebee-windows")
    assert client.post(f"{AGENT}/claim", json={"code": pc.code, "home": "cloud"}, headers=me).status_code == 200
    handle = next(n for n in _agents(client, me) if n != "wysebee")
    asked = {"agent": handle, "switch": "ios_toolkit", "reason": "To build the iPhone app."}
    engine = create_engine(migrated_db_url)
    # Admin lists the iPhone toolkit for Windows agents too: still only a Mac's.
    with engine.begin() as conn:
        conn.execute(text("UPDATE agent_types SET tool_kinds = tool_kinds || '[\"ios_toolkit\"]'::jsonb WHERE key = 'wysebee-windows'"))
    agent_types.forget()
    try:
        assert _ask(client, me, "request_switch", asked) == ("Only an agent made by pairing Wysebee Agent for Mac can have iPhone Development Toolkit.", True)
    finally:
        with engine.begin() as conn:
            conn.execute(text("UPDATE agent_types SET tool_kinds = tool_kinds - 'ios_toolkit' WHERE key = 'wysebee-windows'"))
        agent_types.forget()
        engine.dispose()
    assert "switch_requests" not in _config(client, me, handle)


@needs_db
def test_a_skill_is_neither_asked_for_nor_given_past_the_most_an_agent_may_have(client: TestClient, me: dict[str, str], monkeypatch) -> None:
    from apps.cloud import skills
    from tests.cloud_agent_fixtures import _skill

    _agent(client, me, "sky", {"label": "Sky"})
    sky = _agent_id(client, me, "sky")
    forecast, tides = _skill(client, me, "forecast", description="Weather."), _skill(client, me, "tides", description="Tides.")
    asked = {"agent": "sky", "skill": "tides", "reason": "To answer tide questions."}
    assert not _ask(client, me, "propose_skill", asked)[1]
    assert client.put(f"/api/v1/agents/{sky}/skills", json={"skill_ids": [forecast["id"]]}, headers=me).status_code == 200
    monkeypatch.setattr(skills, "MAX_ATTACHED", 1)
    # Asked for before the agent was full: the person cannot give it now.
    given = client.post(f"/api/v1/agents/{sky}/skill-requests/{tides['id']}/give", headers=me)
    assert (given.status_code, given.json()["detail"]) == (422, "An agent has at most 1 skills.")
    assert [r["name"] for r in client.get(f"/api/v1/agents/{sky}/skill-requests", headers=me).json()["requests"]] == ["tides"]
    # Nor can the AI app ask for another.
    assert _ask(client, me, "propose_skill", asked) == ("@sky has 1 skills, the most it may.", True)
