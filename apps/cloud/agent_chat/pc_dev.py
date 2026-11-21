"""An agent's paired computer as a developer's (2026-11-16 for a Windows PC, the owner's call;
2026-11-17 for a Mac too; wysebee-agent-win's and ``docs/protocol/computer.md``),
through its link (``mac_link``):

- **Developer access** (``developer_access`` in its settings): ``dev_shell`` (a command —
  PowerShell or cmd on a Windows PC, zsh, bash or sh on a Mac, bash, zsh or sh on a Linux
  machine (2026-11-18) — anywhere on the computer,
  waited for or run in the background), ``dev_job`` (a background job's output, or stop it),
  and ``dev_read``, ``dev_write``, ``dev_edit``, ``dev_glob``, ``dev_grep`` and ``dev_list``
  (files anywhere) → the ops ``dev_shell``, ``dev_job`` and ``dev_file`` ``{tool, …}``;
- **the Android Development Toolkit** (``android_toolkit``): Wysebee Desktop's seventeen adb
  tools, for the phones plugged in to the computer, named ``adb_*`` here (``android_*`` are a
  paired phone's own tools, apps/cloud/agent_chat/android.py) → the op ``android_dev``
  ``{tool: "android_*", args}``, the names the computer's toolkit has.

Wysebee Agent answers them only while the person has turned on "Let Wysebee use this PC as a
developer" and "Let Wysebee use Android phones on this PC" (on a Mac, "this Mac") there
(migrations 0071, 0072). A Mac's iPhone toolkit is apps/cloud/agent_chat/ios_dev.py. The words
are the computer's (``mac.device_of``): its shells, paths and folders. **This is the only copy
of the tools' words.**
"""

import json
from typing import Any

from apps.cloud.agent_chat.mac import CALL_TIMEOUT, LINUX, MAC, WINDOWS_PC, Run, _dumps, _error, _failed, short, truncate, turned_on
from apps.cloud.agent_chat.tools import Output

DEV_FIELD = "developer_access"
ANDROID_FIELD = "android_toolkit"
SHELL, JOB = "dev_shell", "dev_job"
FILE_OP, ANDROID_OP = "dev_file", "android_dev"
FILE_TOOLS = {"dev_read": "read", "dev_write": "write", "dev_edit": "edit", "dev_glob": "glob", "dev_grep": "grep", "dev_list": "list"}
DEV_TOOLS = (SHELL, JOB, *FILE_TOOLS)
# The cloud waits at most 240 s for a call (browser_link_call_max_seconds).
MAX_WAIT = 240.0
IMAGE_ATTACHED = "[image attached]"

ANDROID_TOOLS: dict[str, tuple[str, dict, list[str]]] = {}
_S = {"type": "string", "description": "Which phone, by its serial from adb_devices; not needed when one is plugged in."}


def _android(name: str, description: str, properties: dict | None = None, required: list[str] | None = None) -> None:
    """One tool; its description's {device}, {pc}, {downloads}, {apk} and {adb} are the
    computer's words (:func:`_words`)."""
    ANDROID_TOOLS[name] = (description, {"serial": _S, **(properties or {})}, required or [])


