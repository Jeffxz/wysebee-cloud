"""Developer access and the Android Development Toolkit for a Windows PC's agent (2026-11-16,
the owner's call) and a Mac's (2026-11-17): the tools, in each computer's words, what each
sends to the computer, and who may have them."""

import asyncio

from fastapi.testclient import TestClient

from apps.cloud import browser_links
from apps.cloud.agent_chat import pc_dev
from tests.cloud_agent_fixtures import _agent, _box, _call, _config, _save_config, client, me  # noqa: F401 — fixtures
from tests.conftest import needs_db
from tests.test_cloud_agent_mac import _web_mac, _web_pc


def run(coro):
    return asyncio.run(coro)


def fake(answers: dict, seen: list) -> pc_dev.Run:
    async def link(op: str, args: dict, timeout: float) -> dict:
        seen.append((op, args, timeout))
        return answers[op]

    return link


def test_developer_tools_send_the_models_arguments_to_their_ops() -> None:
    seen: list = []
    answers = {
        "dev_shell": {"ok": True, "result": {"exit_code": 0, "stdout": "BUILD SUCCESSFUL\n", "stderr": ""}},
        "dev_job": {"ok": True, "result": {"job": "job-1", "status": "running", "output": "…"}},
        "dev_file": {"ok": True, "result": {"text": "     1\tplugins {}"}},
    }
    link = fake(answers, seen)
    out = run(pc_dev.call_dev(link, "dev_shell", {"command": "gradlew.bat build", "shell": "cmd", "cwd": "app", "timeout_secs": 200}))
    assert (out.text, out.is_error) == ('{"exit_code":0,"stdout":"BUILD SUCCESSFUL\\n","stderr":""}', False)
    run(pc_dev.call_dev(link, "dev_shell", {"command": "x", "background": True}))
    run(pc_dev.call_dev(link, "dev_shell", "odd"))
    run(pc_dev.call_dev(link, "dev_shell", {"command": "x", "timeout_secs": True}))
    assert [round(t) for _, _, t in seen] == [220, 75, 75, 75]
    out = run(pc_dev.call_dev(link, "dev_job", {"job": "job-1"}))
    assert '"status":"running"' in out.text
    out = run(pc_dev.call_dev(link, "dev_read", {"path": "app/build.gradle"}))
    assert out.text == "     1\tplugins {}"
    for tool, op_tool in pc_dev.FILE_TOOLS.items():
        run(pc_dev.call_dev(link, tool, {"path": "p"}))
        assert seen[-1][:2] == ("dev_file", {"path": "p", "tool": op_tool})
    answers["dev_file"] = {"ok": False, "error": "Developer access is off on that PC.", "unavailable": False}
    out = run(pc_dev.call_dev(link, "dev_list", {}))
    assert (out.text, out.is_error) == ("Developer access is off on that PC.", True)
    names = [t["name"] for t in pc_dev.dev_tools()]
    assert names == ["dev_shell", "dev_job", "dev_read", "dev_write", "dev_edit", "dev_glob", "dev_grep", "dev_list"]
    assert set(names) == set(pc_dev.DEV_TOOLS)


def test_each_computers_developer_tools_name_its_shells_paths_and_switch() -> None:
    pc, on_mac = pc_dev.dev_tools("Windows PC"), pc_dev.dev_tools("Mac")
    shell = {d: t[0]["input_schema"]["properties"]["shell"] for d, t in (("pc", pc), ("mac", on_mac))}
    assert shell["pc"]["enum"] == ["powershell", "pwsh", "cmd"] and "powershell if omitted" in shell["pc"]["description"]
    assert shell["mac"]["enum"] == ["zsh", "bash", "sh"] and "zsh if omitted" in shell["mac"]["description"]
    assert "PowerShell by default" in pc[0]["description"] and "zsh by default, as a login shell" in on_mac[0]["description"]
    assert all("Let Wysebee use this PC as a developer" in t["description"] for t in pc)
    assert all("Let Wysebee use this Mac as a developer" in t["description"] and "Windows" not in t["description"] and "PowerShell" not in t["description"] for t in on_mac)
    assert "C:\\Users" in pc[2]["input_schema"]["properties"]["path"]["description"] and "/Users/" in on_mac[2]["input_schema"]["properties"]["path"]["description"]
    assert "the person's Mac" in on_mac[3]["description"]


