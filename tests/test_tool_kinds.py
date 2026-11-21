"""Which agent may add which tool (apps/cloud/tool_kinds.py): the agent types' rows say it
(2026-11-13, later), on settings alone. The routes' side is in test_browser_links.py."""

from types import SimpleNamespace

from apps.cloud import agent_packs, agent_types, tool_drafts, tool_kinds

BROWSER_TOOLS = ["browser", "devtools", "gmail", "calendar", "travel", "news", "website"]
MAC_TOOLS = ["local", "folder", "sqlite", "skill_scripts"]
PHONE_TOOLS = ["android"]


def row(**over):
    base = {"id": agent_types.CHROME_ID, "key": agent_types.CHROME, "name": "Wysebee Chrome Agent", "description": "", "link_field": "browser_link", "ops": ["ping"], "tool_kinds": BROWSER_TOOLS, "enabled": True}
    return SimpleNamespace(**{**base, **over})


CHROME = agent_types.parse(row())
MAC = agent_types.parse(row(id=agent_types.OSX_ID, key=agent_types.OSX, name="Wysebee OSX Agent", link_field="mac_link", tool_kinds=MAC_TOOLS))
TYPES = [CHROME, MAC]
BROWSER = {"browser_link": "a" * 32, "agent_type_id": agent_types.CHROME_ID}
ON_MAC = {"mac_link": "b" * 32, "agent_type_id": agent_types.OSX_ID}


def test_the_packs_name_the_tools_the_seeded_types_list() -> None:
    by_kind = {p.kind: list(p.tool_kinds) for p in agent_packs.known().packs}
    # Run any program and its siblings (2026-11-16, a Mac's too 2026-11-17) and the iPhone
    # toolkit (a Mac's alone) are held where a Mac's link is.
    assert by_kind == {"browser": BROWSER_TOOLS, "osx": [*MAC_TOOLS, "any_program", "screen", "developer", "android_toolkit", "ios_toolkit"], "android": PHONE_TOOLS}
    assert set(by_kind) == set(tool_kinds.LINK_FIELDS) and all(p.who for p in agent_packs.known().packs)
    # Browser access cannot exist without the link; a skill's scripts are a tag; the local
    # database is kept per computer; Local Folder has no field a save sets: none is looked for.
    # Since migration 0061 site links and programs are tools given (apps/cloud/user_tools.py),
    # checked by may_have; a save checks only the switch.
    assert set(tool_kinds.has()) == {"devtools", "any_program", "screen", "developer", "android_toolkit", "ios_toolkit"}
    assert set(tool_kinds.labels()) == {"devtools", "gmail", "calendar", "travel", "news", "website", "local", "any_program", "screen", "developer", "android_toolkit", "ios_toolkit"}
    # Wysebee Assistant's request_switch lists the same switches as the packs.
    request = next(t for t in tool_drafts.TOOLS if t["name"] == "request_switch")
    assert request["inputSchema"]["properties"]["switch"]["enum"] == list(tool_drafts.switches())
    assert tool_kinds.refusal(None, {"skills": ["forecast"]}, TYPES) is None
    assert tool_kinds.refusal(None, {"mac_folders": [{"id": "f1"}], "folders": [{"path": "/x"}]}, TYPES) is None


def test_an_agents_type_is_its_links_while_it_holds_one() -> None:
    assert agent_types.of_agent(BROWSER, TYPES) is CHROME and agent_types.of_agent(ON_MAC, TYPES) is MAC
    # Unpaired (the link field gone or blank), a type no longer known, or none named: no type.
    for plain in ({}, {"agent_type_id": agent_types.CHROME_ID}, {**BROWSER, "browser_link": " "}, {**BROWSER, "browser_link": 5}, {"browser_link": "a" * 32}, {**BROWSER, "agent_type_id": "x"}, {**ON_MAC, "mac_link": None}):
        assert agent_types.of_agent(plain, TYPES) is None, plain