_android("adb_devices", "List the Android phones (and emulators) plugged in to the person's {device} that adb may use: serial, state and model. {adb}")
_android("adb_screenshot", "Take a screenshot of an Android phone plugged in to the person's {pc}; you see it. Its pixels are scaled down: taps use the phone's own coordinates, which the answer gives.")
_android("adb_screen", "What is on an Android phone's screen, as uiautomator sees it: each element's text, id, description, whether it can be tapped, and the point to tap it. Use it before tapping, rather than guessing from a screenshot.")
_android("adb_logcat", "Read an Android phone's log (logcat), newest last: at least a priority (V, D, I, W, E, F), only a tag or an app's package, only lines containing some text.", {"lines": {"type": "integer", "description": "How many of the newest lines, 1-2000 (200 if not given)."}, "priority": {"type": "string", "enum": ["V", "D", "I", "W", "E", "F"]}, "tag": {"type": "string"}, "package": {"type": "string", "description": "Only this app's lines, as com.example.app (while it runs)."}, "contains": {"type": "string"}})
_android("adb_info", "An Android phone's details: maker, model, Android version and API level, screen size and density, battery, storage.")
_android("adb_apps", "List the apps on an Android phone by package name: those the person installed (or every one), only names containing some text.", {"all": {"type": "boolean", "description": "Include the phone's own system apps."}, "contains": {"type": "string"}})
_android("adb_files", "List a folder on an Android phone (its shared storage is /sdcard): names, sizes and dates.", {"path": {"type": "string", "description": "The folder (/sdcard if not given)."}})
_android("adb_pull", "Download a file from an Android phone to the {pc}, into {downloads}; a picture is shown too.", {"path": {"type": "string", "description": "The file on the phone, as /sdcard/DCIM/Camera/IMG_1.jpg."}}, ["path"])
_android("adb_tap", "Tap an Android phone's screen at a point, in the phone's pixels (from adb_screen or adb_screenshot).", {"x": {"type": "integer"}, "y": {"type": "integer"}}, ["x", "y"])
_android("adb_swipe", "Swipe on an Android phone's screen from one point to another, in the phone's pixels: to scroll, drag, or long-press (the same point, a long duration).", {"x1": {"type": "integer"}, "y1": {"type": "integer"}, "x2": {"type": "integer"}, "y2": {"type": "integer"}, "ms": {"type": "integer", "description": "How long, 50-5000 ms (300 if not given)."}}, ["x1", "y1", "x2", "y2"])
_android("adb_type", "Type text into the field that has focus on an Android phone (tap it first); plain ASCII.", {"text": {"type": "string"}}, ["text"])
_android("adb_key", "Press a key on an Android phone.", {"key": {"type": "string", "enum": ["home", "back", "recents", "enter", "tab", "delete", "up", "down", "left", "right", "menu", "search", "volume_up", "volume_down", "power", "wakeup"]}}, ["key"])
_android("adb_open", "Open an app on an Android phone by its package name, or a link (https://…, or an app's own link).", {"package": {"type": "string"}, "url": {"type": "string"}})
_android("adb_install", "Install (or update) an app on an Android phone from an .apk file on the {pc} (a full path, or one under the person's home, like {apk}).", {"apk": {"type": "string"}}, ["apk"])
_android("adb_uninstall", "Uninstall an app from an Android phone by its package name.", {"package": {"type": "string"}}, ["package"])
_android("adb_push", "Copy a file from the {pc} to an Android phone (into /sdcard/Download if no folder is given).", {"file": {"type": "string", "description": "The file's path on the computer: a full path, or one relative to the person's home folder."}, "to": {"type": "string", "description": "The folder on the phone."}}, ["file"])
_android("adb_shell", "Run an adb shell command on an Android phone, for what the other tools do not cover (am, pm, dumpsys, settings, getprop, run-as…). Not su, nor rebooting into a bootloader or recovery.", {"command": {"type": "string"}}, ["command"])


def _words(device: str) -> dict[str, str]:
    """What the tools' descriptions say of the computer: a Windows PC's, a Linux machine's or a Mac's."""
    if device == LINUX:
        return {
            "device": device, "pc": short(device), "downloads": "~/Downloads/Wysebee",
            "apk": "AndroidStudioProjects/App/app/build/outputs/apk/debug/app-debug.apk",
            "adb": "adb comes with Android Studio (~/Android/Sdk/platform-tools), or the distribution's package (sudo apt install adb).",
        }
    if device == WINDOWS_PC:
        return {
            "device": device, "pc": short(device), "downloads": "Downloads\\Wysebee",
            "apk": "AndroidStudioProjects\\App\\app\\build\\outputs\\apk\\debug\\app-debug.apk",
            "adb": "adb comes with Android Studio (the Android SDK's platform-tools).",
        }
    return {
        "device": device, "pc": short(device), "downloads": "~/Downloads/Wysebee",
        "apk": "AndroidStudioProjects/App/app/build/outputs/apk/debug/app-debug.apk",
        "adb": "adb comes with Android Studio, or `brew install android-platform-tools`.",
    }


