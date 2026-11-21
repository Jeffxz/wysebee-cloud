"""The iPhone Development Toolkit for a Mac's agent (2026-11-17, the owner's call): the tools,
what each sends to the Mac, and that only a Mac's agent may have them."""

import asyncio

from fastapi.testclient import TestClient

from apps.cloud.packs.computer import ComputerPack
from apps.cloud import browser_links
from apps.cloud.agent_chat import ios_dev, toolbox
from tests.cloud_agent_fixtures import _agent, _box, _call, _config, _save_config, client, me  # noqa: F401 — fixtures
from tests.conftest import needs_db
from tests.test_cloud_agent_mac import _web_mac, _web_pc

NAMES = ["devices", "screenshot", "logs", "apps", "info", "boot", "shutdown", "open_url", "launch", "terminate", "appearance", "install", "uninstall"]


def run(coro):
    return asyncio.run(coro)


def fake(answers: dict, seen: list) -> ios_dev.Run:
    async def link(op: str, args: dict, timeout: float) -> dict:
        seen.append((op, args, timeout))
        return answers[op]

    return link


def test_the_toolkit_maps_xcode_names_to_the_macs_and_hands_the_screenshot_back() -> None:
    tools = ios_dev.ios_tools()
    assert [t["name"] for t in tools] == [f"xcode_{n}" for n in NAMES]
    by_name = {t["name"]: t for t in tools}
    # What each needs; udid everywhere but the list.
    required = {n: t["input_schema"]["required"] for n, t in by_name.items() if t["input_schema"]["required"]}
    assert required == {"xcode_open_url": ["url"], "xcode_launch": ["bundle_id"], "xcode_terminate": ["bundle_id"], "xcode_appearance": ["mode"], "xcode_install": ["app"], "xcode_uninstall": ["bundle_id"]}
    assert [n for n, t in by_name.items() if "udid" not in t["input_schema"]["properties"]] == ["xcode_devices"]
    assert by_name["xcode_appearance"]["input_schema"]["properties"]["mode"]["enum"] == ["light", "dark"]
    assert by_name["xcode_logs"]["input_schema"]["properties"]["minutes"]["maximum"] == 60
    assert all("Let Wysebee use iPhones and simulators on this Mac" in t["description"] for t in tools)
    assert "Screen control" in by_name["xcode_screenshot"]["description"]
    assert ios_dev.READ_ONLY == {"xcode_devices", "xcode_screenshot", "xcode_logs", "xcode_apps", "xcode_info"} and ios_dev.READ_ONLY <= ComputerPack.read_only
    seen: list = []
    answers = {"ios_dev": {"ok": True, "result": {"text": "Screenshot of iPhone 15 (iOS 17.2), 4×8 pixels.", "image": {"media_type": "image/jpeg", "data": "/9j/"}}}}
    link = fake(answers, seen)
    out = run(ios_dev.call_ios(link, "xcode_screenshot", {"udid": "SIM-A"}))
    assert (out.text, out.images) == ("Screenshot of iPhone 15 (iOS 17.2), 4×8 pixels.[image attached]", [{"media_type": "image/jpeg", "data": "/9j/"}])
    assert seen == [("ios_dev", {"tool": "ios_screenshot", "args": {"udid": "SIM-A"}}, 240.0)]
    answers["ios_dev"] = {"ok": True, "result": {"text": "Launched."}}
    assert run(ios_dev.call_ios(link, "xcode_launch", "odd")).text == "Launched."
    assert seen[-1][1] == {"tool": "ios_launch", "args": {}}
    answers["ios_dev"] = {"ok": False, "error": "The iPhone toolkit is off on that Mac. The person can turn on 'Let Wysebee use iPhones and simulators on this Mac' in Wysebee Agent.", "unavailable": False}
    out = run(ios_dev.call_ios(link, "xcode_devices", {}))
    assert out.is_error and out.text.startswith("The iPhone toolkit is off on that Mac.")


@needs_db
def test_a_macs_agent_given_the_toolkit_uses_its_simulators_and_iphones(client: TestClient, me: dict[str, str], monkeypatch) -> None:
    asked: list = []

    async def link(state, user_id, link_id, op, args, *, agent=None, timeout_seconds=None):
        asked.append((op, args, timeout_seconds))
        return {"ok": True, "result": {"text": "done"}}

    monkeypatch.setattr(browser_links, "run_op", link)
    _web_mac(client, me)
    assert "xcode_devices" not in _box(client, me, "studio-mac").offered
    config = _config(client, me, "studio-mac")
    assert _save_config(client, me, "studio-mac", {**config, "ios_toolkit": True}).status_code == 200
    box = _box(client, me, "studio-mac")
    assert {f"xcode_{n}" for n in NAMES} <= box.offered
    assert box.reads_only("xcode_logs") and not box.reads_only("xcode_install") and not box.reads_only("xcode_boot")
    assert _call(client, me, "studio-mac", "xcode_install", {"app": "Build/MyApp.app"}).text == "done"
    assert asked == [("ios_dev", {"tool": "ios_install", "args": {"app": "Build/MyApp.app"}}, 240.0)]


@needs_db
def test_only_a_macs_agent_may_be_given_the_iphone_toolkit(client: TestClient, me: dict[str, str]) -> None:
    # A Windows PC's agent: refused (no Xcode on Windows), in the Mac's words.
    _web_pc(client, me)
    config = _config(client, me, "studio-pc")
    r = _save_config(client, me, "studio-pc", {**config, "ios_toolkit": True})
    assert r.status_code == 422 and "Only an agent made by pairing Wysebee Agent for Mac can have iPhone Development Toolkit" in r.text
    assert not any(n.startswith("xcode_") for n in _box(client, me, "studio-pc").offered)
    _agent(client, me, "plain", {"label": "Plain"})
    assert _save_config(client, me, "plain", {"label": "Plain", "ios_toolkit": True}).status_code == 422
