"""Wysebee Assistant (apps/cloud/agent_mcp.py, 2026-11-14): the person's own AI app uses every
one of their agents living in Wysebee Cloud — its skills and tools — through one connector, /assistant/mcp, with nothing going through Wysebee Desktop.

The protocol and sign-in need no database; the agents do (WYSEBEE_TEST_DATABASE_URL). Tokens
are "<sub>|<azp>", read by a fake verifier in place of Auth0's.
"""

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import jwt
import pytest
from fastapi.testclient import TestClient

from apps.cloud import agent_mcp, browser_links, workspace_assistant
from apps.cloud import main as cloud_main
from apps.cloud.agent_chat.tools import Output
from apps.cloud.auth import User
from apps.cloud.config import Settings
from tests.cloud_agent_fixtures import _agent, _agents, _give_programs, client, me  # noqa: F401 — fixtures
from tests.conftest import make_client, needs_db
from tests.test_cloud_agent_browser import _paired
from tests.test_cloud_agent_mac import FOLDERS, PNG, PROGRAM, _skill, _web_mac

ISSUER = "https://tenant.example.auth0.com/"
PLAIN = b"---\nname: plain\ndescription: No scripts.\n---\nJust read the notes.\n"


class FakeVerifier:
    enabled = True
    audiences: list = []

    def __init__(self, settings: Settings | None = None) -> None:
        pass

    def verify(self, token: str, audiences: list[str] | None = None) -> User:
        FakeVerifier.audiences.append(audiences)
        if token == "keys-down":
            raise jwt.PyJWKClientError("no keys")
        if "|" not in token:
            raise jwt.InvalidTokenError("bad")
        sub, azp = token.split("|", 1)
        return User(sub=sub, client_id=azp)


@pytest.fixture(autouse=True)
def fake_verifier(monkeypatch):
    monkeypatch.setattr(cloud_main, "TokenVerifier", FakeVerifier)


def bearer(sub: str, azp: str = "claude") -> dict:
    return {"Authorization": f"Bearer {sub}|{azp}"}


def rpc(method: str, params: dict | None = None, rid: int = 1) -> dict:
    body: dict = {"jsonrpc": "2.0", "id": rid, "method": method}
    if params is not None:
        body["params"] = params
    return body


def sse_result(body: str) -> dict:
    """The JSON-RPC message an SSE answer ends with."""
    data = [line[6:] for line in body.splitlines() if line.startswith("data: ")]
    return json.loads(data[-1])["result"]


# --- no database ---------------------------------------------------------------------------


MCP = "/assistant/mcp"


def test_wysebee_assistant_has_protected_resource_metadata_naming_the_tenant(ui_dist: Path):
    with make_client(ui_dist, auth_issuer=ISSUER, public_url="https://wysebee.ai/") as c:
        body = c.get(f"/.well-known/oauth-protected-resource{MCP}").json()
        assert body["resource"] == "https://wysebee.ai/assistant/mcp" and body["authorization_servers"] == [ISSUER]
        assert body["resource_name"] == "Wysebee Assistant" and "offline_access" in body["scopes_supported"]
        # One connector: no agent has an address of its own any more.
        for gone in ("/mcp", "/mcp/wysebee", "/mcp/scout"):
            assert c.post(gone, json=rpc("ping"), headers=bearer("u")).status_code in (404, 405)


def test_on_by_default_off_with_its_switch_and_503_without_sign_in(ui_dist: Path):
    with make_client(ui_dist, auth_issuer=ISSUER) as c:
        assert c.post(MCP, json=rpc("ping"), headers=bearer("u")).status_code == 200
    with make_client(ui_dist, auth_issuer=ISSUER, mcp_enabled=False) as c:
        assert c.post(MCP, json=rpc("ping"), headers=bearer("u")).status_code == 404
        assert c.get(MCP).status_code == 404
        assert c.get(f"/.well-known/oauth-protected-resource{MCP}").status_code == 404
        assert c.get("/api/v1/mcp/status", headers=bearer("u")).status_code in (401, 404)
    with make_client(ui_dist, auth_issuer=None) as c:
        assert c.get(f"/.well-known/oauth-protected-resource{MCP}").status_code == 503


