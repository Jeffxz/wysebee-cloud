"""The phone pack of agents paired with Wysebee Agent for Android
(apps/cloud/agent_chat/android.py): its tools, their arguments and answers as
docs/protocol/android.md gives them, and its tools operating a phone through
Wysebee Assistant — a fake link in place of the phone (the toolbox's side skipped without
WYSEBEE_TEST_DATABASE_URL)."""

import asyncio
import json
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud import agent_mcp, browser_links
from apps.cloud.agent_chat import android
from apps.cloud.agent_chat.browser import IMAGE_ATTACHED
from tests.cloud_agent_fixtures import _agent, _agents, _box, _call, _config, _offered, client, me  # noqa: F401 — fixtures
from tests.conftest import needs_db
from tests.test_browser_links import AGENT, Extension

LINK = "c" * 32
OPS = ["ping", "android_apps", "android_launch", "android_snapshot", "android_screenshot", "android_tap", "android_type", "android_swipe", "android_scroll", "android_key"]


def run(coro):
    return asyncio.run(coro)


def fake(answers: dict, seen: list | None = None) -> android.Run:
    async def link(op: str, args: dict, timeout: float) -> dict:
        if seen is not None:
            seen.append((op, args, timeout))
        return answers[op]

    return link


# --- the tools -----------------------------------------------------------------------------------


def test_one_tool_per_op_of_the_type() -> None:
    names = [t["name"] for t in android.TOOLS]
    assert names == OPS[1:] and android.OPS == set(OPS)
    assert all(set(t) == {"name", "description", "input_schema"} and t["input_schema"]["additionalProperties"] is False for t in android.TOOLS)


def test_an_agent_gets_them_only_with_a_phone() -> None:
    assert android.tools_for({}) == [] and android.tools_for({"android_link": "  "}) == [] and android.tools_for({"android_link": 5}) == []
    assert android.paired({"android_link": f" {LINK} "}) == LINK
    assert [t["name"] for t in android.tools_for({"android_link": LINK})] == OPS[1:]
    # A copy each time: nobody changes the catalog through it.
    android.tools_for({"android_link": LINK})[0]["name"] = "x"
    assert android.TOOLS[0]["name"] == "android_apps"


def test_arguments_are_checked_and_only_those_given_are_sent() -> None:
    seen: list = []
    link = fake({"android_tap": {"ok": True, "result": {"done": "tapped", "app": "com.example"}}}, seen)
    assert run(android.call(link, "nope", {})).is_error
    assert run(android.call(link, "android_tap", {"button": 1})).text == "Error calling tool 'android_tap': unexpected argument 'button'."
    assert run(android.call(link, "android_type", {})).is_error
    out = run(android.call(link, "android_tap", {"x": "10", "y": 20}))
    # Coerced as Pydantic would; ref left out (the phone reads a key that is there), defaults sent.
    assert seen == [("android_tap", {"x": 10, "y": 20, "long": False}, 60.0)]
    assert (out.is_error, json.loads(out.text)) == (False, {"done": "tapped", "app": "com.example"})


def test_without_a_phone_or_when_it_refuses() -> None:
    unavailable = json.loads(run(android.call(None, "android_apps", {})).text)
    assert unavailable["error"] == "android_unavailable" and "no phone" in unavailable["message"]
    link = fake({
        "android_key": {"ok": False, "error": "Wysebee Agent is paused on the phone.", "unavailable": False},
        "android_apps": {"ok": False, "error": "The phone is not reachable.", "unavailable": True},
    })
    refused = run(android.call(link, "android_key", {"key": "home"}))
    assert not refused.is_error and json.loads(refused.text) == {"error": "android_error", "message": "Could not press the key: Wysebee Agent is paused on the phone."}
    assert json.loads(run(android.call(link, "android_apps", {})).text) == {"error": "android_unavailable", "message": "The phone is not reachable."}


def test_a_snapshot_is_its_text_and_a_picture() -> None:
    seen: list = []
    text = "App: Clock (com.google.android.deskclock)\n\n[1] Button \"Start\" tap @540,1200\n"
    link = fake({"android_snapshot": {"ok": True, "result": {"app": "x", "snapshot": text, "image": "AAAA", "mime": "image/jpeg", "width": 576, "height": 1280}}}, seen)
    out = run(android.call(link, "android_snapshot", {}))
    assert seen == [("android_snapshot", {"wait_ms": 0, "with_image": True}, 60.0)]
    assert (out.text, out.images) == (text + IMAGE_ATTACHED, [{"media_type": "image/jpeg", "data": "AAAA"}])
    # No picture (a protected screen): the text alone, cut like any answer.
    link = fake({"android_snapshot": {"ok": True, "result": {"snapshot": "y" * 60_000}}})
    out = run(android.call(link, "android_snapshot", {"wait_ms": 500}))
    assert out.images == [] and out.text.endswith("…[truncated at 50000 characters]")


