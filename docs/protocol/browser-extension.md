# The Wysebee Agent browser link

How the **Wysebee Agent** browser extension, **Wysebee Cloud** and whatever drives the
browser (Wysebee Desktop, or the cloud's own agent loop) talk. This file is the contract:
the extension, `wysebee-cloud` (`apps/cloud/browser_links.py`) and `wysebee-desktop`
(`crates/wysebee-backend/src/browser_link.rs`) are each built against it. A change here is
a change in all three.

## The owner's decisions (2026-11-11)

- The extension pairs **with Wysebee Cloud only**. Wysebee Desktop drives it *through* the
  cloud; there is no native messaging, no loopback socket and nothing written into any
  browser's folders.
- **The extension shows a code; the person types it in Wysebee** (Desktop or the website),
  signed in.
- The person types an **agent name** in the extension. Pairing creates a new agent under
  it — or, since 2026-11-13, **reconnects** the browser to a browser agent of that name that
  has no browser now, when the person chooses so (below). A name taken otherwise, `wysebee`,
  or a reserved one is refused and the person picks another, with the same code.
- **Only that agent drives that browser.** No other agent (Wysebee included) and no task
  can choose it.
- Agents living in Wysebee Cloud drive it too (the cloud's loop has the browser pack).
- The old extension (Wysebee Browser Probe), its native host and their pairings are
  retired. The extension carries no Wysebee features (no chat, tasks, topics, settings):
  it is only the authority over the browser (per-site approvals, blocked request
  kinds, the agent pointer, the debugger whitelists, recording frames and steps).

- **The cloud's address is fixed when the extension is built** (2026-11-12): the prod
  build talks to `https://app.wysebee.com`, the dev build to the staging cloud
  (`server.js`, written by `scripts/build.mjs`). The person never types a server, and a
  local wysebee-cloud (`http://localhost:8000`) does not pair with the extension. Every
  route below is under that base URL.

## The owner's decision (2026-11-13): a taken name is settled where the code is typed

Until now a name already taken refused the claim and burned the code: the person started
again on the device with another name. Now **the person settles it in Wysebee, with the same
code**, and may **reconnect the device to an agent of the same kind** that has none.

- **The agent remembers its kind**: `CONFIG` gains `paired_kind`, `"browser"` or `"osx"`,
  set by the claim and **kept when the device is unpaired** (unlike `browser_link` /
  `mac_link`). Only the cloud sets it: an agent save keeps the stored value whatever is
  sent. An agent paired before this change gets it from its link at its next save; one
  already unpaired before it has none, and cannot be reconnected.
- **A claim refused for the name keeps the code good** (until it expires): 409
  `name_taken`, 422 `invalid_name`, 422 `reserved`, 409 `too_many` no longer mark the link
  refused. The device keeps showing its code; its poll stays `pending`. (`refused` stays in
  the poll's answers for older clouds; this cloud no longer sends it.)
- **`name_taken` says what is there**: `{"detail", "code": "name_taken", "agent": {"name",
  "label"}, "reconnect": bool}`. `reconnect` is true only when that agent's `paired_kind` is
  this link's kind **and no link holds that agent now**. An agent still paired (another
  browser, another Mac), of the other kind, or with no `paired_kind` cannot be reconnected:
  the person chooses another name.
- **The claim may carry the person's choice**: `"name"` (one line, 1-60, the start's rule):
  the agent is made under that name instead of the device's, its handle and label from it;
  or `"reconnect": true`: the link is given to the existing agent of that handle (the
  device's name, or `name`'s), only when `reconnect` would be true, else the same 409
  `name_taken`. **Reconnected, the agent keeps everything** — its label, chats, settings and
  tools; the claim sets its link field (and, for a Mac, `mac_folders` `[]`) and nothing
  else. The answer is a new claim's: `{"link", "agent": {"name", "label"}}`.
- **Nothing is widened**: only the signed-in owner can claim, so only their own agent can be
  reconnected, and one agent still has at most one link. A Mac starts a reconnected pairing
  as it starts any pairing — nothing allowed: every program and skill waits for **Allow**
  there, and the folders are picked again. A browser still asks before acting on a site not
  trusted.
- **The device needs no change**: it shows the agent its poll's `paired` answer names,
  which may differ from what was typed.
- Wysebee (the website, and Wysebee Desktop where it pairs) asks on `name_taken`:
  **Reconnect** (when `reconnect`) or another name, then claims again with the same code.
  Unpairing no longer says the agent cannot be paired again.

## The owner's decision (2026-11-13, later): agent types are a table

Which kinds of device can pair is **data in Wysebee Cloud, not code**: a table of agent
types, so a new one is registered (later, from a Wysebee Admin page) rather than built in.
A device names its type when it starts pairing; everything after reads that type's row.

### The table: `agent_types`

| Column | Type | |
|---|---|---|
| `id` | uuid, primary key | The type's identity. Never changes, never reused. |
| `key` | text, unique, not null | What a device sends as `kind`: lowercase `a-z0-9-`, 3-64 characters, starting `wysebee-`. Never changes once a device ships with it. |
| `name` | text, not null | Shown to people (Devices, the pairing dialog, Reconnect): 1-60 characters. |
| `description` | text, not null, default `''` | One or two sentences shown where the type is offered; at most 500. |
| `link_field` | text, not null | The agent setting that holds a link of this type: `browser_link` or `mac_link` (the only two the cloud's code knows; a new one needs code). |
| `ops` | jsonb, not null | A JSON array of operation names (strings, each once) a link of this type accepts, e.g. `["ping", "local_run"]`. |
| `tool_kinds` | jsonb, not null | A JSON array of tool kinds (strings, each once) that only agents of this type may have, e.g. `["local", "folder"]`. |
| `enabled` | boolean, not null, default true | False: no new pairing of this type (`/start` refuses it); links already made keep working. |
| `created_at`, `updated_at` | timestamptz | |

**The rows the migrations seed**, with fixed ids so every environment (local, UAT,
production) has the same:

| `id` | `key` | `name` | `link_field` | `ops` | `tool_kinds` |
|---|---|---|---|---|---|
| `6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c01` | `wysebee-browser-chrome` | Wysebee Chrome Agent | `browser_link` | `ping`, `browser_tabs`, `browser_activate`, `browser_snapshot`, `browser_screenshot`, `browser_navigate`, `browser_click`, `browser_type`, `browser_open_tab`, `browser_close_tab`, `browser_scroll`, `browser_drag`, `browser_mouse`, `browser_bookmarks`, `browser_console`, `browser_network`, `browser_network_body`, `browser_evaluate`, `browser_viewport`, `browser_inspect`, `browser_audit`, `browser_performance`, `browser_reload`, `browser_mock` (migration 0081), `browser_record` (migration 0082), `recording_saved` | `browser`, `devtools`, `gmail`, `calendar`, `travel`, `news`, `website` |
| `6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c02` | `wysebee-osx` | Wysebee OSX Agent | `mac_link` | `ping`, `local_run`, `skill_run`, `folder_call`, `program_run`, `screen_screenshot`, `screen_action`, `dev_shell`, `dev_job`, `dev_file`, `android_dev`, `ios_dev` | `local`, `folder`, `sqlite`, `skill_scripts`, `any_program`, `screen`, `developer`, `android_toolkit`, `ios_toolkit` |
| `6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c04` | `wysebee-windows` | Wysebee Windows Agent | `mac_link` | `ping`, `local_run`, `skill_run`, `folder_call`, `program_run`, `screen_screenshot`, `screen_action`, `dev_shell`, `dev_job`, `dev_file`, `android_dev` | `local`, `folder`, `sqlite`, `skill_scripts`, `any_program`, `screen`, `developer`, `android_toolkit` |

`wysebee-windows` (2026-11-13, wysebee-cloud migration 0051) is Wysebee Agent for Windows
(`wysebee-agent-win`), which speaks this protocol as the Mac app does; its links' legacy `kind`
is `osx`, and an agent paired from one is never reconnected from the other.
Since 2026-11-16 (wysebee-cloud migration 0069) it also takes `program_run` and lists
`any_program`: Run any program, where the AI names the program, run on the PC only while the
person has turned it on there; and, since migration 0070, `screen_screenshot`,
`screen_action` and `screen`: Screen control, screenshots and the mouse and keyboard, again
only while the person has turned it on there; and, since migration 0071, Developer access
(`dev_shell`, `dev_job`, `dev_file`, tool kind `developer`) and the Android Development Toolkit
(`android_dev`, tool kind `android_toolkit`), each behind a switch of its own on the PC
([computer.md](computer.md) has them all).
Since 2026-11-17 (migration 0072) `wysebee-osx` takes all of these too, and alone takes
`ios_dev` (tool kind `ios_toolkit`): the iPhone Development Toolkit, Xcode's simulators and
paired iPhones, behind a switch of its own on the Mac ([computer.md](computer.md)).

Planned, not seeded: `wysebee-browser-edge`, "Wysebee Edge Agent", `browser_link`, the
Chrome type's `ops` and `tool_kinds`.

**`ops` and `tool_kinds` are open lists, extended by registering** (an admin edits the row;
no migration). Their limits: each a JSON array of at most 100 distinct strings, each 1-64 of
`a-z0-9_`. The cloud relays any op the link's type lists, to the device, and refuses any
other (422 `invalid_op`); **the device decides what an op does** and refuses one it does not
know, so listing an op the device does not implement only makes calls fail. A tool kind is
the name a tool has in its kind's agent type pack (wysebee-cloud `apps/cloud/packs/`: `tool_kinds`),
which `GET /api/v1/agent-types` serves with each type.
A tool kind no type lists is any agent's.

### What uses it

- **`POST /start`** takes `kind`: an **enabled** type's `key`. Anything else is 422
  `invalid_kind`. For builds made before this change, `"osx"` means `wysebee-osx` and
  `"browser"` (or no `kind`) means `wysebee-browser-chrome`; they are accepted for as long as
  such builds are in use.
- **This app sends `wysebee-osx`. The extension sends `wysebee-browser-chrome`**, in Edge
  too until `wysebee-browser-edge` is registered and an extension sends it (a later change,
  in the extension).
- **The link** (`browser_links`) keeps the type: `agent_type_id` (uuid, a foreign key to
  `agent_types.id`, not null; the migration fills it from the old `kind` column). The old
  `kind` column stays, holding `browser` or `osx`, until no reader needs it.
- **`Link`** gains `"agent_type": {"id", "key", "name"}`. `"kind"` stays, `"browser"` or
  `"osx"` (by `link_field`: `browser_link` -> `browser`, `mac_link` -> `osx`), for Wysebee
  Desktop builds made before this change; new code reads `agent_type`.
- **The agent's settings**: the claim sets `agent_type_id` (the type's id) and `paired_kind`
  (now the type's `key`, e.g. `wysebee-osx`; the migration turns `browser` into
  `wysebee-browser-chrome` and `osx` into `wysebee-osx` in every agent's `CONFIG`). Both are
  the cloud's only, kept when unpaired, as `paired_kind` was. **Reconnect** needs the same
  `key`: an agent paired from Chrome is not reconnected from Edge.
- **Which agent may add which tool**: an agent's type is the type of the link it has now
  (none: a plain agent). A save that adds a tool whose kind some type lists, to an agent
  whose type does not list it, is refused (422 `wrong_agent_kind`, as before).
  the agent type packs keep the tools' kinds (wysebee-cloud `apps/cloud/packs/`); the types' rows say which agents may have each.
- **The poll** sends a Mac's programs, skills and folders when the link's `link_field` is
  `mac_link` (code, not data: a new kind of device that needs more is a code change).
- **`GET /api/v1/agent-types`** (signed in): `{"types": [{"id", "key", "name",
  "description", "enabled"}]}`, enabled ones first, for the website and Wysebee Desktop to
  show names. Not `ops` or `tool_kinds`.
- **Registering** is for Wysebee Admin (it writes the database directly, as it does the
  other tables); this service has no route that changes the table. The cloud reads the rows
  at each use, or caches them for at most 60 s, so a change takes effect within a minute
  without a restart.

## Who is who

- **Link**: one paired extension (one browser profile). Row `browser_links` in the cloud.
- **Extension secret**: 32 random bytes, base64url, made by the extension and kept in
  `chrome.storage.local`. The cloud keeps only its SHA-256 (hex). The extension sends it as
  `Authorization: Bearer <secret>` on its own routes (TLS). Never shown, never typed.
- **Pairing code**: 8 characters of `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, shown as
  `XXXX-XXXX`, valid 10 minutes, usable once. Typed in Wysebee with or without the dash,
  any case.
- **Driver**: a signed-in client of the account that owns the link (the desktop's own
  Auth0 application, the website's, or the cloud's agent loop in process).

All routes are under `/api/v1/browser-links`. JSON in and out. Errors are
`{"detail": "<English sentence>", "code": "<code>"}`.

## Pairing

1. **Extension** `POST /start` (no auth)
   `{"kind": "wysebee-browser-chrome", "name": "<what the person typed: one line, 1-60 chars>", "secret_hash": "<64 hex>",
   "browser": "Chrome"|"Edge"|..., "extension_version": "x.y.z"}`
   -> `200 {"id": "<32 hex>", "code": "ABCDEFGH", "expires_in": 600}`.
   422 for a bad name or hash, or a `kind` that is no enabled agent type (`invalid_kind`).
   `kind` is the agent type's key (the 2026-11-13 decision above); builds made before it send
   none, which means `wysebee-browser-chrome`.
   429 `too_many_starts` when this address started 10 in the last minute, or **already holds 10
   codes nobody has typed yet** (2026-11-18: `/start` needs no sign-in, so a few addresses must
   not fill the table of waiting codes for everyone; the cloud keeps only the address's SHA-256,
   and only until the code is claimed). 503 `busy` when 2,000 codes wait in all.
2. **Extension** polls (below) and shows the code meanwhile.
3. **Wysebee** `POST /claim` (user auth) `{"code": "abcd-efgh", "home": "<install id>" |
   "cloud", "home_name": "<computer name>" | omitted}`
   -> `200 {"link": <Link>, "agent": {"name": "<handle>", "label": "<typed name>"}}`.
   The cloud derives the handle from the typed name (lowercase; every run of characters
   other than `a-z0-9` becomes `-`; trimmed of `-`; at most 30; must start with a letter),
   then creates the `agent` cloud item: `CONFIG` = `{"label", "browser_access": true,
   "browser_link": "<link id>", "home", "home_name"}` (`home` "cloud" gets `home_name`
   "Wysebee Cloud"; omitted `home` means "cloud").
   Refusals: 404 `code_unknown` (wrong, used or expired), 422 `invalid_name` (no handle can
   be made), 422 `reserved` (`pairing`, `camera`), 409 `name_taken` (an agent has that
   handle, or it is `wysebee`), 409 `too_many` (20 agents already), 429 `too_many_tries`
   (10 wrong codes in 10 minutes for this account). Since 2026-11-13 a refusal for the name
   (`invalid_name`, `reserved`, `name_taken`, `too_many`) keeps the code good, `name_taken`
   says whether the agent can be reconnected, and the claim may carry `name` or
   `"reconnect": true` (the decision above). `CONFIG` also gets `"paired_kind": "browser"`.
4. The extension's next poll answers `paired`.

`Link` = `{"id", "agent": "<handle>", "label", "browser", "extension_version",
"status": "connected"|"offline", "paused": bool, "last_seen": iso|null, "created_at": iso}`.
`connected` = polled within the last 45 s.

## The extension's poll

`POST /{id}/poll?wait=20` (extension auth), body
`{"status": {"paused": bool, "extension_version": "x.y.z", "browser": "Chrome"}}`.
**`paused` is `true` only on the last poll before the extension stops polling** (2026-11-14):
the person turned its **Enabled** switch off. It stays paired but polls no more until it is
switched back on, whose first poll sends `false` again. The cloud keeps the flag on the `Link`,
so the agent reads as offline because it was switched off rather than because the browser is
closed; a call handed out on that last poll is answered as refused. (From 2026-11-12 to
2026-11-14 it was always `false`: the earlier "Let Wysebee use this browser" switch, which
kept polling and refused every call, was removed.)
`wait` is 0-25 seconds (an MV3 worker is killed when a fetch takes 30 s).

- `{"state": "pending", "expires_in": n}` - not claimed yet (answered when claimed, or
  after `wait`).
- `{"state": "refused", "reason": "name_taken"|"reserved"|"too_many"|"invalid_name",
  "message": "<English>"}` - the claim was refused; start again with another name.
- `{"state": "paired", "agent": {"name", "label"}, "calls": [{"id", "op", "args"}],
  "cancelled": ["<call id>", ...]}` - answered at once when calls wait, else after `wait`.
  A call is handed out once.
- 401 `{"code": "unpaired"}` - unknown link or wrong secret (unpaired in Wysebee, or the
  agent was deleted): the extension forgets the pairing.
- 410 `{"code": "expired"}` - the code ran out before anyone typed it.

**Results**: `POST /{id}/calls/{call_id}/result` (extension auth)
`{"ok": true, "result": <any>}` or `{"ok": false, "error": "<English>"}` -> 204. At most
16 MB. A result for a call that is gone (cancelled, expired) is 404 and is dropped.

**Unpair from the extension**: `DELETE /{id}` (extension auth) -> 204. The agent stays,
without a browser.

## Driving the browser

`op` and `args` are exactly the old link's `BROWSER_OPS` requests, and `result` exactly
what its `res` frame carried, so the tools above it did not change:

`ping`, `browser_tabs`, `browser_activate`, `browser_snapshot`, `browser_screenshot`,
`browser_navigate`, `browser_click`, `browser_type`, `browser_open_tab`,
`browser_close_tab`, `browser_scroll`, `browser_drag`, `browser_mouse`,
`browser_bookmarks`, `browser_console`, `browser_network`, `browser_network_body`,
`browser_evaluate`, `browser_viewport`, `browser_inspect`, `browser_audit`,
`browser_performance`, `browser_reload`, `browser_mock`, `browser_record`, `recording_saved`.

`browser_mock` (2026-11-19, migration 0081; a web development tool, `devtools` kind) fakes
network responses on a tab through the Chrome DevTools Fetch domain, for testing how the app
being developed handles errors. Args `{tab_id?, clear?, rules?}`: `clear` drops the tab's
rules first (with no `rules`, it just stops faking); `rules` (at most 50 a tab, checked whole
— one wrong and none is added) are each `{url, method?, resource_type?, times?, delay_ms?}`
plus one of `status` (100-599, with `headers?` and `body?` — a string, or JSON sent as
`application/json`, at most 1,000,000 characters; Set-Cookie, CSP, HSTS and
Access-Control-Allow-Credentials refused), `error` (a `Network.ErrorReason`: Failed,
Aborted, TimedOut, AccessDenied, ConnectionClosed, ConnectionReset, ConnectionRefused,
ConnectionAborted, ConnectionFailed, NameNotResolved, InternetDisconnected,
AddressUnreachable, BlockedByClient, BlockedByResponse) or `delay_ms` alone (0-30000; the
real request, held back). `url` is a glob (`*` any run, `?` one character) starting with
`http:`, `https:` or `*`; `resource_type` is XHR, Fetch, Script, Stylesheet, Image, Media,
Font, EventSource, WebSocket, Manifest or Other — never Document: whole pages are never
faked. The first matching rule with uses left wins. No args lists the active rules. Result
`{tab_id, origin, rules: [... each with hits], note}`. Rules end when the tab goes to another
site, the agent is paused, or after about ten minutes without a developer-tool call. The
extension's `mock.js` (`checkRule`) is the authority on the rules, and its `policy.js` asks
the person every time unless the site is set to "Allow everything".

`browser_record` (2026-11-19, migration 0082; a plain `browser` tool, every agent with a
browser has it) films a tab as a video of a scenario: the agent starts it right before the
scenario and stops it right after, with a descriptive name. Args `{action: "start" | "stop"
| "status" (default status), name? (at most 120 characters, default "scenario"), tab_id?}`.

- `start` -> `{recording: true, tab_id, name, started_at, elapsed_ms, frames, note}`. The
  person is asked unless the site is trusted. One recording a tab, at most 3 at once.
- `stop` (never asks; with no `tab_id` it stops the only recording, else the active tab's)
  -> `{tab_id, name, ended, file: "Downloads/Wysebee Agent/<name>-<yyyymmdd-hhmmss>.webm" |
  null, bytes, duration_ms, frames, upload: "uploading" | "off" | "not paired"}`. `ended` is
  `stopped`, or why it ended by itself: `idle`, `time_limit`, `paused`, `detached`,
  `tab_closed`.
- `status` -> `{recordings: [...the running ones], recent: [{name, file, upload:
  "uploading" | "uploaded" | "failed: ..." | "off" | "not paired", recording_id?}]}`.

A recording ends by itself after 15 minutes in all, 5 minutes after the agent's last action on
the tab, or when the tab closes, the agent is paused or the debugging bar is cancelled; what
was filmed until then is still saved. **The video never travels in a call's result**: the
extension saves it to Downloads and, when paired and the person has turned on "Also upload
each video to Wysebee" (`uploadRecordings`, off by default; "off" otherwise), uploads it
itself (below).

(`configure` and `shutdown` are gone: the extension follows the browser's language and the
computer's look, and there is no host to stop. `record: true` in the args still asks for a
`frame` and a `step` beside the result.)

- `POST /{id}/calls?wait=25` (user auth; the link must be the account's)
  `{"op", "args": {...}, "timeout_seconds": 5-240 (default 60)}`
  -> `{"id", "status": "waiting"|"running"|"done"|"failed", "ok": bool?, "result"?,
  "error"?}`. Answers when done, or after `wait` with the status so far.
- `GET /calls/{call_id}?wait=25` (user auth) - the same answer; ask until `done`/`failed`.
  A finished call's row is deleted once read (and an hour after it was made regardless).
- `POST /calls/{call_id}/cancel` (user auth) -> 204; the extension is told on its next poll.
- Refused at once: 404 `browser_unpaired` (no such link for this account), 409
  `browser_offline` (not polled within 45 s: the browser is closed, or the extension is
  off). Not taken by the extension within 20 s -> `failed`, `error` saying the browser
  could not be reached. Not answered within `timeout_seconds` -> `failed` (it may have been
  waiting for the person's approval in the browser).

### Recordings

- `POST /{id}/recordings?name=&started_at=<ISO>&duration_ms=<int>&origin=<optional>&call_id=<optional>`
  (extension auth: `Authorization: Bearer <secret>`, as `/poll`) — the raw WebM as the body,
  `Content-Type: video/webm`, at most `WYSEBEE_RECORDING_MAX_BYTES` (500 MiB by default).
  `call_id` is the call that stopped it (absent when it ended by itself). -> 201 the
  recording, `{"id", "name", "agent_id", "link_id", "started_at", "duration_ms", "origin",
  "call_id", "size", "content_type", "created_at"}`; the extension reads `id`, and takes any
  other status as a failed upload. Refused: 401 `unpaired`; 409 `not_claimed` (no account
  yet); 422 `invalid_op` (the link's type does not list `browser_record`); 409
  `too_many_recordings` (a person keeps at most `WYSEBEE_RECORDING_MAX_COUNT`, 500 by
  default); 413 `too_big`; 415 `not_webm`; 422 `empty_recording`; 422 `invalid_recording` (a
  query field: `name` over 120 characters, `started_at` not a date, `duration_ms` not 0 to a
  day, `origin` over 255 characters, `call_id` not an id).
- `GET /api/v1/browser-recordings?agent_id=&limit=` (user auth) -> `{"recordings": [...]}`,
  the account's, newest first (`limit` 1-500, default 100).
- `GET /api/v1/browser-recordings/{rid}` (user auth) -> one; 404 `recording_gone`.
- `GET /api/v1/browser-recordings/{rid}/video` (user auth) -> the WebM, streamed
  (`video/webm`, `Accept-Ranges: bytes`); one `Range: bytes=a-b` / `a-` / `-n` gets 206 with
  `Content-Range`, a range past the end 416.
- `DELETE /api/v1/browser-recordings/{rid}` (user auth) -> 204, the video and its row.

The video is kept in its own store (Azure Blob container `browser-recordings` in production,
`<user id>/<recording id>.webm`; a folder locally), its row in `browser_recordings`. A
recording outlives its link (unpairing keeps it) and its agent (`agent_id` cleared); it
counts towards the person's storage (`recordings` in `GET /storage`) and is deleted with
their account.

## Managing links (user auth)

- `GET /` -> `{"links": [Link, ...]}` (paired ones of this account).
- `POST /{id}/unpair` -> 204. Deletes the link (the extension's next poll is a 401) and
  removes `browser_link` from its agent. Deleting the agent deletes its link too.

## The agent's settings

- `browser_link` (shared, not per-computer): the link id. **Set only by the claim**; an
  agent save keeps the stored value whatever a page sends. Absent = the agent has no
  browser, and there is no way to give it one but pairing an extension (a new agent, or,
  since 2026-11-13, the same agent reconnected).
- `paired_kind` (`"browser"`): set by the claim, kept when unpaired, only by the cloud.
- `browser_access` (`false` turns the browser tools off for a paired agent),
  `browser_devtools` (`true` adds the web development tools) as before.
- The old per-computer `browser` field (a probe's machine name) is retired.

## Keeping the link up (MV3)

The worker runs a loop of 20 s long-polls, touching an extension API between polls so the
idle timer never reaches 30 s. A `chrome.alarms` alarm every 30 s, `onStartup`,
`onInstalled` and opening the extension's page each restart the loop if the worker was
killed. A failed poll (offline, cloud down) backs off 2 s, 5 s, 15 s, then 30 s.

## What the cloud sees

Every call's arguments and result (page snapshots, screenshots) pass through Wysebee Cloud
and are kept until read, an hour at most. The extension's per-site approvals
and blocked request kinds are enforced in the extension, before anything is read.
