"""The browser pack of agents living in Wysebee Cloud (apps/cloud/agent_chat/browser.py):
its tools, their arguments and answers as wysebee-desktop's ``tools.rs`` gives them, and its
tools driving a browser — a fake link in place of the extension, and once the real queue
(skipped without WYSEBEE_TEST_DATABASE_URL)."""

import asyncio
import json
from pathlib import Path

from fastapi.testclient import TestClient

from apps.cloud import browser_links
from apps.cloud.agent_chat import browser
from tests.cloud_agent_fixtures import _agent, _agents, _box, _call, _config, _offered, _save_config, client, me  # noqa: F401 — fixtures
from tests.conftest import needs_db
from tests.test_browser_links import BASE, Browser, Extension

DESKTOP_DATA = Path(__file__).resolve().parents[2] / "wysebee-desktop" / "crates" / "wysebee-backend" / "data"
LINK = "a" * 32


def run(coro):
    return asyncio.run(coro)


def fake(answers: dict, seen: list | None = None) -> browser.Run:
    async def link(op: str, args: dict, timeout: float) -> dict:
        if seen is not None:
            seen.append((op, args, timeout))
        return answers[op]

    return link


# --- the tools -----------------------------------------------------------------------------------


def test_the_tools_are_the_desktops_own() -> None:
    names = [t["name"] for t in browser.catalog()]
    assert len(names) == 24 and len(set(names)) == 24
    # Every one is an op the link takes.
    assert set(names) <= browser_links.OPS
    assert browser_links.OPS - set(names) == {"ping", "recording_saved"}
    # The copies say what the desktop's files say, where its checkout is beside this one.
    if DESKTOP_DATA.is_dir():
        assert json.loads((browser.DATA / "browser_tools.json").read_text()) == json.loads((DESKTOP_DATA / "browser_tools.json").read_text())


def test_an_agent_gets_them_only_with_a_paired_browser_and_access_on() -> None:
    assert browser.tools_for({}) == [] and browser.tools_for({"browser_access": True, "browser": "mac-chrome"}) == []
    assert browser.tools_for({"browser_link": LINK, "browser_access": False, "browser_devtools": True}) == []
    assert browser.tools_for({"browser_link": 5}) == [] and browser.tools_for({"browser_link": "  "}) == []
    assert (browser.paired({"browser_link": f" {LINK} ", "browser_access": False}), browser.link_of({"browser_link": LINK, "browser_access": False})) == (LINK, "")
    plain = browser.tools_for({"browser_link": LINK})
    assert [t["name"] for t in plain] == [t["name"] for t in browser.catalog() if t["pack"] == "browser"] and len(plain) == 14
    assert all(set(t) == {"name", "description", "input_schema"} for t in plain)
    # The web development tools only when switched on.
    assert browser.tools_for({"browser_link": LINK, "browser_devtools": "yes"}) == plain
    dev = browser.tools_for({"browser_link": LINK, "browser_access": True, "browser_devtools": True})
    assert len(dev) == 24 and {"browser_console", "browser_evaluate", "browser_reload", "browser_mock"} <= {t["name"] for t in dev}
    assert "browser_mock" not in {t["name"] for t in plain} and browser.find("browser_mock")["pack"] == "devtools"


def test_arguments_are_filled_in_coerced_and_checked() -> None:
    click = browser.find("browser_click")
    given = {name: "x" for name in click["input_schema"].get("required", [])}
    filled = browser.prepare_args(click, given)
    assert set(filled) == set(click["input_schema"]["properties"])
    for name, prop in click["input_schema"]["properties"].items():
        if name not in given:
            assert filled[name] == prop.get("default"), name
    for bad, why in (("nope", "not a valid JSON object"), ({**given, "zzz": 1}, "unexpected argument 'zzz'")):
        try:
            browser.prepare_args(click, bad)
        except ValueError as e:
            assert why in str(e)
        else:
            raise AssertionError(bad)
    if given:
        try:
            browser.prepare_args(click, {})
        except ValueError as e:
            assert "missing required argument" in str(e) and "browser_click" in str(e)
        else:
            raise AssertionError("a required argument was not asked for")
    # Lax, as the desktop: "12" for an integer, "true" for a bool; anything else as it came.
    integer, number, boolean = {"anyOf": [{"type": "integer"}, {"type": "null"}]}, {"type": "number"}, {"type": "boolean"}
    assert (browser.coerce(" 12 ", integer), browser.coerce("-3", integer), browser.coerce("1_0", integer), browser.coerce("x", integer), browser.coerce(7, integer)) == (12, -3, "1_0", "x", 7)
    assert (browser.coerce("1.5", number), browser.coerce("nan", number), browser.coerce("abc", number)) == (1.5, "nan", "abc")
    assert [browser.coerce(v, boolean) for v in ("true", "ON", "0", "No", "maybe")] == [True, True, False, False, "maybe"]
    assert browser.coerce("12", {"anyOf": [{"type": "string"}, {"type": "integer"}]}) == "12"
    assert browser.coerce("12", {"type": "object"}) == "12" and browser.coerce("12", None) == "12" and browser.coerce("12", {"anyOf": "x"}) == "12"
    assert browser.truncate("a" * 50_000) == "a" * 50_000
    assert browser.truncate("a" * 50_001) == "a" * 50_000 + "\n…[truncated at 50000 characters]"
    assert browser.what("browser_click") == "click" and browser.what("other") == "run the tool"