def test_a_screenshot_says_how_its_pixels_map_to_the_screen() -> None:
    shot = {"app": "x", "screen": {"width": 1080, "height": 2400}, "image": "BBBB", "mime": "image/png", "width": 576, "height": 1280}
    out = run(android.call(fake({"android_screenshot": {"ok": True, "result": shot}}), "android_screenshot", {}))
    assert out.images == [{"media_type": "image/png", "data": "BBBB"}]
    assert out.text == '{"app":"x","screen":{"width":1080,"height":2400},"width":576,"height":1280}' \
        "\nThe picture is 576x1280; the screen is 1080x2400 pixels: a point (px, py) in the picture is (1080/576*px, 2400/1280*py) on the screen." + IMAGE_ATTACHED
    # Sizes missing or wrong: no note, and no picture when none came.
    out = run(android.call(fake({"android_screenshot": {"ok": True, "result": {"screen": "big", "width": True}}}), "android_screenshot", {}))
    assert (out.text, out.images) == ('{"screen":"big","width":true}', [])


def test_wysebee_assistant_says_where_the_phone_tools_run() -> None:
    from apps.cloud.agent_packs import ToolContext
    from apps.cloud.packs.android import AndroidPack

    pack, run = AndroidPack(), object()
    said = pack.describe(ToolContext(None, None, "u", None, {}, link=SimpleNamespace(browser="Pixel 9"), run_op=run))  # type: ignore[arg-type]
    assert "operate the person's phone (Pixel 9) through Wysebee Agent for Android" in said
    assert "operate the person's phone through" in pack.describe(ToolContext(None, None, "u", None, {}, run_op=run))  # type: ignore[arg-type]
    assert pack.describe(ToolContext(None, None, "u", None, {})) is None  # type: ignore[arg-type]
    # Wysebee Assistant's instructions carry what the packs said.
    box = SimpleNamespace(notes=[said], on_mac=False, skills=[], where=SimpleNamespace())
    assert said in agent_mcp.instructions(agent_mcp.Served("pixel", {"label": "Pixel"}, None, box))


# --- through Wysebee Assistant ---------------------------------------------------------------------


@needs_db
def test_a_phones_agent_is_offered_its_tools_and_they_reach_its_phone(client: TestClient, me: dict[str, str], monkeypatch, migrated_db_url: str) -> None:  # noqa: F811
    asked: list = []

    async def link(state, user_id, link_id, op, args, *, agent=None, timeout_seconds=None):
        asked.append((user_id, link_id, op, args, agent, timeout_seconds))
        return {"ok": True, "result": {"all_apps": False, "apps": [{"package": "com.example", "label": "Example"}]}}

    monkeypatch.setattr(browser_links, "run_op", link)
    p = Extension(client, "Pixel Tester", kind="wysebee-android", browser="Pixel 9")
    assert client.post(f"{AGENT}/claim", json={"code": p.code}, headers=me).status_code == 200
    assert _config(client, me, "pixel-tester")["android_link"] == p.id
    box = _box(client, me, "pixel-tester")
    assert set(OPS[1:]) <= box.offered and all(n in box.where.packed for n in OPS[1:])
    assert any("the person's phone (Pixel 9)" in note for note in box.notes)
    assert not any(n.startswith(("browser_", "local_", "folder_")) for n in box.offered)
    out = _call(client, me, "pixel-tester", "android_apps")
    assert json.loads(out.text)["apps"][0]["package"] == "com.example"
    assert asked == [(me["X-Test-User"], p.id, "android_apps", {}, _agents(client, me)["pixel-tester"], 60.0)]
    # A plain agent has none; and an unpaired phone's agent none either.
    sky = _agent(client, me, "sky", {"label": "Sky"})
    assert not any(n.startswith("android_") for n in _offered(client, me, "sky"))
    # The link held now by another agent: not this one's phone, whatever its settings say.
    engine = create_engine(migrated_db_url)
    with engine.begin() as conn:
        conn.execute(text("UPDATE browser_links SET agent_id = :a WHERE id = :i"), {"a": sky, "i": p.id})
    assert not any(n.startswith("android_") for n in _offered(client, me, "pixel-tester"))
    with engine.begin() as conn:
        conn.execute(text("UPDATE browser_links SET agent_id = :a WHERE id = :i"), {"a": _agents(client, me)["pixel-tester"], "i": p.id})
    engine.dispose()
    assert p.unpair().status_code == 204
    assert not any(n.startswith("android_") for n in _offered(client, me, "pixel-tester"))
