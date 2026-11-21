# The Wysebee Agent link for an Android phone

How **Wysebee Agent for Android** (`wysebee-agent-android`), **Wysebee Cloud** (`wysebee-cloud`,
`apps/cloud/browser_links.py`) and the agent's loop (Wysebee Cloud's `apps/cloud/agent_chat`,
or Wysebee Desktop) talk. It is the browser extension's link
([browser-extension.md](browser-extension.md)) and the Mac app's
([computer.md](computer.md)) with a third kind of device: read those first; only the
differences are written here.

> **Status (2026-11-15):** this app implements everything below, and wysebee-cloud's branch
> `feat/android-agent-type` registers the type (migration 0059) and serves the phone pack to
> Wysebee Assistant. Until that branch is deployed, `/start` answers 422 `invalid_kind` and the
> app says "This Wysebee Cloud does not pair Android agents yet."

## The decisions

- The app **pairs with Wysebee Cloud only**, exactly as the Mac app does: the person types an
  agent name on the phone, the phone shows a code, the person types it in Wysebee (Devices).
  **Pairing creates a new agent** (or reconnects one of this type that has no phone), and only
  that agent operates this phone.
- **It runs no model.** It is the agent's eyes and hands on the phone: it reads the screen,
  takes screenshots, taps, types, swipes, scrolls, presses the phone's keys and opens apps, one
  op at a time, through an Android **accessibility service** the person turns on in the phone's
  Settings › Accessibility. Off, every op but `ping` fails and says so.
- **The person allows apps on the phone, never the cloud.** The agent may open, read and touch
  only the apps listed in the app's window, ticked there one by one (2026-11-17: **never every
  app** — the "Every app" switch is gone, and a state file that had it on keeps only its list). An
  op is refused while another app is in front. **Never this app itself** (it would let the agent
  change what it may do), even if listed. Nothing from the cloud changes the list.
- **Never a picture of a banking, payment, investing or password app** (2026-11-17,
  `core/Sensitive.kt`: a list of well-known ones, and words such as bank, 銀行, pay, wallet,
  invest, crypto, password or authenticator in the package or name). `android_screenshot` is
  refused there, and `android_snapshot` reads the screen as text with no picture, saying so. The
  window marks such apps when the person allows them.
- **System UI only when the person turns it on** (2026-11-17, its own switch, off by default):
  the notification shade and quick settings (`com.android.systemui`) are then operated like an
  allowed app — every app's notifications can be read, quick settings toggled.
- **Nothing while the phone is locked**: every op but `ping` is refused while the lock screen is
  up (`KeyguardManager.isKeyguardLocked`), System UI allowed or not, so the agent never touches
  the lock screen or tries a PIN.
- **Never a password field**: its text is not read (`"(password: not read)"`) and nothing is
  typed into it. The person types passwords.