def test_a_server_whose_sign_in_is_off_answers_503(ui_dist: Path):
    with make_client(ui_dist, auth_issuer=ISSUER) as c:
        c.app.state.token_verifier = SimpleNamespace(enabled=False)
        r = c.post(MCP, json=rpc("tools/list"), headers=bearer("u"))
    assert r.status_code == 503 and r.json()["detail"] == "Sign-in is not configured on this server."


def test_without_a_token_the_app_is_pointed_at_the_assistants_metadata(ui_dist: Path):
    with make_client(ui_dist, auth_issuer=ISSUER, public_url="https://wysebee.ai") as c:
        r = c.post(MCP, json=rpc("initialize"))
        assert r.status_code == 401
        assert r.headers["www-authenticate"] == 'Bearer resource_metadata="https://wysebee.ai/.well-known/oauth-protected-resource/assistant/mcp"'
        bad = c.post(MCP, json=rpc("initialize"), headers={"Authorization": "Bearer nonsense"})
        assert bad.status_code == 401 and 'error="invalid_token"' in bad.headers["www-authenticate"]
        down = c.post(MCP, json=rpc("initialize"), headers={"Authorization": "Bearer keys-down"})
        assert down.status_code == 401


def test_a_token_for_the_assistants_own_address_is_accepted(ui_dist: Path):
    FakeVerifier.audiences.clear()
    with make_client(ui_dist, auth_issuer=ISSUER, public_url="https://wysebee.ai/") as c:
        assert c.post(MCP, json=rpc("ping"), headers=bearer("u")).status_code == 200
    assert FakeVerifier.audiences[-1] == ["https://wysebee.ai/api", "https://wysebee.ai/assistant/mcp"]


def test_malformed_unknown_and_other_requests(ui_dist: Path):
    with make_client(ui_dist, auth_issuer=ISSUER) as c:
        h = bearer("u")
        assert c.post(MCP, content=b"{", headers={**h, "Content-Type": "application/json"}).status_code == 400
        assert c.post(MCP, json=[rpc("ping")], headers=h).status_code == 400
        assert c.post(MCP, json={"jsonrpc": "2.0", "method": "notifications/initialized"}, headers=h).status_code == 202
        assert c.post(MCP, json=rpc("sampling/createMessage"), headers=h).json()["error"]["code"] == -32601
        assert c.post(MCP, json=rpc("prompts/list"), headers=h).json()["result"] == {"prompts": []}
        assert c.post(MCP, json=rpc("resources/list"), headers=h).json()["result"] == {"resources": []}
        unknown = c.post(MCP, json=rpc("tools/call", {"name": "rm"}), headers=h).json()["result"]
        assert unknown == {"content": [{"type": "text", "text": "Wysebee Assistant has no tool named rm."}], "isError": True}
        assert c.get(MCP).status_code == 405 and c.delete(MCP).status_code == 405


def test_a_tool_is_listed_and_answered_as_mcp_has_it():
    assert agent_mcp.mcp_tool({"name": "t", "description": "d", "input_schema": {"type": "object", "properties": {}}}) == {
        "name": "t", "description": "d", "inputSchema": {"type": "object", "properties": {}},
        # Not named read-only: a write, run by call_agent_tool.
        "annotations": {"readOnlyHint": False, "destructiveHint": True}}
    assert agent_mcp.mcp_tool({"name": "t"}, read_only=True)["annotations"] == {"readOnlyHint": True}
    assert agent_mcp.mcp_tool({"name": "t"})["inputSchema"] == {"type": "object"}
    out = Output("hi", images=[{"media_type": "image/png", "data": "abc"}, {"bad": 1}])
    assert agent_mcp._content(out) == [{"type": "text", "text": "hi"}, {"type": "image", "data": "abc", "mimeType": "image/png"}]
    # A Mac folder's picture is the person's alone: never passed on.
    kept = agent_mcp._content(Output("shown", shown=[PNG]))
    assert kept == [{"type": "text", "text": "shown" + agent_mcp.PICTURE_KEPT}]


def test_a_refused_tokens_shape_is_described_never_the_token():
    assert agent_mcp.token_shape("opaque") == "not a signed JWT: 1 part(s)"
    assert agent_mcp.token_shape("a.b.c.d.e") == "not a signed JWT: 5 part(s)"
    assert agent_mcp.token_shape("x.y.z") == "unreadable JWT"
    signed = jwt.encode({"iss": "https://t.auth0.com/", "aud": "https://t/mcp", "azp": "claude"}, "k" * 32)
    assert agent_mcp.token_shape(signed) == "iss='https://t.auth0.com/' aud='https://t/mcp' azp='claude'"


