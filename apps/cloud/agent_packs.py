"""**Agent type packs** (docs/agent-type-packs.md): each kind of device's server side as one
module — its tools, its poll beyond calls, its words, its switches — and the registry the server
builds from the built-in packs (apps/cloud/packs/: the browser's, the phone's, the computers')
and those its extensions bring (apps/cloud/extensions.py, ``Extension.agent_types``), kept as
``app.state.agent_packs`` (and :func:`known`, where no app is at hand). Wysebee Assistant's
toolbox (apps/cloud/agent_chat/toolbox.py), the link module (apps/cloud/browser_links.py),
``tool_kinds`` and ``GET /api/v1/agent-types`` ask the packs; none of them names a kind of
device. For a pack an extension brings:

- **A pack may not take a built-in kind's place**: its key, link kind and link field may be none
  of the built-in ones (:data:`BUILT_IN_KEYS`, :data:`BUILT_IN_KINDS`, :data:`BUILT_IN_LINK_FIELDS`).
- **Its tools are named under a prefix of its own** (``tool_prefix``, e.g. ``ios_``), which may
  neither start nor be started by another pack's or a built-in one (:data:`BUILT_IN_PREFIXES`,
  and the built-in names in :data:`BUILT_IN_NAMES`): Wysebee Assistant addresses a tool by its
  name alone, and some names are the person's own (a Mac's programs), so the prefix is what can
  be checked when the server starts.
- **Its type's row is added when missing** (:func:`seed`, at startup), and its link field is one
  a row may name (apps/cloud/agent_types.py ``link_fields``): its devices pair and are served
  with no change to the core (step 6).

Anything that breaks these is refused **when the app is made** (:func:`build` raises), naming the
pack, rather than misbehaving on a request.
"""

import logging
import re
from collections.abc import Awaitable, Callable, Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud import agent_types
from apps.cloud.models import AgentType as Row

logger = logging.getLogger("wysebee.cloud.agent_packs")

# What the built-in kinds hold, which no pack may take (steps 2-4 make them packs themselves).
BUILT_IN_KEYS = frozenset({agent_types.CHROME, agent_types.OSX, agent_types.WINDOWS, agent_types.LINUX, agent_types.ANDROID})
BUILT_IN_KINDS = frozenset(agent_types.LINK_FIELDS.values())
BUILT_IN_LINK_FIELDS = frozenset(agent_types.LINK_FIELDS)
# The built-in tools' names: by prefix (agent_chat/browser.py, android.py, mac.py's programs,
# pc_dev.py, ios_dev.py, tools.py, mac.py's screen and folder tools) and one by one.
BUILT_IN_PREFIXES = ("browser_", "android_", "local_", "dev_", "adb_", "xcode_", "skill_", "screen_", "folder_")
BUILT_IN_NAMES = frozenset({"run_program", "load_skill", "send_notification"})

KIND = re.compile(r"^[a-z][a-z0-9_]{0,15}$")  # browser_links.kind is 16 characters
LINK_FIELD = re.compile(r"^[a-z][a-z0-9_]{0,59}_link$")
PREFIX = re.compile(r"^[a-z][a-z0-9]{1,15}_$")
UUID_TEXT = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


@dataclass(frozen=True)
class AgentTypeSeed:
    """The ``agent_types`` row a pack's type starts as, added when missing (never changed after:
    Wysebee Admin's from then on). Its limits are the table's (apps/cloud/agent_types.py)."""

    id: str
    name: str
    ops: frozenset[str]
    tool_kinds: frozenset[str] = frozenset()
    description: str = ""
    enabled: bool = True


@dataclass(frozen=True)
class Setting:
    """A switch in an agent's settings that a pack's tools follow (served to the web app,
    ``GET /api/v1/agent-types``): the setting set to true when on, its name (English), the tool
    kind that says which agents may have it (None: any agent of the pack's kind, by its link) —
    so a type is offered it only when its row lists that kind — and what it does."""

    field: str
    label: str
    tool_kind: str | None = None
    description: str = ""

    def out(self) -> dict[str, Any]:
        return {"field": self.field, "label": self.label, "tool_kind": self.tool_kind, "description": self.description}


