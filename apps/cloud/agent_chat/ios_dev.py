"""A Mac's agent and the iPhones and simulators there (2026-11-17, the owner's call;
``docs/protocol/computer.md``): **the iPhone Development Toolkit** (``ios_toolkit``
in the agent's settings, tool kind ``ios_toolkit``, migration 0072), through its link
(``mac_link``).

Thirteen tools, named ``xcode_*`` here, each → the op ``ios_dev`` ``{tool: "ios_*", args}``,
the names the Mac's toolkit has: **look** — the simulators and iPhones, a simulator's
screenshot (a picture for the model, as ``adb_screenshot``'s), its log, the apps on a simulator
or an iPhone, a device's details; **operate** — boot or shut down a simulator, open a link in
one, launch or stop an app, set a simulator's light or dark appearance; **change** — install or
uninstall an app. Simulators through Xcode's ``simctl``, iPhones through ``devicectl``. Nothing
taps a simulator (Screen control does, on the Simulator window); no iPhone screenshot or log
(devicectl has none).

Only a Mac's agent is offered them (Xcode is the Mac's; the Windows type lists neither the op
nor the kind). Wysebee Agent for Mac answers them only while the person has turned on "Let
Wysebee use iPhones and simulators on this Mac" there. **This is the only copy of the tools'
words.**
"""

from typing import Any

from apps.cloud.agent_chat.pc_dev import MAX_WAIT, with_picture
from apps.cloud.agent_chat.mac import Run
from apps.cloud.agent_chat.tools import Output

IOS_FIELD = "ios_toolkit"
IOS_OP = "ios_dev"
PREFIX = "xcode_"
NOTE = "It works only while the person has turned on \"Let Wysebee use iPhones and simulators on this Mac\" in Wysebee Agent on the Mac; if it is off, say so and ask them."
_UDID = {"type": "string", "description": "Which simulator or iPhone, by its udid (or name) from xcode_devices; not needed when exactly one is ready."}
_BUNDLE = {"type": "string", "description": "The app's bundle id, like com.example.MyApp (xcode_apps lists them)."}

IOS_TOOLS: dict[str, tuple[str, dict, list[str]]] = {}


def _ios(name: str, description: str, properties: dict | None = None, required: list[str] | None = None, udid: bool = True) -> None:
    IOS_TOOLS[name] = (description, {**({"udid": _UDID} if udid else {}), **(properties or {})}, required or [])


_ios("xcode_devices", "List the person's Mac's iOS simulators and the iPhones paired with it: each one's udid, name, iOS version, kind (simulator or iphone) and state (a simulator Booted or Shutdown; an iPhone connected or not). Needs Xcode on the Mac.", udid=False)
_ios("xcode_screenshot", "Take a screenshot of a booted iOS simulator on the person's Mac; you see it. Simulators only (an iPhone's screen cannot be captured). To tap or type in a simulator, use Screen control on the Simulator window, if the agent has it.")
_ios("xcode_logs", "Read a booted iOS simulator's log, newest last: the last few minutes, only one app's lines, only lines containing some text. Simulators only.", {"process": {"type": "string", "description": "Only this app's lines, by its name as the log has it, like MyApp."}, "minutes": {"type": "integer", "minimum": 1, "maximum": 60, "description": "How many of the last minutes (5 if omitted)."}, "contains": {"type": "string", "description": "Only lines containing this (case does not matter)."}})
_ios("xcode_apps", "List the apps on an iOS simulator (by bundle id) or a paired iPhone (bundle id and name); only those containing some text.", {"contains": {"type": "string", "description": "Only apps whose line contains this (case does not matter)."}})
_ios("xcode_info", "An iOS simulator's or a paired iPhone's details: for a simulator its udid, name, iOS version and state; for an iPhone what Xcode knows of it (model, iOS version, capacity and more).")
_ios("xcode_boot", "Boot an iOS simulator on the person's Mac (the Simulator app shows it once opened). Simulators only.")
_ios("xcode_shutdown", "Shut down a booted iOS simulator on the person's Mac. Simulators only.")
_ios("xcode_open_url", "Open a link in a booted iOS simulator: a web page in Safari, or an app's own link (myapp://…). Simulators only.", {"url": {"type": "string", "description": "The link, like https://example.com or myapp://settings."}}, ["url"])
_ios("xcode_launch", "Launch an app on a booted iOS simulator or a paired iPhone by its bundle id (an app already running is started again).", {"bundle_id": _BUNDLE}, ["bundle_id"])
_ios("xcode_terminate", "Stop an app running on a booted iOS simulator. Simulators only.", {"bundle_id": _BUNDLE}, ["bundle_id"])
_ios("xcode_appearance", "Set a booted iOS simulator's appearance to light or dark mode. Simulators only.", {"mode": {"type": "string", "enum": ["light", "dark"], "description": "light or dark."}}, ["mode"])
_ios("xcode_install", "Install (or update) an app on an iOS simulator or a paired iPhone from the person's Mac: for a simulator, a simulator build's .app folder (like Library/Developer/Xcode/DerivedData/MyApp-…/Build/Products/Debug-iphonesimulator/MyApp.app); for an iPhone, a signed .app or .ipa.", {"app": {"type": "string", "description": "The .app folder or .ipa file on the Mac: a full path, or one relative to the person's home folder (not ~/…)."}}, ["app"])
_ios("xcode_uninstall", "Uninstall an app from an iOS simulator or a paired iPhone by its bundle id. Ask the person first: its data goes with it.", {"bundle_id": _BUNDLE}, ["bundle_id"])

# What only looks: Wysebee Assistant's call_agent_read_tool may run these.
READ_ONLY = frozenset({"xcode_devices", "xcode_screenshot", "xcode_logs", "xcode_apps", "xcode_info"})


def ios_tools() -> list[dict]:
    """The iPhone Development Toolkit's tools (a Mac's agent only)."""
    return [{"name": name, "description": f"{description} {NOTE}", "input_schema": {"type": "object", "properties": props, "required": required}} for name, (description, props, required) in IOS_TOOLS.items()]


async def call_ios(run: Run, tool: str, args: Any) -> Output:
    """One of the iPhone toolkit's tools → ``ios_dev`` ``{tool, args}``, the model's arguments
    as they are; a screenshot comes back as an image."""
    given = dict(args) if isinstance(args, dict) else {}
    return with_picture(await run(IOS_OP, {"tool": "ios_" + tool.removeprefix(PREFIX), "args": given}, MAX_WAIT))