def _request(**settings) -> SimpleNamespace:
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(settings=Settings(**settings))))


def _box(run=None, skills: list | None = None) -> agent_mcp.Served:
    return agent_mcp.Served("sky", {}, None, SimpleNamespace(run=run, skills=skills or [], on_mac=False))


def _events(request, served: agent_mcp.Served) -> list[str]:
    async def all_of() -> list[str]:
        return [e async for e in agent_mcp._answer(request, "u", served, 7, {"id": None, "name": "t", "arguments": {}})]

    return asyncio.run(all_of())


def _last(events: list[str]) -> dict:
    return json.loads(events[-1].split("data: ", 1)[1])["result"]


def test_a_tool_that_fails_is_answered_as_an_error_not_a_dropped_stream():
    async def broken(call):
        raise RuntimeError("boom")

    events = _events(_request(), _box(broken))
    assert _last(events) == {"content": [{"type": "text", "text": "@sky's tool t failed in Wysebee Cloud with an unexpected error (RuntimeError). It was logged: try again."}], "isError": True}


def test_a_result_too_big_to_send_is_replaced_by_saying_so():
    async def big(call):
        return Output("x" * 200)

    assert _last(_events(_request(mcp_result_max_bytes=100), _box(big))) == agent_mcp._tool_text(agent_mcp.TOO_BIG, True)
    assert _last(_events(_request(), _box(big)))["content"] == [{"type": "text", "text": "x" * 200}]


def test_the_tool_is_stopped_when_the_ai_app_goes_away():
    stopped: list = []

    async def slow(call):
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            stopped.append(call["name"])
            raise

    async def leave() -> str:
        stream = agent_mcp._answer(_request(mcp_keepalive_seconds=0.01), "u", _box(slow), 7, {"id": None, "name": "t", "arguments": {}})
        first = await stream.__anext__()
        await stream.aclose()
        await asyncio.sleep(0.01)
        return first

    assert asyncio.run(leave()) == ": keepalive\n\n"
    assert stopped == ["t"]


# --- the person's agents ---------------------------------------------------------------------


def _signed(client: TestClient, me: dict[str, str]) -> dict:
    client.app.state.token_verifier = FakeVerifier()
    return bearer(me["X-Test-User"])


def _mcp(client: TestClient, auth: dict, method: str, params: dict | None = None):
    r = client.post(MCP, json=rpc(method, params), headers=auth)
    if r.headers.get("content-type", "").startswith("text/event-stream"):
        return sse_result(r.text)
    assert r.status_code == 200, r.text
    return r.json().get("result", r.json())


def _call(client: TestClient, auth: dict, tool: str, args: dict) -> dict:
    """One of Wysebee Assistant's tools: its result."""
    return _mcp(client, auth, "tools/call", {"name": tool, "arguments": args})


@needs_db
def test_wysebee_assistant_offers_the_page_and_the_agents(client: TestClient, me: dict[str, str]):
    auth = _signed(client, me)
    init = _mcp(client, auth, "initialize", {"protocolVersion": "2025-06-18"})
    assert init["protocolVersion"] == "2025-06-18"
    assert init["serverInfo"] == {"name": "wysebee-assistant", "title": "Wysebee Assistant", "version": init["serverInfo"]["version"]}
    assert init["instructions"] == f"{workspace_assistant.INSTRUCTIONS}\n\n{agent_mcp.AGENTS_NOTE}"
    listed = [t["name"] for t in _mcp(client, auth, "tools/list")["tools"]]
    assert listed == [*(t["name"] for t in workspace_assistant.TOOLS), "list_tasks", "save_task", "delete_task", "run_task", "list_database_connections", "describe_database", "check_sql_tool", "draft_sql_tool", "propose_sql_tool_change", "draft_site_link", "draft_program", "request_switch", "propose_skill", "propose_instruction", "list_agents", "list_agent_tools", "call_agent_read_tool", "call_agent_tool"]