@dataclass
class ToolContext:
    """What a pack's tools see (asked from step 2): the person, the agent's row and settings, its
    skills, its tools of each kind, its paired link (or None), and ``run_op`` bound to that link."""

    session: AsyncSession
    state: Any
    user_id: str
    agent: Any
    config: dict[str, Any]
    link: Any = None
    skills: list[Any] = field(default_factory=list)
    tools: list[Any] = field(default_factory=list)
    # Runs one op on the link the agent drives (``pack.link_of``): ``run_op(op, args, timeout)``;
    # None when it drives none.
    run_op: Callable[[str, dict[str, Any], float], Awaitable[dict[str, Any]]] | None = None


@dataclass
class LinkContext:
    """What a pack's poll hooks see (asked from step 2): the link's row, its agent and person."""

    session: AsyncSession
    state: Any
    link: Any
    agent: Any = None


class AgentPack:
    """One kind of device's server side. A pack sets the class attributes and overrides the
    hooks it needs; the rest answer "nothing" (no tools, no poll extras)."""

    # --- identity, and the row it needs -------------------------------------------------
    key: str = ""                       # the agent type's key, what a device's /start names
    also_keys: tuple[str, ...] = ()     # other types it serves, of the same kind (Windows', Linux's)
    kind: str = ""                      # the link kind it handles
    link_field: str = ""                # the agent setting holding its link
    tool_prefix: str = ""               # its tools' names start with this...
    more_prefixes: tuple[str, ...] = () # ...or with one of these...
    tool_names: frozenset[str] = frozenset()  # ...or are one of these
    seed: AgentTypeSeed | None = None
    words: dict[str, str] = {}          # its device's own words for the link's sentences

    @property
    def keys(self) -> tuple[str, ...]:
        return (self.key, *self.also_keys)

    @property
    def prefixes(self) -> tuple[str, ...]:
        return (self.tool_prefix, *self.more_prefixes)

    def owns(self, name: str) -> bool:
        """Whether ``name`` is one of its tools' names (by prefix, or one by one)."""
        return name in self.tool_names or name.startswith(self.prefixes)

    # --- the agent's tools -----------------------------------------------------------------
    read_only: frozenset[str] = frozenset()
    # Its tools only while the links table holds the device as this agent's (not only its
    # settings naming it): the phone's, the computers'.
    needs_paired: bool = False
    # The settings a new agent made by pairing one starts with, beside its label.
    new_config: dict[str, Any] = {}
    # Its device runs the agent's skills' scripts (``skill_run_script``; the computers').
    runs_skill_scripts: bool = False

    def device_name(self, config: dict[str, Any]) -> str:
        """What its device is called, to the AI app ("Mac", "Windows PC", …)."""
        return "device"

    def link_of(self, config: dict[str, Any]) -> str:
        """The link an agent with these settings drives ("" for none): its ``link_field``."""
        link = config.get(self.link_field)
        return link.strip() if isinstance(link, str) else ""

    def describe(self, ctx: ToolContext) -> str | None:
        """What Wysebee Assistant tells the AI app about where this agent's tools of this kind
        run (apps/cloud/agent_mcp.py ``instructions``), or None to say nothing."""
        return None

    async def tools(self, ctx: ToolContext) -> list[dict[str, Any]]:
        """The tools of an agent paired with one of these: ``{name, description, input_schema}``."""
        return []

    async def run(self, ctx: ToolContext, name: str, arguments: dict[str, Any]) -> Any:
        """Run one of its tools."""
        raise NotImplementedError(f"{type(self).__name__} offers no tool {name!r}")

    # --- the link, beyond calls ------------------------------------------------------------
    def read_poll(self, status: dict[str, Any]) -> dict[str, Any]:
        """What the device reports in its poll, cleaned; nothing by default."""
        return {}

    async def poll_extra(self, ctx: LinkContext) -> dict[str, Any]:
        """What its poll answer carries besides calls; nothing by default."""
        return {}

    async def apply_poll(self, ctx: LinkContext, said: dict[str, Any]) -> None:
        """Store what it reported; nothing by default."""

    def link_view(self, link: Any) -> dict[str, Any]:
        """What its link adds to how the apps see a link (``Link``); nothing by default."""
        return {}

    def held_settings(self, link: Any) -> dict[str, Any]:
        """The agent settings its link holds (among ``cloud_only_fields``); none by default."""
        return {}

    # Changes that wake its device's poll at once: "agent" (the agent's skills, programs or
    # name changed).
    wakes_on: frozenset[str] = frozenset()
    # Its device downloads the agent's skills' files with its own secret.
    serves_skill_files: bool = False

    def offline_reason(self, link: Any, agent: str, connected: bool) -> str | None:
        """Why an agent that lives in this device cannot answer now, in words to show (the
        Connect AI app tab), or None; none by default."""
        return None

    # --- the agent's settings and tools, as the web app shows them ---------------------------
    cloud_only_fields: frozenset[str] = frozenset()   # settings only the cloud writes; a save keeps them
    settings: Sequence[Setting] = ()                  # the switches the web app draws
    # The tool kinds of its kind (the keys an agent type's ``tool_kinds`` may list), and the
    # names (English) of those that are not a switch.
    tool_kinds: tuple[str, ...] = ()
    tool_labels: dict[str, str] = {}
    # Who may have a tool only its agents may: "Only an agent made by pairing … can have {tool}: …",
    # by type key where a type has its own words, and for several types at once.
    who: str = ""
    who_by_key: dict[str, str] = {}
    who_together: dict[frozenset[str], str] = {}

    def settings_for(self, tool_kinds: Iterable[str]) -> list[Setting]:
        """Its switches for a type whose row lists ``tool_kinds``: those any of its agents has,
        and those whose tool kind the row lists."""
        listed = set(tool_kinds)
        return [s for s in self.settings if s.tool_kind is None or s.tool_kind in listed]


