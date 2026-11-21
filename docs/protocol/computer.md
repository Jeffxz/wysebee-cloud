# The Wysebee Agent link for a Mac (and Windows and Linux)

How **Wysebee Agent for Mac** (`wysebee-agent-osx`; Windows' `wysebee-agent-win` and Linux's
`wysebee-agent-linux` speak it too, as the sections below say — "this app" is any of them), **Wysebee Cloud** (`wysebee-cloud`,
`apps/cloud/browser_links.py`) and whatever runs the agent's chat (Wysebee Desktop's
`local_programs.rs` over `browser_link.rs`, or, for an agent living in Wysebee Cloud, the
cloud's own loop, `apps/cloud/agent_chat`, over `browser_links.run_op`) talk. This file is the contract; a change here
is a change in all three. It is the browser extension's link
([browser-extension.md](browser-extension.md)) with a second **kind** of link: read
that file first; only the differences are written here.

## The owner's decisions (2026-11-12)

- Wysebee Desktop is to be listed on the Mac App Store, so it runs sandboxed and **no
  longer starts programs itself**. "Run local program" tools run through this app, which is
  distributed outside the store (Developer ID) and is not sandboxed.
- The app **pairs with Wysebee Cloud only**, as the extension does: the person types an
  agent name in it, it shows a code, the person types the code in Wysebee (Devices), and
  **pairing creates a new agent** (or, since 2026-11-13, reconnects to a Mac agent that has
  no Mac now, when the person chooses so). Only that agent runs programs on that Mac.
- **Programs are set up in Wysebee** (the agent's Tools tab, "Run local program"), kept in
  the agent's settings in Wysebee Cloud, **and must be allowed in this app, on the Mac,
  before they can run**. This app runs from its own approved copy; a call carries only the
  program's name and the values of its blanks.
- Nothing is widened: the person names the program and its fixed arguments, the model only
  fills blanks, it is started as an argument list (never a shell), no input, 60 s, output
  cut at 20,000 characters each.
- The agent's model loop runs where a browser agent's does: the desktop where the code was
  typed, or **Wysebee Cloud when it was typed on the website** (2026-11-13, below). This app
  runs no model.
- Wysebee Desktop stopped running local programs on every platform, Windows and Linux
  included, until they have an agent of their own.

## The owner's decision (2026-11-13): a Mac agent may live in Wysebee Cloud

A Mac may have only this app installed, and no Wysebee Desktop. So **a Mac's code can be
typed on the website too**, exactly as a browser's: the claim with `home: "cloud"` makes the
agent with its Home in Wysebee Cloud (`desktop_only` is gone), and **Wysebee Cloud's own
loop runs it**, with this Mac's tools, as Wysebee Desktop's loop would:

- a `local_run` tool for each of the agent's `local_programs`, `skill_run` for its skills'
  declared scripts, and `folder_find`, `folder_list`, `folder_read`, `folder_write` over its
  `mac_folders` — the same tool names, descriptions and arguments as Wysebee Desktop's, sent
  as the same ops through `run_op`, with the same `timeout_seconds` (75);
- a folder tool's **picture is shown to the person and never given to the model**, and the
  conversation the cloud keeps leaves what a folder tool read or wrote out, as on the desktop;
- nothing else changes for this app: the same link, ops, approval and limits. It cannot tell,
  and need not know, which loop sends a call. Paired from Wysebee Desktop, an agent's Home is
  that desktop, as before.

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
| `6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c01` | `wysebee-browser-chrome` | Wysebee Chrome Agent | `browser_link` | `ping`, `browser_tabs`, `browser_activate`, `browser_snapshot`, `browser_screenshot`, `browser_navigate`, `browser_click`, `browser_type`, `browser_open_tab`, `browser_close_tab`, `browser_scroll`, `browser_drag`, `browser_mouse`, `browser_bookmarks`, `browser_console`, `browser_network`, `browser_network_body`, `browser_evaluate`, `browser_viewport`, `browser_inspect`, `browser_audit`, `browser_performance`, `browser_reload`, `recording_saved` | `browser`, `devtools`, `gmail`, `calendar`, `travel`, `news`, `website` |
| `6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c02` | `wysebee-osx` | Wysebee OSX Agent | `mac_link` | `ping`, `local_run`, `skill_run`, `folder_call`, `program_run`, `screen_screenshot`, `screen_action`, `dev_shell`, `dev_job`, `dev_file`, `android_dev`, `ios_dev` | `local`, `folder`, `sqlite`, `skill_scripts`, `any_program`, `screen`, `developer`, `android_toolkit`, `ios_toolkit` |
| `6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c04` | `wysebee-windows` | Wysebee Windows Agent | `mac_link` | `ping`, `local_run`, `skill_run`, `folder_call`, `program_run`, `screen_screenshot`, `screen_action`, `dev_shell`, `dev_job`, `dev_file`, `android_dev` | `local`, `folder`, `sqlite`, `skill_scripts`, `any_program`, `screen`, `developer`, `android_toolkit` |

`wysebee-windows` (2026-11-13, wysebee-cloud migration 0051) is Wysebee Agent for Windows
(`wysebee-agent-win`), which speaks this protocol as the Mac app does; its links' legacy `kind`
is `osx`, and an agent paired from one is never reconnected from the other.

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

## The owner's decision (2026-11-16): a Windows PC's agent may run any program

**Run any program**: an agent paired with Wysebee Agent for Windows may be given one tool,
`run_program`, with which **the AI names the program and its arguments itself** — the one
exception to "the person names the program". It is the tool kind `any_program` and the op
`program_run`, which only the `wysebee-windows` type lists (wysebee-cloud migration 0069); the
Mac's type lists neither, and Wysebee Agent for Mac does not implement the op.

- **The agent's setting**: `run_any_program: true` (given in the agent's Tools, "Run any
  program"); a save adding it to an agent of another type is refused (`wrong_agent_kind`).
- **The op**: `program_run` `{"program": <text, 1-1000>, "args": [<text>, …] (at most 30)}`.
  The answer is a program's: `{"exit_code", "stdout", "stderr"}`.
- **On the PC it runs only while the person has turned on "Let Wysebee run any program on
  this PC"** in Wysebee Agent's window (off by default, asked to confirm, forgotten on
  unpairing); otherwise, and while paused, it is refused in a sentence. The poll's status
  reports it: `"any_program": bool`.