def test_a_call_becomes_the_op_and_its_answer_the_tools_text_and_pictures() -> None:
    seen: list = []
    answers = {
        "browser_tabs": {"ok": True, "result": {"tabs": [{"id": 1, "title": "Café"}]}},
        "browser_snapshot": {"ok": True, "result": {"text": "Hello", "image": "QUJD", "mime": "image/jpeg"}},
        "browser_screenshot": {"ok": True, "result": {"image": "QUJD", "mime": "image/jpeg"}},
        "browser_click": {"ok": False, "error": "The person refused.", "unavailable": False},
        "browser_navigate": {"ok": False, "error": "The browser is not reachable.", "unavailable": True},
        "browser_scroll": {"ok": True, "result": {"text": "x" * 60_000}},
    }
    link = fake(answers, seen)
    out = run(browser.call(link, "browser_tabs", {}))
    assert (out.text, out.images, out.is_error) == ('{"tabs":[{"id":1,"title":"Café"}]}', [], False)
    assert seen[-1] == ("browser_tabs", {}, 90.0)
    # A snapshot asks for a picture, which comes back beside the text; never a recording.
    out = run(browser.call(link, "browser_snapshot", {"tab_id": "4"}))
    assert (out.text, out.images) == ('{"text":"Hello"}[image attached]', [{"media_type": "image/jpeg", "data": "QUJD"}])
    assert seen[-1][1] == {"tab_id": 4, "with_image": True}
    assert all("record" not in args for _, args, _ in seen)
    answers["browser_snapshot"] = {"ok": True, "result": {"text": "Hello", "image": "", "mime": "image/png"}}
    out = run(browser.call(link, "browser_snapshot", {}))
    assert (out.text, out.images) == ('{"text":"Hello"}', [])
    answers["browser_snapshot"] = {"ok": True, "result": {"error": "denied", "message": "Not allowed on this site."}}
    assert run(browser.call(link, "browser_snapshot", {})).text == '{"error":"denied","message":"Not allowed on this site."}'
    answers["browser_snapshot"] = {"ok": True, "result": "odd"}
    assert run(browser.call(link, "browser_snapshot", {})).text == '"odd"'
    # A screenshot is its picture: JPEG as said, PNG otherwise — an old extension's "png" too.
    out = run(browser.call(link, "browser_screenshot", {}))
    assert (out.text, out.images) == ("[image attached]", [{"media_type": "image/jpeg", "data": "QUJD"}])
    for result, image in (({"image": "QUJD"}, {"media_type": "image/png", "data": "QUJD"}), ({"png": "UE5H"}, {"media_type": "image/png", "data": "UE5H"}), (None, {"media_type": "image/png", "data": ""})):
        answers["browser_screenshot"] = {"ok": True, "result": result}
        assert run(browser.call(link, "browser_screenshot", {})).images == [image]
    # The browser's refusal, or it not being there, is an answer the model reads — not an error.
    click = {name: "e1" for name in browser.find("browser_click")["input_schema"].get("required", [])}
    out = run(browser.call(link, "browser_click", click))
    assert (json.loads(out.text), out.is_error) == ({"error": "browser_error", "message": "Could not click: The person refused."}, False)
    navigate = {name: "https://example.com" for name in browser.find("browser_navigate")["input_schema"].get("required", [])}
    out = run(browser.call(link, "browser_navigate", navigate))
    assert (json.loads(out.text), out.is_error) == ({"error": "browser_unavailable", "message": "The browser is not reachable."}, False)
    scroll = {name: "down" for name in browser.find("browser_scroll")["input_schema"].get("required", [])}
    assert run(browser.call(link, "browser_scroll", scroll)).text.endswith("…[truncated at 50000 characters]")
    # Bad arguments and unknown tools are errors, and nothing reaches the browser.
    before = len(seen)
    assert run(browser.call(link, "browser_tabs", {"zzz": 1})).is_error and run(browser.call(link, "browser_fly", {})).is_error
    assert len(seen) == before
    out = run(browser.call(None, "browser_tabs", {}))
    assert (json.loads(out.text)["error"], out.is_error) == ("browser_unavailable", False)