class PackRefused(RuntimeError):
    """A pack that cannot be registered, named, with why."""


@dataclass
class Registry:
    """The packs the server knows: by key and by kind, with what they offer together."""

    packs: list[AgentPack]
    by_key: dict[str, AgentPack]
    by_kind: dict[str, list[AgentPack]]
    read_only: frozenset[str]

    def for_tool(self, name: str) -> AgentPack | None:
        """The pack whose tools a name is one of."""
        return next((p for p in self.packs if p.owns(name)), None)

    def of_kind(self, kind: str | None) -> AgentPack | None:
        """The pack serving links of ``kind``, or None."""
        found = self.by_kind.get(kind or "")
        return found[0] if found else None


def _overlaps(a: str, b: str) -> bool:
    return a.startswith(b) or b.startswith(a)


def _check_seed(pack: AgentPack) -> None:
    s = pack.seed
    if s is None:
        return
    names_ok = all(isinstance(v, str) and agent_types.ITEM.match(v) for v in (*s.ops, *s.tool_kinds))
    if not (
        UUID_TEXT.match(s.id) and s.name.strip() and len(s.name) <= agent_types.NAME_MAX and len(s.description) <= agent_types.DESCRIPTION_MAX
        and len(s.ops) <= agent_types.LIST_MAX and len(s.tool_kinds) <= agent_types.LIST_MAX and names_ok
    ):
        raise PackRefused(f"Agent pack {pack.key!r}: its seed breaks the agent_types table's limits.")