- **Paused** (the window's switch): every op but `ping` is refused on the phone, and the next
  poll reports `paused: true` (the cloud then refuses new calls, as for a paused Mac).

## The agent type

| `id` | `key` | `name` | `link_field` | `ops` | `tool_kinds` |
|---|---|---|---|---|---|
| `6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c05` | `wysebee-android` | Wysebee Android Agent | `android_link` (new) | `ping`, `android_apps`, `android_launch`, `android_snapshot`, `android_screenshot`, `android_tap`, `android_type`, `android_swipe`, `android_scroll`, `android_key` | `android` |

`android_link` is a new link field: the poll sends no programs, skills or folders (that is
`mac_link`'s), and the claim's `CONFIG` is `{"label", "android_link": "<link id>", "home",
"home_name"}`. Its legacy `kind` would be `android`.

## Pairing and the poll

As the Mac app's, under `/api/v1/agent-links`:

- `POST /start` `{"kind": "wysebee-android", "name", "secret_hash", "browser": "<the phone's
  name, at most 32>", "extension_version": "x.y.z"}`.
- `POST /{id}/poll?wait=20`, body `{"status": {"paused": bool, "extension_version",
  "browser"}}`. Answers as the extension's: `pending`, `refused`, `paired` (with `calls` and
  `cancelled`), 401 (unpaired: the app forgets the link, the secret and the allowed apps), 410
  (the code ran out).
- `POST /{id}/calls/{call_id}/result`, `DELETE /{id}`: as the extension's.
- The secret is sealed with an Android Keystore key, kept in the app's private files; never in
  the state file or a log. Redirects are never followed.
- **A poll is never cut short to report a change** but a new or ended link: a poll's answer
  may carry calls, which the cloud hands out once, and an abandoned answer would lose them.

## Pairing by a QR code (2026-11-17)

The person's call: typing the phone's code in Wysebee is inconvenient, and a computer has no
camera to scan one, so **Wysebee shows a QR code and the phone scans it**.

- **Wysebee** asks the cloud for an offer: `POST /api/v1/agent-links/offers` (signed in) ->
  `{"id", "token", "expires_in": 600}`. One use, ten minutes, at most five open per person (a
  sixth drops the oldest); the cloud keeps only the token's SHA-256 (migration 0078,
  `agent_link_offers`). It shows the QR code
  `wysebee-agent:pair?offer=<token>&from=<the page's origin>` and asks `GET
  /api/v1/agent-links/offers/{id}` every 2 s: `{"state": "waiting" | "expired"}` or
  `{"state": "paired", "agent": {"name", "label"}}`, 404 `offer_unknown` for none of theirs.
- **The phone** scans it (Google Play services' code scanner: its own camera screen, no camera
  permission here) and starts pairing as ever, with `"offer": "<token>"` in `/start`'s body. The
  token is sent **only to this build's own cloud**, whatever `from` says; `from` is only for
  saying where a QR code came from when that cloud does not know it.