@needs_db
def test_wysebee_is_an_agent_like_any_other(client: TestClient, me: dict[str, str]):
    auth = _signed(client, me)
    _skill(client, me, "plain", PLAIN)
    _agent(client, me, "wysebee", {"label": "Wysebee", "skills": ["plain"], "instructions": "Be brief."}, description="Your assistant")
    listed = _call(client, auth, "list_agents", {})["content"][0]["text"]
    # An agent with the person's Instruction says to read it before using the agent.
    assert "- @wysebee: Wysebee. Your assistant (the person keeps notes on how they use it, which list_agent_tools includes)" in listed
    said = _call(client, auth, "list_agent_tools", {"agent": "wysebee"})["content"][0]["text"]
    assert "Wysebee (@wysebee)" in said and "Be brief." in said and "- plain: No scripts." in said and '"load_skill"' in said
    loaded = _call(client, auth, "call_agent_read_tool", {"agent": "wysebee", "tool": "load_skill", "arguments": {"name": "plain"}})
    assert loaded["isError"] is False and "Just read the notes." in loaded["content"][0]["text"]
    # Not the chat's own two: there is no Wysebee thread.
    called = _call(client, auth, "call_agent_tool", {"agent": "wysebee", "tool": "ask_in_thread", "arguments": {"question": "?"}})
    assert called["isError"] and "@wysebee has no tool named ask_in_thread" in called["content"][0]["text"]
    # Its tab: the Assistant's address, on, its tools and skills.
    status = client.get("/api/v1/mcp/status", headers=me).json()
    assert status["url"] == "http://testserver/assistant/mcp" and status["exposed"] is True and status["offline"] is None
    assert [t["name"] for t in status["tools"]] == ["load_skill", "skill_read_file", "send_notification"] and status["skills"] == 1
    assert all("\n" not in t["description"] for t in status["tools"])


@needs_db
def test_each_tool_call_answered_costs_one_credit_and_looking_is_free(client: TestClient, me: dict[str, str]):
    auth = _signed(client, me)
    credits = lambda: client.get("/api/v1/tool-calls", headers=me).json()["count"]  # noqa: E731
    _skill(client, me, "plain", PLAIN)
    _agent(client, me, "desk", {"label": "Desk", "skills": ["plain"]})
    _call(client, auth, "list_agents", {})
    _call(client, auth, "list_agent_tools", {"agent": "desk"})
    assert credits() == 0
    assert _call(client, auth, "call_agent_read_tool", {"agent": "desk", "tool": "load_skill", "arguments": {"name": "plain"}})["isError"] is False
    assert credits() == 1
    # Refused or failed: not counted.
    assert _call(client, auth, "call_agent_tool", {"agent": "desk", "tool": "nope"})["isError"]
    assert _call(client, auth, "call_agent_read_tool", {"agent": "desk", "tool": "load_skill", "arguments": {"name": "gone"}})["isError"]
    assert _call(client, auth, "read_document", {})["isError"]
    assert credits() == 1


@needs_db
def test_another_agent_is_reached_through_the_assistant_and_someone_elses_is_not(client: TestClient, me: dict[str, str]):
    auth = _signed(client, me)
    _skill(client, me, "plain", PLAIN)
    # Sent with a desktop's home, an agent lives in the cloud all the same.
    _agent(client, me, "desk", {"label": "Desk", "home": "desk-1", "skills": ["plain"]})
    described = _call(client, auth, "list_agent_tools", {"agent": "desk"})
    assert "Desk (@desk)" in described["content"][0]["text"] and '"load_skill"' in described["content"][0]["text"]
    unknown = _call(client, auth, "call_agent_tool", {"agent": "desk", "tool": "nope"})
    assert unknown["isError"] is True and "@desk has no tool named nope" in unknown["content"][0]["text"]
    assert client.get("/api/v1/mcp/status?agent=desk", headers=me).json()["tools"][0]["name"] == "load_skill"
    assert client.get("/api/v1/mcp/status?agent=nobody", headers=me).status_code == 404
    other = client.post(MCP, json=rpc("tools/call", {"name": "list_agent_tools", "arguments": {"agent": "desk"}}), headers=bearer("someone-else"))
    assert other.json()["result"] == {"content": [{"type": "text", "text": agent_mcp.NO_AGENT.format(name="desk")}], "isError": True}