def build(packs: Iterable[AgentPack], built_in: Iterable[AgentPack] = ()) -> Registry:
    """Check the packs — the built-in ones (apps/cloud/packs/), then the extensions' — against
    the built-in kinds and each other; the registry, built-in packs first. Raises
    :class:`PackRefused` on the first that cannot be registered."""
    found: list[AgentPack] = []
    own = list(built_in)
    for pack in [*own, *packs]:
        native = any(pack is b for b in own)
        name = pack.key or type(pack).__name__
        if not all(agent_types.KEY.match(k or "") for k in pack.keys):
            raise PackRefused(f"Agent pack {name!r}: its key must be 'wysebee-' and lowercase letters, digits or '-'.")
        if not KIND.match(pack.kind or "") or not LINK_FIELD.match(pack.link_field or "") or not all(PREFIX.match(p or "") for p in pack.prefixes):
            raise PackRefused(f"Agent pack {name!r}: its kind, link field (…_link) or tool prefix (…_) is not well formed.")
        if not native and (set(pack.keys) & BUILT_IN_KEYS or pack.kind in BUILT_IN_KINDS or pack.link_field in BUILT_IN_LINK_FIELDS):
            raise PackRefused(f"Agent pack {name!r}: its key, kind or link field is a built-in one's.")
        if not native and (pack.tool_names or any(_overlaps(mine, p) for mine in pack.prefixes for p in BUILT_IN_PREFIXES)
                           or any(n.startswith(pack.prefixes) for n in BUILT_IN_NAMES)):
            raise PackRefused(f"Agent pack {name!r}: its tool prefix {pack.tool_prefix!r} overlaps a built-in tool's name.")
        bad_read_only = sorted(n for n in pack.read_only if not pack.owns(n))
        if bad_read_only:
            raise PackRefused(f"Agent pack {name!r}: its read-only tools must start with {pack.tool_prefix!r}: {', '.join(bad_read_only)}.")
        for other in found:
            if set(other.keys) & set(pack.keys):
                raise PackRefused(f"Agent packs: two have the key {pack.key!r}.")
            if other.link_field == pack.link_field and other.kind != pack.kind:
                raise PackRefused(f"Agent packs {other.key!r} and {pack.key!r}: one link field, two kinds.")
            if other.kind == pack.kind and other.link_field != pack.link_field:
                raise PackRefused(f"Agent packs {other.key!r} and {pack.key!r}: one kind, two link fields.")
            if any(_overlaps(a, b) for a in other.prefixes for b in pack.prefixes) or other.tool_names & pack.tool_names:
                raise PackRefused(f"Agent packs {other.key!r} and {pack.key!r}: their tool prefixes overlap.")
            if pack.seed is not None and other.seed is not None and pack.seed.id == other.seed.id:
                raise PackRefused(f"Agent packs {other.key!r} and {pack.key!r}: their seeds share an id.")
        _check_seed(pack)
        found.append(pack)
    by_kind: dict[str, list[AgentPack]] = {}
    for pack in found:
        by_kind.setdefault(pack.kind, []).append(pack)
    registry = Registry(
        packs=found,
        by_key={k: p for p in found for k in p.keys},
        by_kind=by_kind,
        read_only=frozenset().union(*(p.read_only for p in found)),
    )
    _remember(registry)
    return registry


# The registry built last (the built-in packs' before any): what apps/cloud/browser_links.py
# asks where it has no app at hand — the words each kind's device speaks in, which kinds wake.
_known: Registry | None = None


def _remember(registry: Registry) -> None:
    global _known
    _known = registry


def known() -> Registry:
    """The registry built last, or the built-in packs' before any."""
    if _known is None:
        from apps.cloud import packs

        build([], built_in=packs.built_in())
    assert _known is not None
    return _known


def words(kind: str | None) -> dict[str, str]:
    """The sentences a link of ``kind`` is spoken of in (empty: the link module's own)."""
    pack = known().of_kind(kind)
    return dict(pack.words) if pack is not None else {}


def kinds_words() -> list[tuple[str, dict[str, str]]]:
    """Each kind with words of its own, and them."""
    return [(kind, dict(found[0].words)) for kind, found in known().by_kind.items() if found[0].words]


def all_words() -> list[dict[str, str]]:
    """Every kind's words (for sentences said of any link)."""
    return [w for _, w in kinds_words()]


def kinds_waking(change: str) -> list[str]:
    """The link kinds whose devices are woken by ``change`` (``wakes_on``)."""
    return [kind for kind, found in known().by_kind.items() if change in found[0].wakes_on]


async def seed(session: AsyncSession, registry: Registry) -> list[str]:
    """Add each pack's type row when missing (by key or id; an existing row is left as it is,
    Wysebee Admin's); the keys added. Its link field is the link module's to serve as soon as the
    pack is registered (agent_types.link_fields)."""
    added = []
    for pack in registry.packs:
        if pack.seed is None:
            continue
        s = pack.seed
        done = await session.execute(
            insert(Row)
            .values(id=s.id, key=pack.key, name=s.name.strip(), description=s.description, link_field=pack.link_field,
                    ops=sorted(s.ops), tool_kinds=sorted(s.tool_kinds), enabled=s.enabled)
            .on_conflict_do_nothing()
            .returning(Row.key)
        )
        if done.scalar_one_or_none() is not None:
            added.append(pack.key)
    await session.commit()
    if added:
        agent_types.forget()
    return added