- **Run as an allowed program runs**: found the same way (an `.exe` or `.com` on the PATH, or
  by full path; never a batch file), an argument list (never a shell), no input, in the
  person's home folder, stopped after 60 s, output cut at 20,000 characters each.
- **A safeguard, not a sandbox** (later the same day): a program the AI names is refused,
  in a sentence, when it is a disk, boot or backup tool (`format`, `diskpart`, `bcdedit`,
  `vssadmin`, …), a shell or script host (`cmd`, PowerShell, WSL, `wscript`, `mshta`,
  `rundll32`, …: they would run anything), a tool that changes accounts, permissions,
  services, tasks, the registry, the firewall, software or logs (`net`, `reg`, `schtasks`,
  `icacls`, `msiexec`, `winget`, …), one that shuts the PC down or deletes files outright, an
  interpreter given code inline (`python -c`, `node -e`, …), or `git clean`, `git reset
  --hard`, a forced `git push`, `robocopy /MIR`. A program the person allowed is never checked.

## The owner's decision (2026-11-16): a Windows PC's agent may see and work its screen

**Screen control**, for trying an app on the PC from Wysebee: an agent paired with Wysebee
Agent for Windows may be given two tools, `screen_screenshot` and `screen_action`, sent as the
ops of the same names. Tool kind `screen`; only the `wysebee-windows` type lists the kind and
the ops (wysebee-cloud migration 0070).

- **The agent's setting**: `screen_control: true` (the agent's Tools, "Screen control"); a save
  adding it to an agent of another type is refused.
- **`screen_screenshot`** `{}` → `{"image": <JPEG, base64>, "mime": "image/jpeg", "width",
  "height" (the picture's: the primary display scaled to at most 1568 pixels on its long side
  and 1.15 million in all), "screen_width", "screen_height", "cursor": [x, y] | null}`, the
  pointer drawn in as a red ring. The cloud hands the picture to the model as an image.
