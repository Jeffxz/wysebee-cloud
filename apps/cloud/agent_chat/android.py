"""The phone pack of an agent made by pairing Wysebee Agent for Android: look at and operate
the person's phone, the one paired with this agent (apps/cloud/browser_links.py, an
``android`` link; ``docs/protocol/android.md``).

Every tool forwards its arguments, defaults filled in and absent ones left out, as the op of
the same name. ``android_snapshot`` asks for a picture too (``with_image``), and it and
``android_screenshot`` return that picture as an image beside the text, as the browser pack's
do (apps/cloud/agent_chat/browser.py, whose argument handling this reuses).

**The phone is the authority, not this module**: it refuses any app the person did not allow
there, the Wysebee Agent app itself and password fields, and a refusal comes back as an
ordinary result the model can read. Nothing here widens what it permits.
"""

import json
from typing import Any

from apps.cloud.agent_chat.browser import IMAGE_ATTACHED, Run, prepare_args, truncate
from apps.cloud.agent_chat.tools import Output

# The phone settles after each act (up to 4 s after opening an app); a snapshot may wait 10 s
# first. The protocol's suggested driver timeout.
CALL_TIMEOUT = 60.0
LINK_FIELD = "android_link"
# The tools that only look (Wysebee Assistant's call_agent_read_tool); the rest act on the phone.
READ_ONLY = frozenset({"android_apps", "android_snapshot", "android_screenshot"})

_REF = {"anyOf": [{"type": "integer"}, {"type": "null"}], "default": None}
_POINT = {"anyOf": [{"type": "integer"}, {"type": "null"}], "default": None}


def _tool(name: str, description: str, properties: dict, required: list[str] | None = None) -> dict:
    schema: dict[str, Any] = {"type": "object", "additionalProperties": False, "properties": properties}
    if required:
        schema["required"] = required
    return {"name": name, "description": description, "input_schema": schema}


TOOLS = [
    _tool(
        "android_apps",
        "List the apps you may open on the person's phone (package and label). The person chooses them in "
        "Wysebee Agent on the phone; you cannot read or touch any other app.",
        {},
    ),
    _tool(
        "android_launch",
        "Open an app on the phone by its package (from android_apps). Answers with the app now in front.",
        {"package": {"type": "string", "description": "The app's package, e.g. com.example.app."}},
        ["package"],
    ),
    _tool(
        "android_snapshot",
        "Read the phone's screen: the app in front, then one line per element you can read or act on — "
        "`[ref] Kind \"text\" (description) #view-id flags @x,y`, where @x,y is its centre in screen "
        "pixels and flags say what it does (tap, long-tap, input, scroll, checked…). A picture of the "
        "screen comes with it. Refs are valid only until the next snapshot: take a new one after "
        "every act that changes the screen.",
        {"wait_ms": {"type": "integer", "default": 0, "description": "Wait this long first (0-10000), for a screen that is still loading."}},
    ),
    _tool(
        "android_screenshot",
        "A picture of the phone's screen, scaled down. Use android_snapshot to find what to tap; use this "
        "for what a snapshot cannot read (games, pictures, custom drawing). Tap coordinates are screen "
        "pixels, not the picture's: the answer says how to convert.",
        {},
    ),
    _tool(
        "android_tap",
        "Tap an element by its ref (from the latest android_snapshot), or a point by x and y in screen "
        "pixels. long: a long press.",
        {
            "ref": {**_REF, "description": "The element's ref from the latest android_snapshot."},
            "x": {**_POINT, "description": "Screen pixels from the left (with y, instead of ref)."},
            "y": {**_POINT, "description": "Screen pixels from the top."},
            "long": {"type": "boolean", "default": False, "description": "A long press instead of a tap."},
        },
    ),
    _tool(
        "android_type",
        "Type text into a text field: the one given by ref, else the one that has focus. It replaces "
        "what is there unless clear is false. submit presses the keyboard's Enter (search, send, go). "
        "Password fields are refused: the person types those.",
        {
            "text": {"type": "string", "description": "What to type (at most 10,000 characters)."},
            "ref": {**_REF, "description": "The field's ref from the latest android_snapshot."},
            "clear": {"type": "boolean", "default": True, "description": "Replace the field's text (true) or add to it (false)."},
            "submit": {"type": "boolean", "default": False, "description": "Press Enter after typing."},
        },
        ["text"],
    ),
    _tool(
        "android_swipe",
        "Swipe from one point to another, in screen pixels (drag, pull to refresh, dismiss).",
        {
            "x1": {"type": "integer"}, "y1": {"type": "integer"}, "x2": {"type": "integer"}, "y2": {"type": "integer"},
            "duration_ms": {"type": "integer", "default": 300, "description": "How long the swipe takes (50-5000)."},
        },
        ["x1", "y1", "x2", "y2"],
    ),
    _tool(
        "android_scroll",
        "Scroll a list (given by ref, or the screen) to show more: down shows what is further down.",
        {
            "direction": {"type": "string", "enum": ["up", "down", "left", "right"]},
            "ref": {**_REF, "description": "A list, or an element in it, from the latest android_snapshot."},
        },
        ["direction"],
    ),
    _tool(
        "android_key",
        "Press one of the phone's own buttons: back, home, recents, notifications or quick_settings.",
        {"key": {"type": "string", "enum": ["back", "home", "recents", "notifications", "quick_settings"]}},
        ["key"],
    ),
]
OPS = frozenset({"ping", *(t["name"] for t in TOOLS)})

