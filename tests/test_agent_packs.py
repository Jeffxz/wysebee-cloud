"""Agent type packs, step 1 (apps/cloud/agent_packs.py): a pack's checks against the built-in
kinds and the other packs, the registry, the hooks' defaults, its link field one a type's row may
name, and its type row added when missing. The database tests are skipped without WYSEBEE_TEST_DATABASE_URL."""

import asyncio
import logging
from dataclasses import replace
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from apps.cloud import agent_packs, agent_types
from apps.cloud.agent_packs import AgentPack, AgentTypeSeed, LinkContext, PackRefused, ToolContext, build
from apps.cloud.extensions import API, Extension
from tests.conftest import make_client, needs_db

SEED = AgentTypeSeed(id="7a000000-0000-4000-8000-000000000001", name="Wysebee Agent for Tests", ops=frozenset({"ping", "ios_tap"}), tool_kinds=frozenset({"ios_toolkit"}))


class Phone(AgentPack):
    key = "wysebee-ios-test"
    kind = "iostest"
    link_field = "iostest_link"
    tool_prefix = "iost_"
    seed = SEED
    read_only = frozenset({"iost_screenshot"})


def pack(**attrs) -> AgentPack:
    p = Phone()
    for name, value in attrs.items():
        setattr(p, name, value)
    return p


@pytest.fixture
def loud(monkeypatch):
    """The loggers this file reads, on: migrations' logging config turns existing ones off."""
    from apps.cloud import main

    for logger in (agent_packs.logger, main.logger):
        monkeypatch.setattr(logger, "disabled", False)


# --- the registry ------------------------------------------------------------------------------


def test_a_good_pack_is_registered_by_key_kind_and_tool_prefix() -> None:
    a, b = Phone(), pack(key="wysebee-ios-test-two", tool_prefix="iosu_", seed=replace(SEED, id="7a000000-0000-4000-8000-000000000002"), read_only=frozenset())
    reg = build([a, b])
    assert reg.by_key == {a.key: a, b.key: b} and reg.by_kind == {"iostest": [a, b]}
    assert reg.read_only == {"iost_screenshot"}
    assert reg.for_tool("iost_tap") is a and reg.for_tool("iosu_tap") is b and reg.for_tool("browser_tabs") is None
    empty = build([])
    assert (empty.packs, empty.read_only) == ([], frozenset())


@pytest.mark.parametrize(("attrs", "why"), [
    ({"key": "ios"}, "its key"),
    ({"key": ""}, "its key"),
    ({"kind": "Bad Kind"}, "not well formed"),
    ({"link_field": "ios_field"}, "not well formed"),
    ({"tool_prefix": "ios"}, "not well formed"),
    ({"key": agent_types.CHROME}, "built-in"),
    ({"kind": "osx"}, "built-in"),
    ({"kind": "android", "link_field": "android_link"}, "built-in"),
    ({"tool_prefix": "browser_"}, "overlaps a built-in"),
    ({"tool_prefix": "xcode_"}, "overlaps a built-in"),
    ({"tool_prefix": "run_"}, "overlaps a built-in"),
    ({"read_only": frozenset({"screen_screenshot"})}, "must start with"),
    ({"seed": replace(SEED, id="not-a-uuid")}, "limits"),
    ({"seed": replace(SEED, name=" ")}, "limits"),
    ({"seed": replace(SEED, ops=frozenset({"Bad Op"}))}, "limits"),
])
def test_a_pack_that_would_clash_with_a_built_in_kind_or_break_the_table_is_refused(attrs, why) -> None:
    with pytest.raises(PackRefused, match=why):
        build([pack(**attrs)])


@pytest.mark.parametrize(("attrs", "why"), [
    ({}, "two have the key"),
    ({"key": "wysebee-other", "kind": "other", "tool_prefix": "oth_", "read_only": frozenset(), "seed": None}, "one link field, two kinds"),
    ({"key": "wysebee-other", "link_field": "other_link", "tool_prefix": "oth_", "read_only": frozenset(), "seed": None}, "one kind, two link fields"),
    ({"key": "wysebee-other", "read_only": frozenset(), "seed": None}, "prefixes overlap"),
    ({"key": "wysebee-other", "tool_prefix": "oth_", "read_only": frozenset()}, "share an id"),
])
def test_two_packs_that_would_clash_are_refused(attrs, why) -> None:
    with pytest.raises(PackRefused, match=why):
        build([Phone(), pack(**attrs)])