@needs_db
def test_a_browsers_agent_drives_that_browser_and_returns_its_pictures(client: TestClient, me: dict[str, str], monkeypatch):
    asked: list = []

    async def link(state, user_id, link_id, op, args, *, agent=None, timeout_seconds=None):
        asked.append((user_id, link_id, op, agent))
        return {"ok": True, "result": {"image": "shot", "mime": "image/jpeg"}}

    monkeypatch.setattr(browser_links, "run_op", link)
    auth = _signed(client, me)
    link_id = _paired(client, me, "Scout")
    described = _call(client, auth, "list_agent_tools", {"agent": "scout"})["content"][0]["text"]
    assert "through the Wysebee Agent extension" in described and '"browser_click"' in described and "ask_in_thread" not in described
    shot = _call(client, auth, "call_agent_read_tool", {"agent": "scout", "tool": "browser_screenshot", "arguments": {}})
    assert shot["isError"] is False and {"type": "image", "data": "shot", "mimeType": "image/jpeg"} in shot["content"]
    assert asked == [(me["X-Test-User"], link_id, "browser_screenshot", _agents(client, me)["scout"])]


@needs_db
def test_a_macs_agent_runs_that_macs_programs_and_folders_but_keeps_its_pictures(client: TestClient, me: dict[str, str], monkeypatch):
    asked: list = []

    async def link(state, user_id, link_id, op, args, *, agent=None, timeout_seconds=None):
        asked.append(op)
        if op == "local_run":
            return {"ok": True, "result": {"exit_code": 0, "stdout": "42 notes.txt\n", "stderr": ""}}
        return {"ok": True, "result": {"text": "The picture photo.png was shown to the person.", "picture": PNG}}

    monkeypatch.setattr(browser_links, "run_op", link)
    auth = _signed(client, me)
    _web_mac(client, me, folders=FOLDERS)
    _give_programs(client, me, "studio-mac", [PROGRAM])
    described = _call(client, auth, "list_agent_tools", {"agent": "studio-mac"})["content"][0]["text"]
    assert "Wysebee Agent for Mac" in described and '"local_word_count"' in described and '"folder_write"' in described
    ran = _call(client, auth, "call_agent_tool", {"agent": "studio-mac", "tool": "local_word_count", "arguments": {"file": "notes.txt"}})
    assert ran["isError"] is False and "42 notes.txt" in ran["content"][0]["text"]
    read = _call(client, auth, "call_agent_read_tool", {"agent": "studio-mac", "tool": "folder_read", "arguments": {"folder": 1, "path": "photo.png"}})
    assert [b["type"] for b in read["content"]] == ["text"] and read["content"][0]["text"].endswith(agent_mcp.PICTURE_KEPT)
    assert asked == ["local_run", "folder_call"]


@needs_db
def test_a_call_out_of_time_is_stopped_with_keepalives_meanwhile(client: TestClient, me: dict[str, str], monkeypatch):
    stopped: list = []

    async def link(state, user_id, link_id, op, args, *, agent=None, timeout_seconds=None):
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            stopped.append(op)
            raise
        return {"ok": True, "result": {}}

    monkeypatch.setattr(browser_links, "run_op", link)
    monkeypatch.setattr(client.app.state.settings, "mcp_call_wait_seconds", 0.6)
    monkeypatch.setattr(client.app.state.settings, "mcp_keepalive_seconds", 0.2)
    auth = _signed(client, me)
    _paired(client, me, "Slow")
    call = {"name": "call_agent_read_tool", "arguments": {"agent": "slow", "tool": "browser_screenshot", "arguments": {}}}
    r = client.post(MCP, json=rpc("tools/call", call), headers=auth)
    assert ": keepalive" in r.text
    result = sse_result(r.text)
    assert result["isError"] and "did not finish within 1 seconds" in result["content"][0]["text"]
    assert stopped == ["browser_screenshot"]