def test_the_android_toolkit_maps_adb_names_to_the_pcs_and_hands_pictures_back() -> None:
    seen: list = []
    answers = {"android_dev": {"ok": True, "result": {"text": "Screenshot of R58M.", "image": {"media_type": "image/jpeg", "data": "/9j/"}}}}
    link = fake(answers, seen)
    out = run(pc_dev.call_android(link, "adb_screenshot", {"serial": "R58M"}))
    assert (out.text, out.images) == ("Screenshot of R58M.[image attached]", [{"media_type": "image/jpeg", "data": "/9j/"}])
    assert seen == [("android_dev", {"tool": "android_screenshot", "args": {"serial": "R58M"}}, 240.0)]
    answers["android_dev"] = {"ok": True, "result": {"text": "Tapped (1, 2)."}}
    assert run(pc_dev.call_android(link, "adb_tap", "odd")).text == "Tapped (1, 2)."
    assert seen[-1][1] == {"tool": "android_tap", "args": {}}
    answers["android_dev"] = {"ok": True, "result": {"other": 1}}
    assert run(pc_dev.call_android(link, "adb_info", {})).text == '{"other": 1}'
    answers["android_dev"] = {"ok": True, "result": "odd"}
    assert run(pc_dev.call_android(link, "adb_info", {})).text == "{}"
    answers["android_dev"] = {"ok": False, "error": "adb is not on this PC.", "unavailable": False}
    out = run(pc_dev.call_android(link, "adb_devices", {}))
    assert (out.text, out.is_error) == ("adb is not on this PC.", True)
    tools = pc_dev.android_tools()
    assert len(tools) == 17 and all(t["name"].startswith("adb_") for t in tools)
    assert pc_dev.READ_ONLY <= {t["name"] for t in tools} | set(pc_dev.DEV_TOOLS)
    # Each computer's words: its Downloads folder, its paths, where adb comes from, its switch.
    pc = {t["name"]: t["description"] for t in pc_dev.android_tools("Windows PC")}
    on_mac = {t["name"]: t["description"] for t in pc_dev.android_tools("Mac")}
    assert "Downloads\\Wysebee" in pc["adb_pull"] and "~/Downloads/Wysebee" in on_mac["adb_pull"]
    assert "outputs\\apk" in pc["adb_install"] and "outputs/apk/debug/app-debug.apk" in on_mac["adb_install"]
    assert "brew install android-platform-tools" in on_mac["adb_devices"] and "person's Windows PC" in pc["adb_devices"]
    assert all("Android phones on this Mac" in d and "Windows" not in d and "{" not in d for d in on_mac.values())
    assert all("Android phones on this PC" in d for d in pc.values())


@needs_db
def test_a_windows_pcs_agent_given_both_works_on_the_pc_and_its_phones(client: TestClient, me: dict[str, str], monkeypatch) -> None:
    asked: list = []

    async def link(state, user_id, link_id, op, args, *, agent=None, timeout_seconds=None):
        asked.append((op, args, timeout_seconds))
        return {"ok": True, "result": {"text": "done"}}

    monkeypatch.setattr(browser_links, "run_op", link)
    _web_pc(client, me)
    box = _box(client, me, "studio-pc")
    assert "dev_shell" not in box.offered and "adb_devices" not in box.offered
    config = _config(client, me, "studio-pc")
    assert _save_config(client, me, "studio-pc", {**config, "developer_access": True, "android_toolkit": True}).status_code == 200
    box = _box(client, me, "studio-pc")
    assert {"dev_shell", "dev_read", "dev_grep", "adb_devices", "adb_install"} <= box.offered
    assert box.reads_only("dev_read") and not box.reads_only("dev_shell") and box.reads_only("adb_logcat") and not box.reads_only("adb_install")
    assert _call(client, me, "studio-pc", "dev_grep", {"pattern": "TODO"}).text == "done"
    assert _call(client, me, "studio-pc", "adb_devices", {}).text == "done"
    assert [(op, args) for op, args, _ in asked] == [("dev_file", {"pattern": "TODO", "tool": "grep"}), ("android_dev", {"tool": "android_devices", "args": {}})]


@needs_db
def test_a_windows_pcs_agent_is_described_as_a_windows_pc(client: TestClient, me: dict[str, str]) -> None:
    from apps.cloud import agent_mcp
    from apps.cloud.agent_chat import mac
    from tests.cloud_agent_fixtures import _give_programs

    _web_pc(client, me)
    _give_programs(client, me, "studio-pc", [{"name": "whoami", "description": "Who", "command": "whoami", "args": []}])
    box = _box(client, me, "studio-pc")
    assert box.device == "Windows PC" and mac.device_of({"paired_kind": "wysebee-osx"}) == "Mac"
    described = {d["name"]: d["description"] for d in box.defs}
    assert "on the person's Windows PC that they set up" in described["local_whoami"]
    folders = mac.folder_tools({"mac_folders": [{"id": "a", "name": "Code", "path": "C:\\code", "mode": "read"}]}, box.device)
    assert "The person's folders on their Windows PC" in folders[0]["description"]
    said = agent_mcp.instructions(agent_mcp.Served("studio-pc", _config(client, me, "studio-pc"), "", box))
    assert "run on the person's Windows PC (STUDIO) through Wysebee Agent for Windows" in said and "the Windows PC has to be awake" in said


@needs_db
def test_a_macs_agent_may_be_given_both_too_in_a_macs_words(client: TestClient, me: dict[str, str], monkeypatch) -> None:
    asked: list = []

    async def link(state, user_id, link_id, op, args, *, agent=None, timeout_seconds=None):
        asked.append((op, args))
        return {"ok": True, "result": {"text": "done"}}

    monkeypatch.setattr(browser_links, "run_op", link)
    _web_mac(client, me)
    config = _config(client, me, "studio-mac")
    assert _save_config(client, me, "studio-mac", {**config, "developer_access": True, "android_toolkit": True}).status_code == 200
    box = _box(client, me, "studio-mac")
    shell = next(d for d in box.defs if d["name"] == "dev_shell")
    assert shell["input_schema"]["properties"]["shell"]["enum"] == ["zsh", "bash", "sh"] and "adb_devices" in box.offered
    assert _call(client, me, "studio-mac", "dev_shell", {"command": "ls", "shell": "zsh"}).text == "done"
    assert asked == [("dev_shell", {"command": "ls", "shell": "zsh"})]


@needs_db
def test_only_a_macs_or_a_windows_pcs_agent_may_be_given_developer_access_or_the_android_toolkit(client: TestClient, me: dict[str, str]) -> None:
    _agent(client, me, "plain", {"label": "Plain"})
    for field, label in (("developer_access", "Developer access"), ("android_toolkit", "Android Development Toolkit")):
        r = _save_config(client, me, "plain", {"label": "Plain", field: True})
        assert r.status_code == 422 and f"Wysebee Agent for Mac, Windows or Linux can have {label}" in r.text, field