- **`screen_action`** `{"action": "move" | "click" | "double_click" | "right_click" |
  "middle_click" | "drag" | "scroll" | "type" | "key", "x", "y" (in the last screenshot's
  pixels), "to_x", "to_y" (drag), "direction", "amount" (scroll: 1-20), "text" (type: 1-2000
  characters), "keys" (key: up to 5 joined by +, like `ctrl+s`), "screenshot": bool (default
  true)}` → `{"done": <what was done, never the typed text>}` and, unless `screenshot` is
  false, a new screenshot's fields. A red ring shows on the PC where the pointer acts.
- **On the PC it works only while the person has turned on "Let Wysebee see and control this
  PC's screen"** in Wysebee Agent's window (off by default, confirmed, forgotten on unpairing,
  reported in the poll as `"screen_control": bool`); paused, it is refused. **Nothing checks
  what is typed or clicked**: the switch is the safeguard, and Run any program's list of
  refused programs does not reach what is done on the screen.

## The owner's decision (2026-11-16): a Windows PC's agent may work there as a developer

So an AI elsewhere can work on the PC **as a coding assistant running on it would**, and on the
Android phones plugged in to it (wysebee-cloud migration 0071; only `wysebee-windows` lists
these ops and tool kinds):

- **Developer access** (`developer_access: true`, tool kind `developer`), answered only while
  the person has turned on **"Let Wysebee use this PC as a developer"** (off by default,
  confirmed, forgotten on unpairing, reported in the poll as `"dev_access": bool`):
  - `dev_shell` `{command, shell: "powershell" | "pwsh" | "cmd" (default powershell), cwd
    (full, or relative to the home folder), timeout_secs (1-220, default 120), background:
    bool}` → `{exit_code, stdout, stderr}` (each cut at 30,000), or `{job, status}` when in
    the background. **Anywhere on the PC, as the person — the person's choice.** Run any
    program's list of refused programs does not apply.
  - `dev_job` `{job, action: "output" (default) | "stop" | "list", tail}` → the job's
    status, exit code and newest output; at most 8 running, stopped on pause, when the switch
    goes off and on unpairing.
  - `dev_file` `{tool: "read" | "write" | "edit" | "glob" | "grep" | "list", path, …}` →
    `{text}`: lines numbered (2,000 at once), a whole file written, exact text replaced
    (once, or `replace_all`), files found by a pattern, lines found by a regex (500 at most;
    `.git`, `node_modules`, `build` and the like skipped), a folder listed.
