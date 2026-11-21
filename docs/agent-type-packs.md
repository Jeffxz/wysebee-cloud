# Design: agent type packs

**Status:** built, steps 1–6 (2026-11-21): `apps/cloud/agent_packs.py`, `extensions.API = 2`; the browser's, the phone's and the computers' packs, `apps/cloud/packs/`; settings served by `GET /api/v1/agent-types`; a new kind proven end to end (`tests/test_new_agent_kind.py`).
**Builds on:** extensions (`apps/cloud/extensions.py`, README "Extensions").
**Contracts it must keep:** the agent link protocols in [protocol/](protocol/README.md).

## Problem

Adding a new kind of device — the next one is likely iOS — means changing the server in many
places, because what each kind of agent does is written into shared modules:

| Where | What is written per kind today |
|---|---|
| `agent_types` table (migrations 0050, 0051, 0059, 0079) | The type's row: key, name, `link_field`, `ops`, `tool_kinds`. **Already data**, read every minute. |
| `apps/cloud/browser_links.py` (~1,300 lines) | About 30 branches on `link.kind` (`browser`, `osx`, `android`): what a Mac's poll carries (approved programs, approved skills, folders) and is answered (programs, skills); the skill-file download (Mac only); waking a Mac when its agent's programs or skills change; `paired_browser` / `paired_mac` / `paired_android`; the device's own words for errors (`MAC`, `PHONE`). |
| `apps/cloud/agent_chat/toolbox.py` | Imports each pack (`browser`, `mac`, `pc_dev`, `ios_dev`, `android`) and branches to build an agent's tools; `Where` has a field per kind (`in_browser`, `on_mac`, `on_phone`); `READ_ONLY` joins each pack's set by hand. |
| `apps/cloud/tool_kinds.py` | `LINK_FIELDS` (kind → config field), `WHO` / `WHO_TYPE(S)` (how a refusal names the device). |
| `apps/cloud/agents.py` / `browser_links.keep_link` | Which agent settings only the cloud writes (`browser_link`, `mac_link`, `android_link`, `mac_folders`). |
| `apps/cloud/browser_recordings.py` | Recordings: the browser's only. |
| `agent_chat/data/tool_kinds.json` = `ui/.../AgentsView/toolKinds.json` | The tool kinds, kept in step by hand. |
| The web app | A settings screen per kind. |

The device protocol itself (start, claim, offers, poll, calls, results, unpair) is already the
same for every kind; only what rides on it differs.

## Goal

A kind of agent is **one module** — a *pack* — that the core asks for everything specific to it.
Adding a kind is a new pack (plus its device app); no core module changes. A pack may live in
this repository (the built-in ones, open source like their agents) or in a package loaded
through `WYSEBEE_EXTENSIONS` (a private or partner device), exactly as the plans are.

**Not goals:** changing any protocol (every shipped device keeps working, byte for byte);
letting a pack change the core's protocol steps (pairing, the queue, wake-ups, unpairing, plan
checks); per-pack web app code (the web app draws what the server describes).

## Design

### The interface

An `Extension` gains `agent_types: Sequence[AgentPack]`. The built-in packs are registered as a
built-in extension the server always loads first, so they go through the same path as any other.