@needs_db
def test_each_agent_is_turned_off_and_on_for_ai_apps_wysebee_too(client: TestClient, me: dict[str, str]):
    auth = _signed(client, me)
    _skill(client, me, "plain", PLAIN)
    _agent(client, me, "desk", {"label": "Desk", "skills": ["plain"]}, description="Writes")
    # Off: not listed, its tools not run, its tab says so; twice is the same.
    for _ in range(2):
        assert client.put("/api/v1/mcp/agents/desk", json={"exposed": False}, headers=me).json() == {"agent": "desk", "exposed": False}
    assert client.get("/api/v1/mcp/status?agent=desk", headers=me).json()["exposed"] is False
    assert "@desk" not in _call(client, auth, "list_agents", {})["content"][0]["text"]
    for tool, args in (("list_agent_tools", {"agent": "desk"}), ("call_agent_read_tool", {"agent": "desk", "tool": "load_skill", "arguments": {"name": "plain"}})):
        assert _call(client, auth, tool, args) == {"content": [{"type": "text", "text": agent_mcp.TURNED_OFF.format(name="desk")}], "isError": True}
    # Wysebee too: then no agent is left.
    assert client.put("/api/v1/mcp/agents/wysebee", json={"exposed": False}, headers=me).json()["exposed"] is False
    assert "turned off every agent" in _call(client, auth, "list_agents", {})["content"][0]["text"]
    # Kept by id: renamed, it stays off under its new handle.
    desk = _agents(client, me)["desk"]
    assert client.put(f"/api/v1/agents/{desk}", json={"name": "bureau"}, headers=me).status_code == 200
    assert client.get("/api/v1/mcp/status?agent=bureau", headers=me).json()["exposed"] is False
    assert client.put(f"/api/v1/agents/{desk}", json={"name": "desk"}, headers=me).status_code == 200
    # On again.
    assert client.put("/api/v1/mcp/agents/desk", json={"exposed": True}, headers=me).json()["exposed"] is True
    assert "- @desk: Desk. Writes" in _call(client, auth, "list_agents", {})["content"][0]["text"]
    assert client.put("/api/v1/mcp/agents/nobody", json={"exposed": False}, headers=me).status_code == 404


@needs_db
def test_arguments_too_long_are_refused_before_the_tool_runs(client: TestClient, me: dict[str, str], monkeypatch):
    auth = _signed(client, me)
    _skill(client, me, "plain", PLAIN)
    _agent(client, me, "wysebee", {"label": "Wysebee", "skills": ["plain"]})
    monkeypatch.setattr(client.app.state.settings, "mcp_arguments_max_chars", 20)
    called = _call(client, auth, "call_agent_read_tool", {"agent": "wysebee", "tool": "load_skill", "arguments": {"name": "plain", "path": "SKILL.md"}})
    assert called == {"content": [{"type": "text", "text": "The arguments are too long: at most 20 characters."}], "isError": True}
    loaded = _call(client, auth, "call_agent_read_tool", {"agent": "wysebee", "tool": "load_skill", "arguments": {"name": "plain"}})
    assert loaded["isError"] is False and "Just read the notes." in loaded["content"][0]["text"]


def test_every_tool_has_a_title_and_a_hint() -> None:
    """Claude's connector directory flags a tool without a title, or without readOnlyHint or
    destructiveHint: every tool says whether it only reads and, if not, whether it destroys."""
    for tool in agent_mcp.TOOLS:
        hints = tool.get("annotations") or {}
        assert tool.get("title"), tool["name"]
        assert hints.get("title") == tool["title"], tool["name"]
        # readOnlyHint always said, which the directory asks for; a tool that writes says whether it destroys.
        assert isinstance(hints.get("readOnlyHint"), bool), tool["name"]
        assert hints["readOnlyHint"] or isinstance(hints.get("destructiveHint"), bool), tool["name"]
        assert len(tool["name"]) <= 64, tool["name"]


@needs_db
def test_no_one_tool_both_reads_and_acts(client: TestClient, me: dict[str, str]):
    """call_agent_read_tool runs only an agent's read-only tools, call_agent_tool only the
    others (2026-11-16: Claude's connector directory rejects one tool that does both); each
    says which to use instead, and list_agent_tools marks each tool."""
    auth = _signed(client, me)
    _skill(client, me, "plain", PLAIN)
    _agent(client, me, "wysebee", {"label": "Wysebee", "skills": ["plain"]})
    acts = _call(client, auth, "call_agent_read_tool", {"agent": "wysebee", "tool": "send_notification", "arguments": {"title": "x"}})
    assert acts == agent_mcp._tool_text(agent_mcp.USE_WRITE.format(tool="send_notification"), True)
    reads = _call(client, auth, "call_agent_tool", {"agent": "wysebee", "tool": "load_skill", "arguments": {"name": "plain"}})
    assert reads == agent_mcp._tool_text(agent_mcp.USE_READ.format(tool="load_skill"), True)
    listed = _call(client, auth, "list_agent_tools", {"agent": "wysebee"})["content"][0]["text"]
    tools_ = json.loads(listed.split("):\n", 1)[1])
    # Its skills are listed as what they are, never as orders to follow (Claude's connector
    # directory refuses wording that tells the AI app how to behave).
    assert "Its skills, written instructions the person keeps for particular jobs" in listed
    for said in (listed, agent_mcp.AGENTS_NOTE):
        assert "follow those notes" not in said and "follow what it says" not in said
    hints = {t["name"]: t["annotations"] for t in tools_}
    assert hints["load_skill"] == {"readOnlyHint": True}
    assert hints["send_notification"] == {"readOnlyHint": False, "destructiveHint": True}