- **The Android Development Toolkit** (`android_toolkit: true`, tool kind `android_toolkit`;
  Wysebee Desktop's, retired with it and ported), answered only while the person has turned on
  **"Let Wysebee use Android phones on this PC"** (`"android_dev": bool` in the poll):
  `android_dev` `{tool, args}`, its seventeen tools through the PC's adb (found on the PATH
  or in the Android SDK's `platform-tools`) — devices, screenshot, screen (uiautomator),
  logcat, info, apps, files, pull; tap, swipe, type, key, open; install, uninstall, push, shell
  — answering `{text}` and, for a picture, `image` `{media_type, data}`. Never `su` nor a
  reboot into a bootloader or recovery. The cloud names them `adb_*` for the model (a paired
  phone's own tools are `android_*`).

## The owner's decision (2026-11-17): a Mac's agent does all of that too, and uses iPhones

**Wysebee Agent for Mac does everything the four sections above give a Windows PC**, the same
ops and the same answers, behind the same four switches in its window ("… on this Mac"),
each off by default, confirmed, forgotten on unpairing and reported in the poll; and it
gains **the iPhone Development Toolkit**, which only it has (wysebee-cloud migration 0072
adds the ops and tool kinds to `wysebee-osx`; `ios_dev` and `ios_toolkit` are the Mac's only).
What differs on a Mac:

- **Run any program**: a program is any executable file on the PATH (Homebrew's folders
  included) or by full path, as an allowed program. The safeguard's list is the Mac's: disk,
  boot and backup tools (`diskutil`, `asr`, `tmutil`, `csrutil`, `nvram`, `hdiutil`, …),
  shells and script hosts and every program that runs another (`zsh`, `bash`, `osascript`,
  `env`, `xargs`, `sudo`, `launchctl`, `find`, …), tools that change settings, accounts,
  permissions, security or software (`defaults`, `dscl`, `security`, `chmod`, `softwareupdate`,
  `brew`, …), `shutdown`/`reboot`, `rm`, inline interpreter code, and `git clean`, `git reset
  --hard`, a forced `git push`, `rsync --delete`.
- **Screen control**: the main display; coordinates in its pixels (a Retina display's are
  twice its points), keys named `cmd`, `ctrl`, `alt` (Option), `shift`, … (`command`, `meta`
  and `win` are `cmd`; `option` is `alt`). macOS asks the person to allow Screen Recording and
  Accessibility first.
- **Developer access**: `dev_shell`'s `shell` is `zsh` (the default), `bash` or `sh`; zsh and
  bash run as login shells, so the person's `.zprofile` (Homebrew's PATH) is read.
- **The Android toolkit**: adb on the PATH, Homebrew's, `ANDROID_HOME`'s or
  `~/Library/Android/sdk/platform-tools`; a download goes to `~/Downloads/Wysebee`.
- **The iPhone Development Toolkit** (`ios_toolkit: true`, tool kind `ios_toolkit`), answered
  only while the person has turned on **"Let Wysebee use iPhones and simulators on this Mac"**
  (`"ios_dev": bool` in the poll): `ios_dev` `{tool, args}`, thirteen tools through Xcode's
  `xcrun` — `simctl` for the simulators, `devicectl` (Xcode 15 or later) for the iPhones
  paired with the Mac:
  - `ios_devices` `{}`: each simulator and iPhone `{udid, name, os, kind: "simulator" |
    "iphone", state}`;
  - `ios_screenshot` `{udid}` (a booted simulator) → `{text, image: {media_type, data}}`;
  - `ios_logs` `{udid, process, minutes (1-60, default 5), contains}` (a booted simulator);
  - `ios_apps` `{udid, contains}`, `ios_info` `{udid}` (a simulator or an iPhone);
  - `ios_boot`, `ios_shutdown`, `ios_open_url` `{url}`, `ios_terminate` `{bundle_id}`,
    `ios_appearance` `{mode: "light" | "dark"}` (a simulator);
  - `ios_launch` `{bundle_id}`, `ios_install` `{app: a simulator build's .app folder, or a
    signed .app or .ipa for an iPhone}`, `ios_uninstall` `{bundle_id}` (either).

  `udid` is a udid or a name from `ios_devices`, not needed when one is ready (a booted
  simulator or a reachable iPhone). xcrun is run with arguments, never through a shell.
  Nothing taps a simulator (Screen control does, on the Simulator window), and an iPhone has
  no screenshot or log through devicectl. Each answers `{text}`.

## The owner's decision (2026-11-18): a Linux machine's agent

**Wysebee Agent for Linux** (`wysebee-agent-linux`) speaks this protocol as the Mac and
Windows apps do, for Linux desktops, servers and cloud VMs (Azure, AWS). It has **no
window**: the person pairs, allows, adds folders and turns switches on with its command line
(`wysebee-agent pair`, `allow`, `folder add`, `enable`), on the machine, as the person; a
systemd service runs it at boot. Nothing about what runs changes:

- **The agent type `wysebee-linux`**, "Wysebee Linux Agent", link field `mac_link` (legacy
  `kind` `osx`), **ops** `ping`, `local_run`, `skill_run`, `folder_call`, `program_run`,
  `dev_shell`, `dev_job`, `dev_file`, `android_dev`; **tool kinds** `local`, `folder`,
  `sqlite`, `skill_scripts`, `any_program`, `developer`, `android_toolkit` — the Windows
  type's without the screen's (a server has none). Id
  `6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c06` (`…5c05` is the Android type's), seeded by
  wysebee-cloud migration 0079.
  An agent paired from Linux is never reconnected from a Mac or a PC, nor the reverse.
- **The poll's status** is the Mac's: `screen_control` is always false and `ios_dev` is not
  sent.
- **Run any program**: any executable file on the PATH (the system's folders, `/snap/bin`,
  `~/.local/bin` included) or by full path. The safeguard's list is Linux's: disk, file
  system and boot tools (`fdisk`, `parted`, `mkfs`, `dd`, `cryptsetup`, `mount`,
  `grub-install`, …), shells and every program that runs another (`bash`, `sh`, `busybox`,
  `env`, `xargs`, `sudo`, `pkexec`, `systemd-run`, `nsenter`, `find`, …), tools that change
  services, accounts, permissions, the kernel, the firewall or software (`systemctl`,
  `useradd`, `passwd`, `chmod`, `modprobe`, `iptables`, `apt`, `dnf`, `snap`, …), power,
  `rm` and `kill`, inline interpreter code, and `git clean`, `git reset --hard`, a forced
  `git push`, `rsync --delete`, `journalctl --vacuum-…`.
- **Developer access**: `dev_shell`'s `shell` is `bash` (the default), `zsh` or `sh`; bash
  and zsh as login shells.
- **The Android toolkit**: adb on the PATH, `ANDROID_HOME`'s or `~/Android/Sdk/platform-tools`;
  a download goes to `~/Downloads/Wysebee`.
- **The secret** is a file of its own (mode 0600 in the 0700 state folder
  `~/.local/state/wysebee-agent`): a server has no keyring a service can use.

## One link mechanism, two kinds

The cloud's `browser_links` table has a `kind`: `browser` (the extension) or `osx` (this
app). The same routes are served under **`/api/v1/agent-links`** and, for the extension and
older clients, `/api/v1/browser-links`. A link of either kind may be reached at either
prefix; what differs is below.

`Link` = the extension's, plus `"kind": "browser" | "osx"` and `"approved": ["<program
name>", ...]` (osx: the agent's programs this Mac has allowed, as it last said; `[]` for a
browser). For an `osx` link `browser` holds the Mac's name and `extension_version` this
app's version.

## Pairing

1. **This app** `POST /api/v1/agent-links/start` (no auth)
   `{"kind": "wysebee-osx", "name": "<agent name typed: one line, 1-60>", "secret_hash": "<64 hex>",
   "browser": "<the Mac's name, at most 32>", "extension_version": "x.y.z"}`
   -> `{"id", "code", "expires_in"}`. `kind` is an agent type's key (above); `"osx"`, from builds made before 2026-11-13, means
   `wysebee-osx`, and `kind` omitted means `wysebee-browser-chrome`.
2. **Wysebee** `POST /claim` exactly as for a browser (the person need not know which kind
   a code is). A taken name, and reconnecting to a Mac agent that has no
   Mac now, are as the 2026-11-13 decision above says. For an `osx` link the new agent's `CONFIG` is `{"label", "mac_link": "<link
   id>", "home", "home_name"}`. `home` may be `"cloud"` (typed on the website) or the desktop's
   install id, as for a browser.
3. The secret (32 random bytes, base64url) is kept in the macOS Keychain; the cloud keeps
   its SHA-256.

## The app's poll

`POST /api/v1/agent-links/{id}/poll?wait=20` (the app's secret as Bearer), body
`{"status": {"paused": bool, "extension_version": "x.y.z", "browser": "<Mac's name>",
"approved": ["<program name>", ...]}}` (at most 20 names).

Answers as for the extension; `paired` also carries **`"programs"`**: the agent's
`local_programs` as stored in its settings (a list of at most 20
`{"name", "description", "command", "args": [{"value": "..."} | {"param": "...",
"description": "..."}]}`), `[]` when it has none. The cloud wakes the poll when the agent's
settings are saved.

## Approval, on the Mac

- A program is **the same** while its `name`, `command` and `args` (each fixed value and
  each blank's name, in order) are unchanged; its description is not part of it.
- A program in `programs` that this app has no approved copy of, or whose approved copy
  differs, is **waiting**: shown in the app's window with its full command line, and
  refused when called, until the person clicks **Allow** there.
- Allowing resolves the program **then**: an absolute path that is a file, or a bare name
  found on the app's `PATH` plus `/opt/homebrew/bin` and `/usr/local/bin`. The approved copy
  keeps the resolved absolute path, and that path is what runs.
- A program no longer in `programs` loses its approval.
- Approvals are kept in the app's own file (`~/Library/Application Support/Wysebee
  Agent/state.json`), never taken from the cloud.

## Running a program

Ops of an `osx` link (anything else is refused by the cloud and by the app):

- `ping` -> `{"pong": true}`.
- `local_run`, args `{"name": "<program name>", "values": {"<blank>": "<text>", ...}}`
  -> `{"exit_code": <int|null>, "stdout": "<text>", "stderr": "<text>"}` (each cut at
  20,000 characters with `\n…[cut at 20000 characters]`).
  Failures are `ok: false` with an English `error`: paused, no such program, waiting for
  approval, a blank not filled (`Fill in '<blank>'.`), the program gone, could not be
  started, or not finished within 60 seconds (it is killed).
  It runs in the person's home folder with no input.

The driver gives `local_run` a `timeout_seconds` of 75.

## The agent's settings

- `mac_link` (shared): the link id. **Set only by the claim**; an agent save keeps what the
  links table says, as for `browser_link`.
- `local_programs` (shared since 2026-11-12; it was each computer's own): the programs.
  Offered to the model only for an agent with a `mac_link`.

## Which agent may add which tool

Each tool has a kind, kept by the agent type pack of the device that has it (wysebee-cloud
`apps/cloud/packs/`, served with each type by `GET /api/v1/agent-types`): `browser` (Browser access, Web development
tools, the site tools: gmail, calendar, travel, news, website), `osx` (Run local program, Local Folder (`folder`), and
`skill_scripts`: a skill's scripts, below),
else `any`. An agent's kind is `browser` with a `browser_link`, `osx` with a `mac_link`,
else plain. A save that **adds** a `browser` or `osx` tool (the stored settings lacked it,
the sent ones have it) to an agent of another kind is refused: 422,
`code: "wrong_agent_kind"`. Removing is always allowed.

## Skill scripts (2026-11-12, later the same day)

The owner's decisions: **Wysebee Desktop no longer runs a skill's scripts** (the last place it
started a program for an agent). A skill's declared scripts run **only for an agent made by
pairing this app, and only here**. Any agent may still have a skill that declares scripts,
for its instructions and files; for any other agent the scripts are shown as running only
for a Mac agent, never offered and never run. Nothing is dropped from a `SKILL.md`.

### The skills, in the poll

`paired` also carries **`"skills"`**: one entry per skill the agent has (its settings'
`skills`, at most 50) that Wysebee Cloud holds as a synced `skill` item:
`{"name": "<skill>", "files": [{"path": "<relative path>", "id": "<sha-256 hex>", "size": n}]}`
(`[]` when it has none). `SKILL.md` is one of the files; **this app reads the declared
scripts from it itself** (the same front matter Wysebee Desktop's `skills.rs` reads:
`scripts:` a list of `name`, `command`, `description`). The status body gains
`"approved_skills": ["<skill>", ...]` (at most 50), and `Link` gains `approved_skills`.

### A skill's files

`GET /api/v1/agent-links/{id}/skill-files/{file id}` (the app's secret) -> the file's bytes.
404 unless the link is an `osx` link and the file id is in the synced file list of a skill
its agent has. The app checks that the bytes' SHA-256 is the id, and refuses the file
otherwise. Paths are relative, `/`-separated, with no `..`, no absolute path and no empty
part; anything else is refused.

Files that never go to the cloud (those that look like secrets, files over 5 MB, past 200)
are not in the list. **The person may put such files in this app's own copy of the skill**
(Show in Finder, in the app's window): they stay on the Mac, are never sent anywhere, and
are not part of the approval below.

### Approval, on the Mac

- A skill is **the same** while its synced file list (each `path` and `id`) is unchanged.
  `SKILL.md` is in it, so the declared scripts are too.
- A skill with no approved copy, or whose file list changed, is **waiting**: shown with its
  declared scripts' commands and the files that changed. This app may download a waiting
  skill's files into a staging folder to show them; **nothing in staging ever runs**.
- **Allow** downloads what is missing, checks every hash, resolves each script's program
  (the first word of its command: a path containing `/` is a file inside the skill's folder,
  after following links; else a name on the app's `PATH` plus `/opt/homebrew/bin` and
  `/usr/local/bin`), and puts the skill in place: synced files replaced or removed, files the
  person added on the Mac kept. The approved copy keeps the file list and the resolved
  programs.
- A skill no longer in `skills` loses its approval (its folder stays, for the person's own
  files, until unpaired).

### Running a script

- `skill_run`, args `{"skill": "<skill>", "script": "<script name>", "args": ["<text>", ...]}`
  (at most 30 arguments) -> `{"exit_code", "stdout", "stderr"}`, cut as `local_run`'s.
  It runs the declared command's words then `args`, as an argument list (never a shell),
  in the approved copy of the skill's folder, with no input, for at most 60 seconds.
  Failures are `ok: false` with an English `error`: paused, no such skill, waiting for
  approval, no such script, the program gone, could not be started, not finished in time.
- The driver gives `skill_run` a `timeout_seconds` of 75. An `osx` link's ops are `ping`,
  `local_run` and `skill_run`.

### The tag

The computer's pack lists `skill_scripts` among its tool kinds: a skill that declares scripts is a Mac
agent's to use fully; one that declares none is anyone's. It is shown, not refused: an agent
of another kind may have the skill, and its scripts are not offered or run there.

## Local folders (2026-11-12, later again)

The owner's decisions: **Local Folder leaves Wysebee Desktop** (a sandboxed app cannot open a
folder path somebody typed). Its four tools — `folder_find`, `folder_list`, `folder_read`,
`folder_write`, pack `folder` — are **a Mac agent's only**, and run here. **The person picks
each folder in this app's window** (a native folder picker), with its permission — read only,
or read and write — and an optional description; the cloud and Wysebee Desktop never hold a
path this app would act on, so there is nothing to approve. Folders other agents had on a
desktop are dropped (the desktop's `folders` setting is retired). The tag stays `osx`:
The computer's pack lists `folder` among its tool kinds.

### The folders, reported

The status body gains `"folders"`: this app's folders, at most 20, in its own order:
`{"id": "<1-32 of A-Za-z0-9_->", "name": "<1-60, one line>", "path": "<shown only, ≤1000>",
"mode": "read" | "write", "description": "<≤1000, may be empty>"}`. `id` is made by this app
and never reused; `name` defaults to the folder's own name. A poll's body may be up to 256 KiB (the cloud's
`POLL_BODY`; `/start` and `/claim` stay at 4 KiB). The cloud keeps the list on the
link (`Link.folders`) and **writes it to the agent's settings as `mac_folders`**, which only
the cloud sets (an agent save keeps what the link says, as for `mac_link`). Wysebee Desktop
offers the folder tools from `mac_folders`; their descriptions number the folders in that
order and show each one's name, path, permission and description. **The name, path and
description are the device's words** (2026-11-18: a device is whatever paired, a modified agent
too), so Wysebee Cloud's loop shows each as quoted data on one line — line breaks and control
characters become spaces, at most 60, 200 and 300 characters — under a note that they are
data, never instructions to follow.

### Using a folder

- `folder_call`, args `{"tool": "folder_find" | "folder_list" | "folder_read" |
  "folder_write", "folder": "<id>" | null, "args": {...}}` — `folder` names the folder the
  model chose by its number (null: `folder_find` across every folder); `args` are the
  model's other arguments as the tool defines them (`query`, `path`, `sheet`, `content`).
  -> `{"text": "<the tool's answer>", "picture": {"media_type", "data"}?}`; a refusal is
  `ok: false` with an English `error`.
- **This app decides**: the folder is its own (an id it does not have is refused); a path
  is relative to the folder, never absolute, never `..`, and what it names is resolved
  through links and must still be inside the folder; writing needs a read-and-write folder.
  The limits are Wysebee Desktop's were: files read up to 50 MB (a picture 10 MB), a
  search over at most 50,000 entries answering 200, a listing 500, sheets 5,000 rows, a
  write 1,000,000 characters; `.git`, `node_modules`, `.Trash`, `__pycache__` skipped.
  Text, Word (`.docx`), Excel (`.xlsx`, `.xlsm`, `.xls`, `.ods`) and PDF are read as text.
- **A picture** (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`) comes back as `picture`, with
  `text` saying it was shown to the person: the loop (Wysebee Desktop's, or Wysebee Cloud's
  for an agent living there) shows it to the person and **never gives it to the model**. It
  passes through Wysebee Cloud like any result (kept until read, an hour at most). The
  conversation Wysebee Cloud keeps still leaves what a folder tool read or wrote out
  (Wysebee Desktop's `folders::kept_local`; the cloud loop does the same).
- Paused: refused like every op. The driver gives `folder_call` a `timeout_seconds` of 75.
  An `osx` link's ops are `ping`, `local_run`, `skill_run` and `folder_call`.

## What the cloud sees

Every call's blank values and the program's output pass through Wysebee Cloud and are kept
until read, an hour at most. The cloud also holds the program definitions (they are the
agent's settings). It cannot make this app run anything the person did not allow here.