def test_browser_mock_forwards_its_rules_and_says_what_it_is_for() -> None:
    tool = browser.find("browser_mock")
    schema = tool["input_schema"]
    assert set(schema["properties"]) == {"rules", "clear", "tab_id"} and not schema.get("required")
    rule = schema["properties"]["rules"]["anyOf"][0]
    assert (rule["type"], rule["maxItems"], rule["items"]["required"]) == ("array", 50, ["url"])
    props = rule["items"]["properties"]
    assert set(props) == {"url", "method", "resource_type", "times", "delay_ms", "status", "headers", "body", "error"}
    # As the extension's mock.js checks them: never a whole page, its own list of failures.
    assert "Document" not in props["resource_type"]["enum"] and len(props["resource_type"]["enum"]) == 11
    assert len(props["error"]["enum"]) == 14 and "ConnectionRefused" in props["error"]["enum"]
    assert (props["status"]["minimum"], props["status"]["maximum"], props["delay_ms"]["maximum"], props["times"]["minimum"]) == (100, 599, 30000, 1)
    for words in ("handles\nerrors", "first matching rule with uses left wins", "another site", "paused", "ten minutes", "never faked", "Allow\neverything"):
        assert words in tool["description"], words
    seen: list = []
    listed = {"tab_id": 7, "origin": "http://localhost:3000", "rules": [{"url": "*/api/orders*", "action": "respond", "status": 500, "hits": 0}], "note": "Rules last until cleared."}
    link = fake({"browser_mock": {"ok": True, "result": listed}}, seen)
    rules = [{"url": "*/api/orders*", "method": "GET", "status": 500, "body": {"error": "boom"}}]
    out = run(browser.call(link, "browser_mock", {"rules": rules, "clear": "true", "tab_id": "7"}))
    assert (json.loads(out.text), out.is_error) == (listed, False)
    assert seen[-1] == ("browser_mock", {"rules": rules, "clear": True, "tab_id": 7}, 90.0)
    # No arguments: list the active rules — nothing added, nothing cleared.
    run(browser.call(link, "browser_mock", {}))
    assert seen[-1][1] == {"rules": None, "clear": False, "tab_id": None}
    link = fake({"browser_mock": {"ok": False, "error": "Rule 1: `status` must be from 100 to 599.", "unavailable": False}})
    out = run(browser.call(link, "browser_mock", {"rules": [{"url": "*", "status": 700}]}))
    assert json.loads(out.text) == {"error": "browser_error", "message": "Could not fake network responses: Rule 1: `status` must be from 100 to 599."}
    assert "browser_mock" in browser_links.OPS and "browser_mock" not in browser.READ_ONLY


def test_browser_record_films_a_scenario_with_any_browser() -> None:
    tool = browser.find("browser_record")
    # The plain browser pack: every agent with a browser has it, web development tools or not.
    assert tool["pack"] == "browser" and "browser_record" in {t["name"] for t in browser.tools_for({"browser_link": LINK})}
    schema = tool["input_schema"]
    assert set(schema["properties"]) == {"action", "name", "tab_id"} and not schema.get("required")
    assert (schema["properties"]["action"]["enum"], schema["properties"]["action"]["default"]) == (["start", "stop", "status"], "status")
    assert schema["properties"]["name"]["anyOf"][0]["maxLength"] == 120
    for words in ("start right before the scenario", "stop right after", "descriptive name", "asked unless the site is trusted", "at most 3 at once", "Never asks", "15 minutes", "5 minutes after", "debugging\nbar is cancelled", "still saved"):
        assert words in tool["description"], words
    seen: list = []
    started = {"recording": True, "tab_id": 3, "name": "Checkout", "started_at": "2026-11-19T10:00:00Z", "elapsed_ms": 0, "frames": 0, "note": "Call browser_record with action stop when the scenario is over."}
    link = fake({"browser_record": {"ok": True, "result": started}}, seen)
    out = run(browser.call(link, "browser_record", {"action": "start", "name": "Checkout", "tab_id": "3"}))
    assert (json.loads(out.text), out.images, out.is_error) == (started, [], False)
    assert seen[-1] == ("browser_record", {"action": "start", "name": "Checkout", "tab_id": 3}, 90.0)
    # No arguments: the status.
    run(browser.call(link, "browser_record", {}))
    assert seen[-1][1] == {"action": "status", "name": None, "tab_id": None}
    link = fake({"browser_record": {"ok": False, "error": "This tab is already being recorded: stop that recording first.", "unavailable": False}})
    out = run(browser.call(link, "browser_record", {"action": "start"}))
    assert json.loads(out.text)["message"] == "Could not record the tab: This tab is already being recorded: stop that recording first."
    assert "browser_record" in browser_links.OPS and "browser_record" not in browser.READ_ONLY


# --- its tools --------------------------------------------------------------------------------------