# What only looks: Wysebee Assistant's call_agent_read_tool may run these.
READ_ONLY = frozenset({"dev_read", "dev_glob", "dev_grep", "dev_list", "adb_devices", "adb_screenshot", "adb_screen", "adb_logcat", "adb_info", "adb_apps", "adb_files"})

_OFF_NOTE = "It works only while the person has turned on {switch} on the {pc}; if it is off, say so and ask them."


def _dev_note(device: str) -> str:
    return _OFF_NOTE.format(switch=turned_on(device, f"Let Wysebee use this {short(device)} as a developer", "developer"), pc=short(device))


def _android_note(device: str) -> str:
    return _OFF_NOTE.format(switch=turned_on(device, f"Let Wysebee use Android phones on this {short(device)}", "android"), pc=short(device))


def dev_tools(device: str = MAC) -> list[dict]:
    """Developer access's tools, as a coding assistant on the computer would have them."""
    pc, note = short(device), _dev_note(device)
    if device == LINUX:
        shells, default = ["bash", "zsh", "sh"], "bash"
        how = "bash by default, as a login shell, so their PATH is there (or zsh, also a login shell, or sh)"
        path = {"type": "string", "description": "A full path on the machine (/home/…), or one relative to the person's home folder (not ~/…)."}
    elif device == WINDOWS_PC:
        shells, default = ["powershell", "pwsh", "cmd"], "powershell"
        how = "PowerShell by default (or cmd, for .bat/.cmd scripts like gradlew.bat)"
        path = {"type": "string", "description": "A full path on the PC (C:\\Users\\…), or one relative to the person's home folder."}
    else:
        shells, default = ["zsh", "bash", "sh"], "zsh"
        how = "zsh by default, as a login shell, so their PATH (Homebrew, Xcode's tools) is there (or bash or sh)"
        path = {"type": "string", "description": "A full path on the Mac (/Users/…), or one relative to the person's home folder (not ~/…)."}
    return [
        {
            "name": SHELL,
            "description": f"Run a command on the person's {device}, through Wysebee Agent, as the person: {how}, in a folder you give (their home folder if none). You get its exit code, output and errors (each cut at 30,000 characters). It is waited for up to timeout_secs (120 by default, 220 at most); a longer one — a build, a test run, a server — set background true and read it with dev_job. No input: never run something that waits for a key or a password. Ask before anything that deletes or changes much. {note}",
            "input_schema": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "The command line, as typed in that shell."},
                    "shell": {"type": "string", "enum": shells, "description": f"Which shell ({default} if omitted)."},
                    "cwd": {"type": "string", "description": "The folder it runs in: a full path, or one relative to the home folder."},
                    "timeout_secs": {"type": "integer", "minimum": 1, "maximum": 220, "description": "How long to wait, in seconds (120 if omitted)."},
                    "background": {"type": "boolean", "description": "Start it and answer at once with a job id."},
                },
                "required": ["command"],
            },
        },
        {
            "name": JOB,
            "description": f"A background command started with dev_shell: its status, exit code and newest output (action output, the default), stop it (stop), or list every job (list). {note}",
            "input_schema": {"type": "object", "properties": {"job": {"type": "string"}, "action": {"type": "string", "enum": ["output", "stop", "list"]}, "tail": {"type": "integer", "minimum": 1, "maximum": 30000, "description": "output: how many of its newest characters."}}},
        },
        {
            "name": "dev_read",
            "description": f"Read a text file on the person's {pc}, its lines numbered (at most 2000 at once: offset and limit read further). {note}",
            "input_schema": {"type": "object", "properties": {"path": path, "offset": {"type": "integer", "minimum": 1, "description": "The first line (1 if omitted)."}, "limit": {"type": "integer", "minimum": 1, "maximum": 2000}}, "required": ["path"]},
        },
        {
            "name": "dev_write",
            "description": f"Write a whole text file on the person's {pc} (its folders made), replacing what is there. To change part of a file, use dev_edit. {note}",
            "input_schema": {"type": "object", "properties": {"path": path, "content": {"type": "string", "description": "The file's whole text."}}, "required": ["path", "content"]},
        },
        {
            "name": "dev_edit",
            "description": f"Replace exact text in a file on the person's {pc}: old must be in it once (give enough around it), or every time with replace_all. Read the file first. {note}",
            "input_schema": {"type": "object", "properties": {"path": path, "old": {"type": "string"}, "new": {"type": "string"}, "replace_all": {"type": "boolean"}}, "required": ["path", "old", "new"]},
        },
        {
            "name": "dev_glob",
            "description": f"Find files on the person's {pc} by a path pattern (**/*.kt, app/src/**/Main*.java, *.{{gradle,kts}}) under a folder, newest first; .git, node_modules, build, .gradle and the like are skipped. {note}",
            "input_schema": {"type": "object", "properties": {"pattern": {"type": "string"}, "path": {**path, "description": "The folder to look under (the home folder if omitted)."}}, "required": ["pattern"]},
        },
        {
            "name": "dev_grep",
            "description": f"Search the text of files under a folder on the person's {pc} with a regular expression: each matching line as file:line:text (500 at most). {note}",
            "input_schema": {"type": "object", "properties": {"pattern": {"type": "string", "description": "A regular expression."}, "path": {**path, "description": "The folder to search under (the home folder if omitted)."}, "glob": {"type": "string", "description": "Only files matching this, like *.kt."}, "ignore_case": {"type": "boolean"}}, "required": ["pattern"]},
        },
        {
            "name": "dev_list",
            "description": f"List a folder on the person's {pc}: its folders, then its files and their sizes. {note}",
            "input_schema": {"type": "object", "properties": {"path": {**path, "description": "The folder (the home folder if omitted)."}}},
        },
    ]