```python
class AgentPack:
    # --- identity, and the row it needs -------------------------------------------------
    key: str                      # the agent type's key, e.g. "wysebee-ios"; also what a device's /start names
    also_keys: tuple[str, ...]    # other types of the same kind it serves (the computer's: Windows, Linux)
    kind: str                     # the link kind it handles ("browser", "osx", "android", …)
    link_field: str               # the agent setting holding its link ("ios_link")
    tool_prefix: str              # its tools' names start with this ("ios_")…
    more_prefixes: tuple          # …or one of these (built-in packs only: the computer's six)…
    tool_names: frozenset         # …or are one of these (built-in packs only: run_program, skill_run_script)
    seed: AgentTypeSeed | None    # the agent_types row to add when missing (id, name, ops, tool_kinds);
                                  # Wysebee Admin may change it after, as today
    words: dict[str, str]         # its device's own words for the link's sentences (offline, not reached, …)
    needs_paired: bool            # its tools only while the links table holds the device as this agent's
    new_config: dict              # the settings a new agent made by pairing one starts with

    # --- the agent's tools ----------------------------------------------------------------
    def link_of(self, config) -> str                                  # the link it drives ("" none); the browser's honours Browser access
    def describe(self, ctx) -> str | None                             # its sentence in Wysebee Assistant's instructions
    async def tools(self, ctx: ToolContext) -> list[ToolDef]          # for an agent paired with one of these
    async def run(self, ctx: ToolContext, call: ToolCall) -> Output   # runs one of them (over ctx.run_op)
    read_only: frozenset[str]                                         # its tools that change nothing

    # --- the link, beyond calls (optional) ------------------------------------------------
    def read_poll(self, status: dict) -> dict | Refusal          # what the device reports, cleaned (e.g. approved programs)
    async def poll_extra(self, ctx: LinkContext) -> dict          # what its poll answer carries besides calls
    async def apply_poll(self, ctx: LinkContext, said: dict)      # store what it reported (onto the link, the agent's settings)
    def link_view(self, link) -> dict                             # what its link adds to `Link` (approved, folders)
    def held_settings(self, link) -> dict                         # the agent settings its link holds (mac_folders)
    wakes_on: frozenset[str]                                      # changes that wake its device: "agent"
    serves_skill_files: bool                                      # its device downloads the agent's skill files
    runs_skill_scripts: bool; def device_name(config) -> str      # it runs skill scripts, on a device called this

    # --- the agent's settings -------------------------------------------------------------
    cloud_only_fields: frozenset[str]   # settings only the cloud writes (e.g. "mac_folders"); a save keeps them
    settings: tuple[Setting]            # its switches: field, label, tool_kind (None: any agent of its kind), description
    tool_kinds: tuple[str]              # its kind's tool kinds (what a type's row may list)
    tool_labels: dict[str, str]         # the names of those that are not a switch
    who / who_by_key / who_together     # "Only an agent made by pairing … can have {tool}: …"
    def offline_reason(link, agent, connected) -> str | None   # the Connect AI app tab's "offline" line
```

`ToolContext` carries what the toolbox has today: the session, the person, the agent's row and
settings, its skills, its tools of each kind, its paired link (or None), and `run_op` bound to
that link. `LinkContext` carries the session, the link row, its agent and the person.

Everything is optional except identity and `tools`/`run`: the browser pack has no poll extras;
Android has neither poll extras nor files.

### The registry

`apps/cloud/agent_packs.py` builds a registry at startup from the loaded extensions:

