"""Agent type packs, step 6 (docs/agent-type-packs.md): **a kind of device the core has never heard
of, brought by an extension's pack, works end to end with no change to the core** — its type's
row seeded, the web app told its switch, a device of it paired through the protocol, its tool
offered only with the switch on and only to its agents, called through the queue, and spoken of
in its own words when it is gone. The kind ("glasses") is the tests' own. Skipped without
WYSEBEE_TEST_DATABASE_URL."""

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud import agent_types, browser_links
from apps.cloud.agent_chat.tools import Output
from apps.cloud.agent_packs import AgentPack, AgentTypeSeed, Setting, ToolContext
from apps.cloud.extensions import API, Extension
from tests.cloud_agent_fixtures import _agent, _box, _call, _client, _config, _save_config, me  # noqa: F401 — fixtures
from tests.conftest import needs_db
from tests.test_browser_links import AGENT, FAST, Browser, Extension as Device

KEY = "wysebee-glasses-test"
TYPE_ID = "7a000000-0000-4000-8000-0000000000aa"
LENS = "glasses_lens"
LOOK = "glasses_look"


class GlassesPack(AgentPack):
    key = KEY
    kind = "glasses"
    link_field = "glasses_link"
    tool_prefix = "glasses_"
    needs_paired = True
    read_only = frozenset({LOOK})
    seed = AgentTypeSeed(id=TYPE_ID, name="Wysebee Glasses Agent", ops=frozenset({"ping", LOOK}), tool_kinds=frozenset({LENS}))
    settings = (Setting(LENS, "Lens view", LENS, "Lets the agent look through the glasses."),)
    tool_kinds = (LENS,)
    who = "Only an agent made by pairing Wysebee Agent for Glasses can have {tool}: pair the glasses in Wysebee, under Devices."
    words = {browser_links.OFFLINE: "The glasses are not reachable: they are off, or out of range."}

    async def tools(self, ctx: ToolContext) -> list[dict[str, Any]]:
        if ctx.config.get(LENS) is not True:
            return []
        return [{"name": LOOK, "description": "Look through the glasses.", "input_schema": {"type": "object", "properties": {}}}]

    async def run(self, ctx: ToolContext, name: str, arguments: dict[str, Any]) -> Output:
        out = await ctx.run_op(LOOK, arguments, 30.0)
        return Output(json.dumps(out["result"])) if out["ok"] else Output(out["error"], True)

    def describe(self, ctx: ToolContext) -> str | None:
        return f"Its glasses_ tools look through the person's glasses ({ctx.link.browser})."


@pytest.fixture
def client(ui_dist: Path, migrated_db_url: str, tmp_path: Path) -> Iterator[TestClient]:
    c = _client(ui_dist, migrated_db_url, tmp_path, [Extension("glasses", API, agent_types=[GlassesPack()])], browser_link_starts_per_minute=10_000, **FAST)
    yield c
    c.__exit__(None, None, None)
    with create_engine(migrated_db_url).begin() as conn:
        conn.execute(text("DELETE FROM browser_links WHERE user_id IS NULL"))
        conn.execute(text("DELETE FROM browser_links WHERE agent_type_id = :t"), {"t": TYPE_ID})
        conn.execute(text("DELETE FROM agent_types WHERE id = :t"), {"t": TYPE_ID})
    agent_types.forget()


@needs_db
def test_a_new_kind_of_device_works_end_to_end_with_no_change_to_the_core(client: TestClient, me: dict[str, str], migrated_db_url: str) -> None:  # noqa: F811
    # Its type's row, seeded at startup; the web app is told its link and its switch.
    listed = {t["key"]: t for t in client.get("/api/v1/agent-types", headers=me).json()["types"]}[KEY]
    assert (listed["kind"], listed["link_field"], listed["tool_kinds"]) == ("glasses", "glasses_link", [LENS])
    assert listed["settings"] == [{"field": LENS, "label": "Lens view", "tool_kind": LENS, "description": "Lets the agent look through the glasses."}]
    # A pair of glasses pairs as any device does: a new agent, holding the link in its own field.
    g = Device(client, "Specs", kind=KEY, browser="Specs Mk1")
    assert client.post(f"{AGENT}/claim", json={"code": g.code}, headers=me).status_code == 200
    assert g.poll().json()["state"] == "paired"
    config = _config(client, me, "specs")
    assert (config["glasses_link"], config["agent_type_id"], config["paired_kind"]) == (g.id, TYPE_ID, KEY)
    # Its tool only with the switch on, which only its agents may turn on — said in its words.
    assert LOOK not in _box(client, me, "specs").offered
    plain = _agent(client, me, "plain", {})
    refused = client.put(f"/api/v1/agents/{plain}", json={"config": {"label": "plain", LENS: True}}, headers=me)
    assert refused.status_code == 422 and "Wysebee Agent for Glasses can have Lens view" in refused.text
    assert _save_config(client, me, "specs", {**config, LENS: True}).status_code == 200
    box = _box(client, me, "specs")
    assert LOOK in box.offered and box.reads_only(LOOK)
    assert box.notes == ["Its glasses_ tools look through the person's glasses (Specs Mk1)."]
    # Called through the queue, as the glasses answer it.
    with Browser(g, lambda op, args: {"ok": True, "result": {"op": op, "seen": "a desk"}}) as device:
        out = _call(client, me, "specs", LOOK)
    assert [c["op"] for c in device.seen] == [LOOK] and json.loads(out.text) == {"op": LOOK, "seen": "a desk"}
    # Gone quiet: the call is refused in the glasses' own words.
    with create_engine(migrated_db_url).begin() as conn:
        conn.execute(text("UPDATE browser_links SET last_seen = now() - interval '5 minutes' WHERE id = :i"), {"i": g.id})
    out = _call(client, me, "specs", LOOK)
    assert (out.text, out.is_error) == (GlassesPack.words[browser_links.OFFLINE], True)
