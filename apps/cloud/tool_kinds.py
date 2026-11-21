"""Which agent may add which tool.

**Each kind of device's tools are its agent type pack's** (apps/cloud/agent_packs.py; since
2026-11-21, when they replaced ``agent_chat/data/tool_kinds.json`` and the website's copy of it):
a pack names its kind's tool kinds (``tool_kinds``), their names (``tool_labels``, and its
switches' labels) and who may have them (``who``…). **Which agents may have each is the agent
types' rows** (2026-11-13, later; apps/cloud/agent_types.py): a type's ``tool_kinds`` lists the
tools only its agents may have, and an agent's type is the type of the link it holds now (none:
a plain agent). A tool no type lists is any agent's. ``GET /api/v1/agent-types`` gives the web
app the same.

:func:`has` says which tools a save of the settings can add (a field it sets): each pack's
switches that name a tool kind — the web development tools; Run any program, Screen control,
Developer access, the Android and iPhone toolkits. Site links and a computer's programs are
tools of their own (apps/cloud/user_tools.py), checked by :func:`may_have` when given. Not
``browser`` (Browser access cannot exist without the link), ``folder`` (a computer's folders
are ``mac_folders``, which only the cloud writes), ``sqlite`` nor ``skill_scripts`` (a tag,
shown and never refused).

A save that **adds** such a tool — the stored settings lacked it, the sent ones have it — to
an agent whose type does not list it is refused (:func:`refusal`, called by
apps/cloud/agents.py on every agent save), in words for the kind of device that has it (its
pack's ``who``). Keeping or removing one is always allowed, so what an agent had before the
rule stays, to change or remove.
"""

from collections.abc import Callable
from typing import Any

from apps.cloud import agent_packs
from apps.cloud.agent_types import AgentType, of_agent

CODE = "wrong_agent_kind"
# The config field naming an agent's link, by the link's kind: the built-in kinds'; with every
# registered pack's, :func:`link_fields`.
LINK_FIELDS = {"browser": "browser_link", "osx": "mac_link", "android": "android_link"}


def link_fields() -> dict[str, str]:
    """The config field naming an agent's link, by the link's kind — every pack's too."""
    return {**LINK_FIELDS, **{p.kind: p.link_field for p in agent_packs.known().packs}}


def has() -> dict[str, Callable[[dict[str, Any]], bool]]:
    """Whether an agent's settings have a tool, by its tool kind: each pack switch's."""
    return {
        s.tool_kind: (lambda config, field=s.field: config.get(field) is True)
        for p in agent_packs.known().packs for s in p.settings if s.tool_kind is not None
    }


def labels() -> dict[str, str]:
    """What the person reads each tool as (English): the packs' tool names and switches."""
    out: dict[str, str] = {}
    for p in agent_packs.known().packs:
        out.update(p.tool_labels)
        out.update({s.tool_kind: s.label for s in p.settings if s.tool_kind is not None})
    return out


def refusal(stored: dict[str, Any] | None, config: dict[str, Any], types: list[AgentType]) -> str | None:
    """Why ``config`` may not be saved over ``stored`` (None: a new agent, or settings that
    could not be read) — the sentence for the first tool it adds that this agent's type may
    not have — or None when it may.

    Since 2026-11-13 (later; the protocols' "agent types are a table") the agent types' rows
    say which agents may have each tool (``tool_kinds``): an agent's type is the type of the
    link it holds now (apps/cloud/agent_types.py ``of_agent``), and a tool some type lists is
    only for agents of a type that lists it. A tool no type lists is any agent's."""
    mine = of_agent(config, types)
    for tool, holds in has().items():
        listing = [t for t in types if tool in t.tool_kinds]
        if listing and mine not in listing and holds(config) and not (stored is not None and holds(stored)):
            return _who(listing).format(tool=labels()[tool])
    return None


def may_have(tool: str, config: dict[str, Any], types: list[AgentType]) -> str | None:
    """Why an agent with these settings may not be given ``tool`` (a tool kind: a site link's,
    or ``local`` for a program — apps/cloud/user_tools.py), or None when it may: as
    :func:`refusal`, a tool some type lists is only for agents of such a type."""
    listing = [t for t in types if tool in t.tool_kinds]
    if listing and of_agent(config, types) not in listing:
        return _who(listing).format(tool=labels()[tool])
    return None


def _who(listing: list[AgentType]) -> str:
    """Who may have a tool only ``listing``'s agents may: in those types' words together
    (a Mac's and a Windows PC's), else the first one's own, else its kind's pack's."""
    registry = agent_packs.known()
    keys = frozenset(t.key for t in listing)
    for pack in registry.packs:
        if keys in pack.who_together:
            return pack.who_together[keys]
    first = listing[0]
    pack = registry.of_kind(first.kind)
    assert pack is not None, f"no pack serves {first.kind!r}"
    return pack.who_by_key.get(first.key) or pack.who