- by `key` (what `/start` names) and by `kind` (what a link row holds);
- **refuses to start** when a pack takes a built-in kind's key, kind or link field, when two packs
  claim the same key, or one link field for two kinds, or when **tool prefixes overlap** — each
  other's or a built-in one (`browser_`, `android_`, `local_`, `dev_`, `adb_`, `xcode_`,
  `skill_`, `screen_`, `folder_`, and `run_program`, `load_skill`, `send_notification`). Tool
  names are global (Wysebee Assistant addresses a tool by name), and some are the person's own
  (a Mac's programs), so a prefix per pack is what can be checked at startup;
- seeds missing `agent_types` rows from `seed` (insert only; an existing row is Admin's) — **only
  once the link module can serve the pack's link field**, so a device never pairs with nothing to
  serve it (until steps 2–4, a pack is logged as registered, its devices not served);
- `READ_ONLY` becomes the union of every pack's `read_only`.

A link whose kind has no pack loaded is treated as a type that is no type today: it cannot
start pairing and takes no op, and is never a crash.

### What moves where

| Today | After |
|---|---|
| `browser_links.py` branches on `OSX` / `ANDROID` / `BROWSER` | `registry.by_kind(link.kind)` and the pack's hooks; the core keeps the protocol steps only |
| `paired_browser` / `paired_mac` / `paired_android` | one `paired(session, user_id, config, pack)` |
| `_said` with `MAC` / `PHONE` | `pack.words` |
| `toolbox.py` imports and branches; `Where` per kind | `for pack in registry: if paired: defs += await pack.tools(ctx)`; `run` dispatches by tool name to its pack |
| `tool_kinds.LINK_FIELDS`, `WHO*` | from the registry (`link_field`, `words`) |
| `keep_link`'s list of cloud-only fields | the union of `link_field`s and `cloud_only_fields` |
| `agent_chat/browser.py`, `mac.py` + `pc_dev.py` + `ios_dev.py`, `android.py` | `apps/cloud/agent_packs/browser.py`, `computer.py` (Mac, Windows, Linux: one kind, `osx`, as today), `android.py` |
| Recordings (`browser_recordings.py`) | stays core, offered to a pack whose type lists `browser_record` (only the browser today) |
| `tool_kinds.json` × 2 | the server's `GET /api/v1/agent-types` serves each kind's settings fields; the web app's copy goes |
| Per-type migrations (0051, 0059, 0079) | `seed`; the existing rows are already there and kept |

### The web app

`GET /api/v1/agent-types` adds, per type, the `settings` its pack describes: each a switch,
a text field or a list, with its label (in the five languages, from the pack), a description,
and the tool kind it gives. The agent's settings screen draws them; the special screens that
exist today (a Mac's programs, folders and skills) stay as they are for those kinds, keyed by
the type, until each is described the same way. A new kind needs no web app release.

### Versioning

`extensions.API` goes from 1 to 2 (the new `agent_types` field). An extension built for
version 1 bumps to match: one line. Packs share the extension's version.

## Plan

Each step is its own pull request; each leaves every test passing and every device working.

1. **Registry and interface, with nothing moved.** `agent_packs.py`, the interface, the checks
   at startup, `API = 2`. Tests with a fake pack. **Done** (`tests/test_agent_packs.py`).
2. **The browser pack.** The simplest: tools, words, no poll extras. Its branches in
   `browser_links.py` and `toolbox.py` go. **Done**: `apps/cloud/packs/browser.py` wraps
   `agent_chat/browser.py`; the toolbox asks every pack (in the browser's old place, so the
   tools' order is unchanged) and dispatches a tool to the pack that offered it; Wysebee
   Assistant's instructions take each pack's `describe`; built-in packs are registered first and
   exempt from the "not a built-in kind" check. Left for later: `browser_links.offline_reason`
   (the Connect AI app tab's "offline" line) still speaks of a browser only, and the device's own
   words (`words`) are still `browser_links.MAC` / `PHONE` until steps 3–4.
3. **The Android pack.** Same shape as the browser's. **Done**: `apps/cloud/packs/android.py`
   wraps `agent_chat/android.py`; the phone's words moved from `browser_links.PHONE` into the
   pack, and the link module asks each kind's pack for its words (`agent_packs.words`), also in
   the "not reached" sentence of a call nobody took; a new agent's first settings come from its
   pack (`new_config`: the browser's Browser access); `needs_paired` keeps the phone's tools to
   the agent the links table names. The Mac's words (`browser_links.MAC`) wait for step 4.
4. **The computer pack** (Mac, Windows, Linux). The big one: poll extras (programs, skills,
   folders), skill files, wake-ups, `mac_folders`, the switches (`pc_dev`, `ios_dev`). **Done**:
   `apps/cloud/packs/computer.py` (one pack for the three types, `also_keys`); `browser_links.MAC`
   moved into it; the poll, `Link`, `keep_link`, `wake_for_agent` and the skill-file download ask
   the pack of the link's kind; the toolbox has no device branches left, and offers every pack's
   tools before the SQL tools (so a SQL tool can no longer take a device tool's name). Left: the
   link module's protocol helpers (`_approved`, `_folders`, `_programs`, `_skills`) stay there,
   called by the pack; `tool_kinds.LINK_FIELDS` / `WHO` and `offline_reason` (browser only) go
   with step 5.
5. **Settings from the server.** `agent-types` serves the fields; the web app draws them; the
   duplicated `tool_kinds.json` goes. **Done**: `GET /api/v1/agent-types` gives each type its
   `kind`, `link_field`, `tool_kinds` (the row's) and `settings` (its pack's switches the row
   allows: so no screen on Linux, the iPhone toolkit on a Mac alone, as Admin's rows say);
   `tool_kinds.py`'s tables (`has`, `labels`, who may have a tool), `tool_drafts.switches()` and
   `browser_links.offline_reason` come from the packs; both `tool_kinds.json` copies are gone
   (they had drifted: the web app's lacked `android`); the web app reads the types. Left for step
   6: `agent_types.LINK_FIELDS` / `tool_kinds.LINK_FIELDS` still list the three link fields the
   table accepts, so a new kind's link field must be added there too (or read from the packs).
6. **The first new kind as a pack** (e.g. iOS), to prove it needs no core change. **Done**: the
   last hard-coded list, the link fields a type's row may name, now takes every registered pack's
   (`agent_types.link_fields`, `tool_kinds.link_fields`), so a pack's type row is seeded as soon
   as it is registered (step 1's "not served yet" holdback is gone). No real new device was
   added (the iOS app is not in the product); `tests/test_new_agent_kind.py` brings a "glasses"
   kind in an extension and shows it seeded, listed with its switch, paired through the
   protocol, its tool offered only with the switch on and only to its agents, called through the
   queue, and refused in its own words when offline — with no core change.

## Adding a kind of device

1. Write its protocol in [protocol/](protocol/README.md) (what its poll carries beyond calls, its ops).
2. Write its pack: identity (`key`, `kind`, `link_field`, `tool_prefix`), `seed`, its tools and
   `run`, `read_only`, `words`, `describe`; if it needs them: `needs_paired`, `new_config`, poll
   hooks, `link_view`, `held_settings`, `wakes_on`, `serves_skill_files`, `runs_skill_scripts`,
   `offline_reason`; for the web app: `settings`, `tool_kinds`, `tool_labels`, `who`.
3. Register it: in `apps/cloud/packs/__init__.py` (open source, like the agents), or in an
   extension's `agent_types` (`WYSEBEE_EXTENSIONS`) for a private one.
4. Its type's row is added at the next start; Wysebee Admin may change or disable it after.

Steps 2–4 are pure moves: the existing tests (`test_browser_links.py`, `test_cloud_agent_*.py`,
`test_agent_mcp.py`) must pass unchanged, which is what shows the protocol is unchanged.

## Risks

- **Protocol drift.** A pack could answer a poll differently from what a shipped device
  expects. Mitigation: steps 2–4 change no test of the protocol; each protocol change goes
  through [protocol/](protocol/README.md) first, in the same pull request.
- **Tool name clashes** between packs from different extensions: refused at startup.
- **Ordering.** Wake-ups and poll extras today run inside the poll's transaction; the hooks must
  run there too (they get the session), never after the commit.
- **Performance.** A poll asks one pack (its link's kind), not all; the toolbox asks only the
  pack of the agent's paired link, as today.
- **Private packs and the AGPL.** A pack outside this repository talks to the server only
  through this interface, the same boundary as the plans package.

## Open questions

- Should a pack own its own tables and migrations (it can, through the extension), or should
  per-kind state stay on `browser_links` columns (`approved`, `approved_skills`, `folders`) as
  today? Proposed: keep today's columns for the built-in packs; new packs use their own tables.
- Should Wysebee Admin be able to turn a pack's type off (it can today, `enabled`) — and should a
  type with no pack loaded show in Admin as such?
- Rename `browser_links` (table and module) to `agent_links`, now that it serves every kind? The
  routes already answer at both `/browser-links` and `/agent-links`. Proposed: later, separately.