- **The cloud** takes the offer for this start at once (two scans pair once), makes the link
  and claims it for the offer's person, under the name typed on the phone, as a typed code's
  claim would: `{"id", "code": null, "expires_in": 0, "agent": {"name", "label"}}`. The phone is
  paired then and there, and polls as any paired phone. A name refused (409 `name_taken`, 422
  `reserved` / `invalid_name`, 409 `too_many`) leaves no link and frees the offer, for the
  phone to start again with another name; an offer used, run out or unknown is 404
  `offer_unknown`. **A scan may reconnect, once the person says so in Wysebee**: `name_taken`
  says `{"agent": {"name", "label"}, "reconnect": bool}`, and when `reconnect` is true (an
  agent of this type with no phone now) the phone offers **Reconnect to <label>**, starting
  again with the same offer and `"reconnect": true`. Since 2026-11-18 that start is **not
  claimed at once**: the device alone would take over an agent's chats, settings and tools, and
  a device is whatever paired, a modified app too. It answers as a typed-code start does,
  `{"id", "code", "expires_in"}`; the phone shows the code, the person types it in Wysebee, is
  told the name is taken, and chooses **Reconnect** there (the claim's `reconnect`); the agent
  keeps everything. The offer stays good meanwhile. (The phone needs no change; its words for
  this step could say to type the code in Wysebee to confirm.)
- The code stays: the phone still offers **Pair with a code**, and Wysebee's dialog still has
  its code field.

## Operating the phone

Coordinates are **screen pixels** (the snapshot's `@x,y`, the `screen` size). A failure is
`ok: false` with an English `error` the model can act on. Every op but `ping` is refused while
paused or with the accessibility service off; every op but `ping`, `android_apps`,
`android_launch` and `android_key` is refused while an app the person did not allow is in
front. After an op that acts, the phone waits for the screen to settle (at most 2 s; 4 s after
`android_launch`) before answering.

- `ping` -> `{"pong": true}`.
- `android_apps` -> `{"apps": [{"package", "label"}], "system_ui": bool}`: the apps the agent may
  open, by name (`all_apps` is gone with its switch), and whether System UI is on.
- `android_launch` `{"package"}` -> `{"opened", "app"}` (`app`: what is in front afterwards).
- `android_snapshot` `{"with_image"?: bool, "wait_ms"?: 0-10000}` -> `{"app", "label", "screen":
  {"width", "height"}, "snapshot": "<text>"}`, plus `image` (base64 JPEG), `mime`, `width`,
  `height` with `with_image` (left out when the screen cannot be captured). The text is a
  header, then one line per element with something to read or do:
  `[ref] Kind "text" (description) hint "…" #view-id flags @x,y` — flags `tap`, `long-tap`,
  `input`, `scroll`, `checked`/`unchecked`, `selected`, `focused`, `disabled`; children
  indented under their element. Plain containers are left out (their children lifted);
  elements not visible are skipped. At most 1,500 elements, 300 characters of one text, 50,000
  characters in all. **Refs are the latest snapshot's**: an op given a ref from an older one, or
  one gone from the screen, is refused with "take a new android_snapshot".
- `android_screenshot` -> `{"app", "screen", "image", "mime": "image/jpeg", "width", "height"}`:
  the screen scaled to at most 1,280 pixels on its long side. Screens an app protects
  (`FLAG_SECURE`) are refused, and so is any banking, payment, investing or password app (above).
- `android_tap` `{"ref"} | {"x", "y"}`, `"long"?: bool` -> `{"done", "app"}`. A ref is clicked
  as accessibility clicks it (or its nearest clickable parent), else tapped at its centre.
- `android_type` `{"text", "ref"?, "clear"?: bool = true, "submit"?: bool}` -> `{"typed":
  <characters now in the field>, "submitted", "app"}`. Without `ref`, the field that has focus.
  `clear: false` appends. When the field does not take the text but tapping it moved the focus
  to another field (a search bar that opens a search box), the text goes there. `submit` is the
  keyboard's Enter action. At most 10,000 characters.
- `android_swipe` `{"x1", "y1", "x2", "y2", "duration_ms"?: 50-5000 = 300}` -> `{"done", "app"}`.
- `android_scroll` `{"direction": "up"|"down"|"left"|"right", "ref"?}` -> `{"done": "scrolled" |
  "swiped", "direction", "app"}`. "down" shows what is further down. The list `ref` names (or
  holds), scrolled by accessibility; else a swipe across it, or across the screen.
- `android_key` `{"key": "back"|"home"|"recents"|"notifications"|"quick_settings"}` ->
  `{"pressed", "app"}`. Allowed in any app (it only navigates); what it opens is refused if it is
  not allowed.

Calls run one at a time (they are one pair of hands). A cancelled call answers nothing.
Suggested driver `timeout_seconds`: 60.

## What the cloud sees

Every call's arguments and its answer — screen text and screenshots of the allowed apps — pass
through Wysebee Cloud and are kept until read, an hour at most. Nothing else is uploaded from
the phone: not the list of installed apps (only the allowed ones, by `android_apps`), not the
allowed list itself, not what other apps show.

## In Wysebee Cloud

- Migration 0059 seeds the type; `android_link` is the third link field
  (`agent_types.LINK_FIELDS`, `tool_kinds.LINK_FIELDS`), legacy `kind` `android`, its refusals
  said of the phone (`browser_links.PHONE`).
- The claim makes the agent with `{"label", "android_link", "home", "home_name",
  "paired_kind", "agent_type_id"}`; a save keeps `android_link` as the links table says.
- `apps/cloud/agent_chat/android.py` is the phone pack Wysebee Assistant offers an agent whose
  phone is paired: one tool per op, the same names and arguments, absent ones left out, a
  60-second timeout; `android_snapshot` asked `with_image`; a snapshot's or screenshot's picture
  returned beside the text, a screenshot's with how its pixels map to the screen's.
- The phone's agent type pack (wysebee-cloud `apps/cloud/packs/android.py`) lists the tool kind `android`.