def android_tools(device: str = MAC) -> list[dict]:
    """The Android Development Toolkit's tools, in the computer's words."""
    words, note = _words(device), _android_note(device)
    return [{"name": name, "description": f"{description.format(**words)} {note}", "input_schema": {"type": "object", "properties": props, "required": required}} for name, (description, props, required) in ANDROID_TOOLS.items()]


def _wait(args: dict) -> float:
    """How long the cloud waits for a dev_shell call: its own time, and room for the round trip."""
    secs = args.get("timeout_secs")
    own = float(secs) if isinstance(secs, (int, float)) and not isinstance(secs, bool) and not args.get("background") else 30.0
    return min(MAX_WAIT, max(CALL_TIMEOUT, own + 20.0))


def _text_of(answer: dict) -> Output:
    if not answer.get("ok"):
        return _failed(_error(answer))
    r = answer.get("result")
    if isinstance(r, dict) and set(r) == {"text"} and isinstance(r["text"], str):
        return Output(truncate(r["text"]))
    return Output(truncate(_dumps(r)))


async def call_dev(run: Run, tool: str, args: Any) -> Output:
    """One of developer access's tools: the model's arguments as they are, to its op."""
    given = dict(args) if isinstance(args, dict) else {}
    if tool == SHELL:
        return _text_of(await run(SHELL, given, _wait(given)))
    if tool == JOB:
        return _text_of(await run(JOB, given, CALL_TIMEOUT))
    return _text_of(await run(FILE_OP, {**given, "tool": FILE_TOOLS[tool]}, CALL_TIMEOUT))


def with_picture(answer: dict) -> Output:
    """A toolkit's answer, ``{text, image?: {media_type, data}}``: the text, and the picture
    as an image beside it."""
    if not answer.get("ok"):
        return _failed(_error(answer))
    r = answer.get("result") if isinstance(answer.get("result"), dict) else {}
    text = r.get("text") if isinstance(r.get("text"), str) else json.dumps(r)
    image = r.get("image")
    if isinstance(image, dict) and isinstance(image.get("data"), str) and isinstance(image.get("media_type"), str):
        return Output(truncate(f"{text}{IMAGE_ATTACHED}"), images=[{"media_type": image["media_type"], "data": image["data"]}])
    return Output(truncate(text))


async def call_android(run: Run, tool: str, args: Any) -> Output:
    """One of the Android toolkit's tools → ``android_dev`` ``{tool, args}``; a picture comes
    back as an image."""
    given = dict(args) if isinstance(args, dict) else {}
    return with_picture(await run(ANDROID_OP, {"tool": "android_" + tool.removeprefix("adb_"), "args": given}, MAX_WAIT))