_WHAT = {
    "android_apps": "list the apps", "android_launch": "open the app", "android_snapshot": "read the screen",
    "android_screenshot": "take a screenshot", "android_tap": "tap", "android_type": "type",
    "android_swipe": "swipe", "android_scroll": "scroll", "android_key": "press the key",
}


def paired(config: dict) -> str:
    """The phone the agent was paired with ("" for none)."""
    link = config.get(LINK_FIELD)
    return link.strip() if isinstance(link, str) else ""


def tools_for(config: dict) -> list[dict]:
    """The phone pack for an agent with a phone, else nothing."""
    return [dict(t) for t in TOOLS] if paired(config) else []


def find(name: str) -> dict | None:
    return next((t for t in TOOLS if t["name"] == name), None)


def _err(code: str, message: str) -> str:
    return json.dumps({"error": code, "message": message}, separators=(",", ":"), ensure_ascii=False)


def _dumps(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def _picture(res: dict) -> dict | None:
    data = res.get("image")
    return {"media_type": "image/jpeg" if res.get("mime") == "image/jpeg" else "image/png", "data": data} if isinstance(data, str) and data else None


def _scale_note(res: dict) -> str:
    """How the picture's pixels map to the screen's, which taps use."""
    screen = res.get("screen") if isinstance(res.get("screen"), dict) else {}
    w, h, sw, sh = res.get("width"), res.get("height"), screen.get("width"), screen.get("height")
    if not all(isinstance(v, int) and not isinstance(v, bool) and v > 0 for v in (w, h, sw, sh)):
        return ""
    return f"\nThe picture is {w}x{h}; the screen is {sw}x{sh} pixels: a point (px, py) in the picture is ({sw}/{w}*px, {sh}/{h}*py) on the screen."


async def call(run: Run | None, name: str, arguments: Any) -> Output:
    """Run one phone tool through ``run`` (None: the agent has no phone now). A refusal by the
    phone is an ordinary answer, not an error; bad arguments are one."""
    tool = find(name)
    if tool is None:
        return Output(f"Unknown tool '{name}'.", True)
    try:
        args = prepare_args(tool, arguments)
    except ValueError as e:
        return Output(str(e), True)
    if run is None:
        return Output(_err("android_unavailable", "This agent has no phone now. Its phone is the one paired with it through Wysebee Agent for Android."))
    # The phone reads a key that is there as given: leave out what was not.
    args = {k: v for k, v in args.items() if v is not None}
    if name == "android_snapshot":
        args["with_image"] = True
    answer = await run(name, args, CALL_TIMEOUT)
    if not answer.get("ok"):
        message = str(answer.get("error") or "")
        if answer.get("unavailable"):
            return Output(_err("android_unavailable", message))
        return Output(_err("android_error", f"Could not {_WHAT.get(name, 'run the tool')}: {message}"))
    res = answer.get("result")
    if name == "android_snapshot" and isinstance(res, dict):
        picture = _picture(res)
        text = str(res.get("snapshot") or "")
        out = Output(f"{truncate(text)}{IMAGE_ATTACHED if picture else ''}", images=[picture] if picture else [])
        return out
    if name == "android_screenshot" and isinstance(res, dict):
        picture = _picture(res)
        rest = {k: v for k, v in res.items() if k not in ("image", "mime")}
        return Output(f"{_dumps(rest)}{_scale_note(res)}{IMAGE_ATTACHED if picture else ''}", images=[picture] if picture else [])
    return Output(truncate(_dumps(res)))
