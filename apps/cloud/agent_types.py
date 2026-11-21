"""Agent types: which kinds of device can pair, as data (2026-11-13, later, the owner's call;
both device protocols' "agent types are a table").

A device names its type when it starts pairing (``kind``: a type's ``key``); everything after
reads that type's row — the ops its link takes, the agent setting that holds the link, the
tools only its agents may have, and the name shown to people. The table (``agent_types``,
migration 0050) is written by Wysebee Admin; **this service only reads it**, at most
:data:`CACHE_SECONDS` old, so a change takes effect within a minute without a restart.

**A row that breaks the limits is no type** (:func:`parse`): logged, and left out — a device
naming it cannot start pairing, and a link of it takes no op — never a crash.

``GET /api/v1/agent-types`` (signed in) lists them for the apps: enabled ones first, each with
its name, link kind and field, the tools only its agents may have (``tool_kinds``) and the
switches its pack draws (``settings``: ``{field, label, tool_kind, description}``) — not its
``ops``.
"""

import logging
import re
import time
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud.auth import User, current_user
from apps.cloud.models import AgentType as Row

logger = logging.getLogger(__name__)

router = APIRouter()

# The seeded types (migrations 0050, 0051, 0059 and 0079), with the ids every environment shares.
CHROME = "wysebee-browser-chrome"
OSX = "wysebee-osx"
WINDOWS = "wysebee-windows"
LINUX = "wysebee-linux"
ANDROID = "wysebee-android"
CHROME_ID = "6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c01"
OSX_ID = "6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c02"
WINDOWS_ID = "6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c04"
ANDROID_ID = "6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c05"
LINUX_ID = "6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c06"
# What builds made before types send as `kind` (or none: a browser).
LEGACY = {"browser": CHROME, "osx": OSX}
# The agent settings a link can be held in — the built-in kinds' (2026-11-15: `android_link`,
# Wysebee Agent for Android's) — and the `kind` each means, which Link still says for older
# readers. Every agent type pack adds its own (:func:`link_fields`, apps/cloud/agent_packs.py).
LINK_FIELDS = {"browser_link": "browser", "mac_link": "osx", "android_link": "android"}


def link_fields() -> dict[str, str]:
    """Every link field a type's row may name, and the link kind it means: the built-in ones and
    each registered pack's (2026-11-21, docs/agent-type-packs.md step 6)."""
    from apps.cloud import agent_packs

    return {**LINK_FIELDS, **{p.link_field: p.kind for p in agent_packs.known().packs}}

# The table's limits (the protocols' "The table: agent_types").
KEY = re.compile(r"^wysebee-[a-z0-9-]{0,56}$")
NAME_MAX = 60
DESCRIPTION_MAX = 500
LIST_MAX = 100
ITEM = re.compile(r"^[a-z0-9_]{1,64}$")
CACHE_SECONDS = 60.0


@dataclass(frozen=True)
class AgentType:
    id: str
    key: str
    name: str
    description: str
    link_field: str
    ops: frozenset[str]
    tool_kinds: frozenset[str]
    enabled: bool

    @property
    def kind(self) -> str:
        """The link kind (``browser``, ``osx``, ``android`` or a pack's), by where the link is held."""
        return link_fields()[self.link_field]

    def out(self) -> dict[str, str]:
        """As a link names it: ``{id, key, name}``."""
        return {"id": self.id, "key": self.key, "name": self.name}


def _names(value: Any) -> frozenset[str] | None:
    """A JSON array of at most 100 distinct names, each 1-64 of ``a-z0-9_``; else None."""
    if not isinstance(value, list) or len(value) > LIST_MAX or len(set(map(str, value))) != len(value):
        return None
    if not all(isinstance(v, str) and ITEM.match(v) for v in value):
        return None
    return frozenset(value)


def parse(row: Any) -> AgentType | None:
    """The type a row says, or None (logged) when it breaks the table's limits."""
    key, name, description = row.key, row.name, row.description
    ops, kinds = _names(row.ops), _names(row.tool_kinds)
    good = (
        isinstance(key, str) and 3 <= len(key) <= 64 and KEY.match(key) is not None
        and isinstance(name, str) and 1 <= len(name.strip()) and len(name) <= NAME_MAX
        and isinstance(description, str) and len(description) <= DESCRIPTION_MAX
        and row.link_field in link_fields() and ops is not None and kinds is not None
        and isinstance(row.enabled, bool)
    )
    if not good:
        logger.warning("agent type %s is not one: it breaks the table's limits, and is left out", row.id)
        return None
    assert ops is not None and kinds is not None
    return AgentType(str(row.id), key, name.strip(), description, row.link_field, ops, kinds, row.enabled)


_cache: tuple[float, list[AgentType]] | None = None


def forget() -> None:
    """Read the table again at the next use (tests, and after Admin writes in this process)."""
    global _cache
    _cache = None


async def all_types(session: AsyncSession) -> list[AgentType]:
    """Every good type, enabled first then by key; read at most :data:`CACHE_SECONDS` ago."""
    global _cache
    now = time.monotonic()
    if _cache is not None and now - _cache[0] < CACHE_SECONDS:
        return _cache[1]
    rows = (await session.execute(select(Row))).scalars().all()
    types = sorted((t for t in map(parse, rows) if t is not None), key=lambda t: (not t.enabled, t.key))
    _cache = (now, types)
    return types


async def by_id(session: AsyncSession, type_id: Any) -> AgentType | None:
    return next((t for t in await all_types(session) if t.id == str(type_id)), None)


async def for_start(session: AsyncSession, kind: Any) -> AgentType | None:
    """The type a device starting to pair names: an enabled type's key — or, from a build
    made before types, ``osx``, ``browser`` or nothing — else None."""
    key = CHROME if kind is None else LEGACY.get(kind, kind) if isinstance(kind, str) else None
    return next((t for t in await all_types(session) if t.key == key and t.enabled), None)


def of_agent(config: dict[str, Any], types: list[AgentType]) -> AgentType | None:
    """An agent's type: its link's, so only while it holds one — the type its settings name
    (``agent_type_id``, the claim's), whose ``link_field`` is set — else None (a plain agent,
    or one unpaired)."""
    kind = next((t for t in types if t.id == config.get("agent_type_id")), None)
    held = kind is not None and isinstance(config.get(kind.link_field), str) and config[kind.link_field].strip()
    return kind if held else None


@router.get("/v1/agent-types")
async def list_types(request: Request, user: User = Depends(current_user)) -> dict[str, Any]:
    """The types, enabled ones first: for the apps to show names, and to know which tools and
    switches each type's agents may have — the row's ``tool_kinds`` (Wysebee Admin's) and the
    switches of the pack serving it (apps/cloud/agent_packs.py) that the row allows."""
    async with request.app.state.db.sessionmaker() as session:
        types = await all_types(session)
    registry = request.app.state.agent_packs
    out = []
    for t in types:
        pack = registry.by_key.get(t.key) or registry.of_kind(t.kind)
        out.append({
            "id": t.id, "key": t.key, "name": t.name, "description": t.description, "enabled": t.enabled,
            "kind": t.kind, "link_field": t.link_field, "tool_kinds": sorted(t.tool_kinds),
            "settings": [s.out() for s in pack.settings_for(t.tool_kinds)] if pack is not None else [],
        })
    return {"types": out}