def test_a_packs_hooks_answer_nothing_unless_it_overrides_them() -> None:
    p, ctx, link = Phone(), ToolContext(None, None, "u", None, {}), LinkContext(None, None, None)  # type: ignore[arg-type]
    assert asyncio.run(p.tools(ctx)) == []
    with pytest.raises(NotImplementedError, match="iost_tap"):
        asyncio.run(p.run(ctx, "iost_tap", {}))
    assert p.read_poll({"x": 1}) == {}
    assert asyncio.run(p.poll_extra(link)) == {}
    assert asyncio.run(p.apply_poll(link, {})) is None
    assert (p.wakes_on, p.cloud_only_fields, tuple(p.settings), p.words) == (frozenset(), frozenset(), (), {})
    # The link it drives: its link field's, trimmed; none said of where its tools run.
    assert (p.link_of({"iostest_link": " abc "}), p.link_of({"iostest_link": 5}), p.link_of({})) == ("abc", "", "")
    assert p.describe(ctx) is None
    assert (p.device_name({}), p.runs_skill_scripts, p.serves_skill_files, p.link_view(None), p.held_settings(None)) == ("device", False, False, {}, {})
    assert p.offline_reason(None, "agent", False) is None and p.settings_for(["x"]) == []


def test_a_registered_packs_link_field_is_one_a_types_row_may_name(ui_dist: Path, monkeypatch) -> None:
    # Before any app: the built-in packs' alone.
    monkeypatch.setattr(agent_packs, "_known", None)
    assert "iostest_link" not in agent_types.link_fields()
    with make_client(ui_dist, [Extension("phones", API, agent_types=[Phone()])]):
        assert agent_types.link_fields()["iostest_link"] == "iostest"


def test_an_app_with_clashing_packs_does_not_start(ui_dist: Path) -> None:
    ext = Extension("clash", API, agent_types=[Phone(), Phone()])
    with pytest.raises(PackRefused, match="two have the key"):
        make_client(ui_dist, [ext])


def test_a_database_not_reached_leaves_the_rows_for_the_next_start(ui_dist: Path, caplog, loud) -> None:
    caplog.set_level(logging.WARNING)
    with make_client(ui_dist, [Extension("phones", API, agent_types=[Phone()])]) as c:
        # The built-in packs first (the browser's), then the extension's.
        assert [p.key for p in c.app.state.agent_packs.packs] == [agent_types.CHROME, agent_types.ANDROID, agent_types.OSX, Phone.key]
    assert "agent pack types not added" in caplog.text


# --- with the database ------------------------------------------------------------------------


def _rows(url: str) -> list[tuple]:
    with create_engine(url).begin() as conn:
        return conn.execute(text("SELECT key, name, link_field, ops, tool_kinds, enabled FROM agent_types WHERE id = :i"), {"i": SEED.id}).all()


@pytest.fixture
def clean(migrated_db_url: str):
    yield migrated_db_url
    with create_engine(migrated_db_url).begin() as conn:
        conn.execute(text("DELETE FROM agent_types WHERE id = :i"), {"i": SEED.id})
    agent_types.forget()


@needs_db
def test_a_packs_row_is_added_once_and_left_to_admin_after(ui_dist: Path, clean: str, caplog, loud) -> None:
    caplog.set_level(logging.INFO, logger="wysebee.cloud")
    with make_client(ui_dist, [Extension("phones", API, agent_types=[Phone()])], database_url=clean) as c:
        assert _rows(clean) == [("wysebee-ios-test", "Wysebee Agent for Tests", "iostest_link", ["ios_tap", "ping"], ["ios_toolkit"], True)]
        assert "agent types added for packs: wysebee-ios-test" in caplog.text
        # Admin changes it; the next start leaves it so.
        with create_engine(clean).begin() as conn:
            conn.execute(text("UPDATE agent_types SET name = 'Renamed', enabled = false WHERE id = :i"), {"i": SEED.id})

        async def again() -> list[str]:
            async with c.app.state.db.sessionmaker() as session:
                return await agent_packs.seed(session, c.app.state.agent_packs)

        assert c.portal.call(again) == []
    assert _rows(clean)[0][1] == "Renamed"


def test_the_devices_words_are_the_built_in_packs_before_any_app_is_made(monkeypatch) -> None:
    from apps.cloud import browser_links
    from apps.cloud.packs.android import AndroidPack

    monkeypatch.setattr(agent_packs, "_known", None)
    assert agent_packs.words("android")[browser_links.OFFLINE] == AndroidPack.words[browser_links.OFFLINE]
    assert agent_packs.words("browser") == {} and agent_packs.words(None) == {}
    assert [k for k, _ in agent_packs.kinds_words()] == ["android", "osx"]


def test_the_computer_pack_answers_a_name_it_does_not_have_as_an_error() -> None:
    from apps.cloud.packs.computer import ComputerPack

    out = asyncio.run(ComputerPack().run(ToolContext(None, None, "u", None, {}), "local_gone", {}))  # type: ignore[arg-type]
    assert (out.text, out.is_error) == ("'local_gone' is not one of your tools.", True)