def test_adding_is_refused_and_keeping_or_removing_is_not() -> None:
    # A new agent (nothing stored), and one that lacked it.
    for stored in (None, {}, {"browser_devtools": False}):
        said = tool_kinds.refusal(stored, {"browser_devtools": True}, TYPES)
        assert "browser extension" in said and "Web development tools" in said and "Devices" in said
        assert tool_kinds.refusal(stored, {**BROWSER, "browser_devtools": True}, TYPES) is None
    # Kept or changed, and removed.
    assert tool_kinds.refusal({"browser_devtools": True}, {"browser_devtools": True, "label": "x"}, TYPES) is None
    assert tool_kinds.refusal({"browser_devtools": True}, {}, TYPES) is None
    # What is not the tool: the switch off or not a boolean; fields that are tools now.
    for nothing in ({"browser_devtools": False}, {"browser_devtools": "yes"}, {"local_programs": [{"name": "p"}]}, {"websites": [{}]}):
        assert tool_kinds.refusal(None, nothing, TYPES) is None, nothing


def test_a_tool_is_given_only_to_the_agents_whose_type_lists_it() -> None:
    said = tool_kinds.may_have("local", BROWSER, TYPES)
    assert "Wysebee Agent for Mac" in said and "Run local program" in said
    assert tool_kinds.may_have("local", ON_MAC, TYPES) is None
    assert "Open Gmail" in tool_kinds.may_have("gmail", ON_MAC, TYPES) and "browser extension" in tool_kinds.may_have("news", {}, TYPES)
    assert tool_kinds.may_have("website", BROWSER, TYPES) is None
    # A tool no type lists is any agent's.
    assert tool_kinds.may_have("local", {}, []) is None


def test_the_rows_say_which_agents_may_have_a_tool() -> None:
    # Registered on a second browser type too: an Edge agent may add the browser's tools.
    edge = agent_types.parse(row(id="6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c03", key="wysebee-browser-edge", name="Wysebee Edge Agent"))
    on_edge = {"browser_link": "c" * 32, "agent_type_id": edge.id}
    assert tool_kinds.may_have("news", on_edge, [*TYPES, edge]) is None
    # A tool no type lists is any agent's; one an admin gives a type is that type's alone.
    narrow = agent_types.parse(row(tool_kinds=["devtools"]))
    assert tool_kinds.may_have("news", {}, [narrow, MAC]) is None
    assert tool_kinds.refusal(None, {"browser_devtools": True}, [narrow, MAC]) is not None
    assert tool_kinds.refusal(None, {"browser_devtools": True}, []) is None


def test_a_tool_a_mac_and_a_windows_pc_may_have_names_both() -> None:
    windows = agent_types.parse(row(id=agent_types.WINDOWS_ID, key=agent_types.WINDOWS, name="Wysebee Windows Agent", link_field="mac_link", tool_kinds=[*MAC_TOOLS, "developer"]))
    mac = agent_types.parse(row(id=agent_types.OSX_ID, key=agent_types.OSX, name="Wysebee OSX Agent", link_field="mac_link", tool_kinds=[*MAC_TOOLS, "developer", "ios_toolkit"]))
    types = [CHROME, mac, windows]
    said = tool_kinds.refusal(None, {"developer_access": True}, types)
    assert said is not None and "Wysebee Agent for Mac or for Windows can have Developer access" in said and "Mac or Windows PC" in said
    assert tool_kinds.refusal(None, {**ON_MAC, "developer_access": True}, types) is None
    # Listed by the Mac's type alone: the Mac's words, for a Windows PC's agent too.
    on_pc = {"mac_link": "d" * 32, "agent_type_id": agent_types.WINDOWS_ID}
    said = tool_kinds.refusal(None, {**on_pc, "ios_toolkit": True}, types)
    assert said is not None and "Wysebee Agent for Mac can have iPhone Development Toolkit" in said
    assert "or for Windows" in tool_kinds.may_have("developer", BROWSER, types)