def test_every_read_only_name_is_a_real_tool():
    """A misspelt name would leave a tool needing call_agent_tool: each one is offered by a pack."""
    from apps.cloud.agent_chat import android, browser, ios_dev, mac, pc_dev, postgres, snowflake, toolbox, tools

    known = {t["name"] for t in browser.catalog()} | {t["name"] for t in android.TOOLS} | set(mac.FOLDER_TOOLS) | {t["name"] for t in mac.screen_tools()} | set(pc_dev.DEV_TOOLS) | set(pc_dev.ANDROID_TOOLS) | set(ios_dev.IOS_TOOLS)
    known |= {tools.LOAD, tools.READ, postgres.SCHEMA, postgres.QUERY, snowflake.SCHEMA, snowflake.QUERY}
    assert toolbox.READ_ONLY <= known
    # What acts never runs read-only.
    for acts in ("browser_click", "browser_type", "browser_evaluate", "android_tap", mac.WRITE, mac.SCRIPT_TOOL, mac.ANY_TOOL, mac.ACT, "dev_shell", "dev_write", "dev_edit", "adb_install", "adb_shell", "xcode_install", "xcode_uninstall", "xcode_boot", "xcode_launch", "send_notification", "local_word_count"):
        assert acts not in toolbox.READ_ONLY


def test_sql_through_the_read_tool_runs_read_only(monkeypatch):
    """A SQL Query tool through call_agent_read_tool runs on its connection as a read-only
    one, even where the person allows changes; through call_agent_tool, as the connection
    allows."""
    from apps.cloud.agent_chat import postgres, sql_tools, toolbox

    seen: list[bool] = []

    async def execute(c, _password, _sql, _params):
        seen.append(c.changes)
        return Output("ok")

    monkeypatch.setattr(postgres, "execute", execute)

    async def no_secret(_kek, _row):
        return None

    monkeypatch.setattr("apps.cloud.user_tools.secret_of", no_secret)
    state = SimpleNamespace(postgres_limit=SimpleNamespace(allow=lambda _u: True), ai_kek=None)

    def conn(changes: bool) -> SimpleNamespace:
        return SimpleNamespace(kind="postgres", name="main", description="", config={"host": "db.example.com", "database": "app", "user": "me", "ssl": "require", "changes": changes})

    tool = sql_tools.parse("wipe", "Deletes.", {"connection_id": "00000000-0000-0000-0000-000000000001", "sql": "delete from t"})
    copy = sql_tools.parse("peek", "Reads.", {"connection_id": "00000000-0000-0000-0000-000000000002", "sql": "select 1"})
    sql = {"wipe": toolbox.SqlRun(tool, conn(True)), "peek": toolbox.SqlRun(copy, conn(False))}
    box = toolbox.Toolbox(state, "u", [], [], [], toolbox.Where({}, []), [{"name": "wipe"}, {"name": "peek"}], None, sql=sql)
    asyncio.run(box.run({"name": "wipe", "arguments": {}, "read_only": True}))
    asyncio.run(box.run({"name": "wipe", "arguments": {}}))
    assert seen == [False, True]
    # Which tool may run it: the read one always; the acting one only where changes are allowed.
    assert box.reads_only("wipe") and box.reads_only("peek")
    assert box.writes("wipe", {}) and not box.writes("peek", {})
    # And a tool that acts never runs read-only, whoever asks.
    acting = toolbox.Toolbox(state, "u", [], [], [], toolbox.Where({}, []), [{"name": "browser_click"}], None)
    refused = asyncio.run(acting.run({"name": "browser_click", "arguments": {}, "read_only": True}))
    assert refused.is_error and "call_agent_tool" in refused.text