def _paired(client: TestClient, me: dict[str, str], label: str, **settings) -> str:
    """An agent made by pairing a browser (only a claim gives an agent one), with these
    settings besides; its link's id."""
    e = Extension(client, label)
    assert client.post(f"{BASE}/claim", json={"code": e.code}, headers=me).status_code == 200
    # Its browser is open: the extension polls (an agent whose browser is closed is offline).
    assert e.poll().json()["state"] == "paired"
    config = {**_config(client, me, label.lower()), **settings}
    assert _save_config(client, me, label.lower(), config).status_code == 200
    return e.id


@needs_db
def test_the_paired_browser_is_driven_and_its_pictures_come_back(client: TestClient, me: dict[str, str], monkeypatch) -> None:
    asked: list = []

    async def link(state, user_id, link_id, op, args, *, agent=None, timeout_seconds=None):
        asked.append({"user": user_id, "link": link_id, "op": op, "args": args, "agent": agent, "timeout": timeout_seconds})
        if op == "browser_screenshot":
            return {"ok": True, "result": {"image": f"shot{len(asked)}", "mime": "image/jpeg"}}
        if op == "browser_snapshot":
            return {"ok": True, "result": {"text": "Example Domain", "image": "snap", "mime": "image/png"}}
        return {"ok": False, "error": "The person refused.", "unavailable": False}

    monkeypatch.setattr(browser_links, "run_op", link)
    paired_link = _paired(client, me, "Scout")
    # Offered the browser pack — not the web development tools, which are off.
    box = _box(client, me, "scout")
    assert {"browser_snapshot", "browser_click", "browser_mouse"} <= box.offered and "browser_console" not in box.offered
    # Wysebee Assistant is told where they run (the browser pack's note).
    assert any("the person's own browser (Chrome), signed in to their sites" in n for n in box.notes)
    shot = _call(client, me, "scout", "browser_screenshot")
    snap = _call(client, me, "scout", "browser_snapshot")
    click = _call(client, me, "scout", "browser_click", {"ref": "e1"})
    console = _call(client, me, "scout", "browser_console")
    # Each call went to this agent's own link, as its op.
    assert [(a["op"], a["agent"], a["link"], a["user"], a["timeout"]) for a in asked] == [
        (op, _agents(client, me)["scout"], paired_link, me["X-Test-User"], 90.0) for op in ("browser_screenshot", "browser_snapshot", "browser_click")]
    assert asked[1]["args"] == {"tab_id": None, "with_image": True} and "record" not in asked[2]["args"]
    assert (shot.text, shot.images) == ("[image attached]", [{"media_type": "image/jpeg", "data": "shot1"}])
    assert (snap.text, snap.images) == ('{"text":"Example Domain"}[image attached]', [{"media_type": "image/png", "data": "snap"}])
    assert (json.loads(click.text), click.is_error) == ({"error": "browser_error", "message": "Could not click: The person refused."}, False)
    assert (console.text, console.is_error) == ("'browser_console' is not one of your tools.", True)


@needs_db
def test_the_web_development_tools_come_with_their_switch_and_none_with_access_off(client: TestClient, me: dict[str, str], monkeypatch) -> None:
    async def link(state, user_id, link_id, op, args, *, agent=None, timeout_seconds=None):
        return {"ok": True, "result": {"entries": []}}

    monkeypatch.setattr(browser_links, "run_op", link)
    _paired(client, me, "Dev", browser_devtools=True)
    assert len(_offered(client, me, "dev")) == 25  # with send_notification, every agent's
    assert _call(client, me, "dev", "browser_console").text == '{"entries":[]}'
    # Browser access off: no browser tool is offered, and one called anyway is refused.
    _paired(client, me, "Off", browser_access=False, browser_devtools=True)
    assert _offered(client, me, "off") == {"send_notification"}
    out = _call(client, me, "off", "browser_tabs")
    assert (out.text, out.is_error) == ("'browser_tabs' is not one of your tools.", True)


@needs_db
def test_a_tool_reaches_the_real_extension_through_the_queue(client: TestClient, me: dict[str, str]) -> None:
    e = Extension(client, "Scout")
    assert client.post(f"{BASE}/claim", json={"code": e.code}, headers=me).status_code == 200
    e.poll()
    # Another of the person's agents whose settings name this link does not drive it.
    _agent(client, me, "sky", {"label": "Sky", "browser_link": e.id})
    assert _offered(client, me, "sky") == {"send_notification"}
    with Browser(e, lambda op, args: {"ok": True, "result": {"tabs": [{"id": 7, "url": "https://example.com/"}]}}) as extension:
        out = _call(client, me, "scout", "browser_tabs")
    assert [c["op"] for c in extension.seen] == ["browser_tabs"]
    assert out.text == '{"tabs":[{"id":7,"url":"https://example.com/"}]}'
