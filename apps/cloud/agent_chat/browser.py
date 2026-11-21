"""The browser pack of an agent living in Wysebee Cloud: look at and drive the person's own
browser, the one paired with this agent through the Wysebee Agent extension
(apps/cloud/browser_links.py).

``data/browser_tools.json`` holds the tools' names, descriptions and arguments: **it must
match the ops the extension takes** (``docs/protocol/browser-extension.md``),
or a cloud agent is offered tools the browser no longer has.

Every tool forwards its arguments, defaults filled in, as the op of the same name;
``browser_snapshot`` asks for a picture too (``with_image``), and it and
``browser_screenshot`` return that picture as an image beside the text. **No recording in
the cloud**: ``record`` is never asked for. (``browser_record``, the scenario video, is
another thing: the extension films the tab and uploads the video itself —
apps/cloud/browser_recordings.py.)

**The extension is the authority, not this module**: it decides per site and per action
whether to run, ask the person, or refuse, and a refusal comes back as an ordinary result
the model can read. Nothing here widens what it permits.
"""

import json
import math
import re
from collections.abc import Awaitable, Callable
from functools import lru_cache
from pathlib import Path
from typing import Any

from apps.cloud.agent_chat.tools import Output

# Where a tool's picture sits in its text (the desktop's context.rs).
IMAGE_ATTACHED = "[image attached]"
DATA = Path(__file__).resolve().parent / "data"
# A person may have to be asked at the keyboard, so calls wait far longer than a round trip
# (tools.rs `CALL_TIMEOUT`).
CALL_TIMEOUT = 90.0
# Per tool result, so one page snapshot is not resent whole all conversation long.
MAX_TOOL_RESULT_CHARS = 50_000
PACK_BROWSER = "browser"
PACK_DEVTOOLS = "devtools"
# The settings the pack reads (docs/protocol/browser-extension.md, "The agent's settings").
LINK_FIELD = "browser_link"
ACCESS_FIELD = "browser_access"
DEVTOOLS_FIELD = "browser_devtools"
# The tools that only look: run through Wysebee Assistant's call_agent_read_tool, with no
# confirmation. Every other tool here acts in the person's browser — even scrolling or
# switching tabs changes what they see — and goes through call_agent_tool.
READ_ONLY = frozenset({
    "browser_tabs", "browser_snapshot", "browser_screenshot", "browser_bookmarks", "browser_console",
    "browser_network", "browser_network_body", "browser_inspect", "browser_audit", "browser_performance",
})

# One op on the agent's link: ``(op, args, timeout_seconds)`` →
# ``{"ok": True, "result"}`` or ``{"ok": False, "error", "unavailable"}``
# (browser_links.run_op).
Run = Callable[[str, dict, float], Awaitable[dict]]


@lru_cache
def catalog() -> list[dict]:
    """Every browser tool, in the order they are offered."""
    return json.loads((DATA / "browser_tools.json").read_text(encoding="utf-8"))["tools"]


def paired(config: dict) -> str:
    """The link the agent was paired with ("" for none), whether or not its tools are on."""
    link = config.get(LINK_FIELD)
    return link.strip() if isinstance(link, str) else ""


def link_of(config: dict) -> str:
    """The link the agent drives: "" without one, or with Browser access turned off
    (agents.rs ``browser_of``, with the link in the probe's place)."""
    return "" if config.get(ACCESS_FIELD) is False else paired(config)


def tools_for(config: dict) -> list[dict]:
    """The tools an agent with these settings has: none without a browser, the browser pack
    with one, and the web development tools too when they are on."""
    if not link_of(config):
        return []
    devtools = config.get(DEVTOOLS_FIELD) is True
    return [
        {"name": t["name"], "description": t["description"], "input_schema": t["input_schema"]}
        for t in catalog()
        if t["pack"] == PACK_BROWSER or (devtools and t["pack"] == PACK_DEVTOOLS)
    ]


def find(name: str) -> dict | None:
    return next((t for t in catalog() if t["name"] == name), None)


def _err(code: str, message: str) -> str:
    return json.dumps({"error": code, "message": message}, separators=(",", ":"), ensure_ascii=False)


_WHAT = {
    "browser_tabs": "list tabs",
    "browser_activate": "switch tab",
    "browser_snapshot": "read the page",
    "browser_screenshot": "take a screenshot",
    "browser_navigate": "navigate",
    "browser_click": "click",
    "browser_type": "type",
    "browser_open_tab": "open a tab",
    "browser_close_tab": "close the tab",
    "browser_scroll": "scroll",
    "browser_drag": "drag",
    "browser_mouse": "use the mouse",
    "browser_bookmarks": "read bookmarks",
    "browser_console": "read the console",
    "browser_network": "read network activity",
    "browser_network_body": "read the response body",
    "browser_evaluate": "run the script",
    "browser_viewport": "change the viewport",
    "browser_inspect": "inspect the element",
    "browser_audit": "audit the page",
    "browser_performance": "measure performance",
    "browser_reload": "reload",
    "browser_mock": "fake network responses",
    "browser_record": "record the tab",
}


def what(tool: str) -> str:
    """What a failed call "could not" do, worded as the model has always read it."""
    return _WHAT.get(tool, "run the tool")


def _types(schema: Any) -> list[str]:
    if not isinstance(schema, dict):
        return []
    if isinstance(schema.get("type"), str):
        return [schema["type"]]
    any_of = schema.get("anyOf")
    return [s["type"] for s in any_of if isinstance(s, dict) and isinstance(s.get("type"), str)] if isinstance(any_of, list) else []


def coerce(value: Any, schema: Any) -> Any:
    """Lax coercion, as Pydantic does for a tool call: "12" for an integer, "true" for a bool."""
    if not isinstance(value, str):
        return value
    t = value.strip()
    for kind in _types(schema):
        if kind == "integer":
            if re.fullmatch(r"[+-]?[0-9]+", t):
                return int(t)
        elif kind == "number":
            try:
                number = float(t)
            except ValueError:
                number = math.nan
            if math.isfinite(number):
                return number
        elif kind == "boolean":
            if t.lower() in ("true", "1", "yes", "on"):
                return True
            if t.lower() in ("false", "0", "no", "off"):
                return False
        elif kind == "string":
            return value
    return value


def prepare_args(tool: dict, given: Any) -> dict:
    """The op's arguments: every parameter, given or defaulted from the tool's schema. An
    unknown or missing-required argument is refused (:class:`ValueError`) before anything
    reaches the browser."""
    if not isinstance(given, dict):
        raise ValueError("The tool arguments were not a valid JSON object.")
    schema = tool["input_schema"]
    props = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
    required = [r for r in schema.get("required") or [] if isinstance(r, str)]
    unknown = next((k for k in given if k not in props), None)
    if unknown is not None:
        raise ValueError(f"Error calling tool '{tool['name']}': unexpected argument '{unknown}'.")
    out = {}
    for name, prop in props.items():
        if name in given:
            out[name] = coerce(given[name], prop)
        elif name in required:
            raise ValueError(f"Error calling tool '{tool['name']}': missing required argument '{name}'.")
        else:
            out[name] = prop.get("default") if isinstance(prop, dict) else None
    return out


def truncate(text: str) -> str:
    if len(text) <= MAX_TOOL_RESULT_CHARS:
        return text
    return f"{text[:MAX_TOOL_RESULT_CHARS]}\n…[truncated at {MAX_TOOL_RESULT_CHARS} characters]"


def _dumps(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def _media(mime: Any) -> str:
    return "image/jpeg" if mime == "image/jpeg" else "image/png"


async def call(run: Run | None, name: str, arguments: Any) -> Output:
    """Run one browser tool through ``run`` (None: the agent has no browser now). A refusal
    by the browser is an ordinary answer, not an error; bad arguments are one."""
    tool = find(name)
    if tool is None:
        return Output(f"Unknown tool '{name}'.", True)
    try:
        args = prepare_args(tool, arguments)
    except ValueError as e:
        return Output(str(e), True)
    if run is None:
        return Output(_err("browser_unavailable", "This agent has no browser now. Its browser is the one paired with it through the Wysebee Agent extension, with Browser access on in its settings, on Tools."))
    if name == "browser_snapshot":
        args["with_image"] = True
    answer = await run(name, args, CALL_TIMEOUT)
    if not answer.get("ok"):
        message = str(answer.get("error") or "")
        if answer.get("unavailable"):
            return Output(_err("browser_unavailable", message))
        return Output(_err("browser_error", f"Could not {what(name)}: {message}"))
    res = answer.get("result")
    out: Output
    if name == "browser_screenshot":
        shot = res if isinstance(res, dict) else {}
        data = shot.get("image") if isinstance(shot.get("image"), str) else None
        # An extension older than 0.1.8 sends the raw PNG under "png".
        image = {"media_type": _media(shot.get("mime")), "data": data} if data is not None else {"media_type": "image/png", "data": shot.get("png") if isinstance(shot.get("png"), str) else ""}
        out = Output(IMAGE_ATTACHED, images=[image])
    elif name == "browser_snapshot" and isinstance(res, dict):
        rest = {k: v for k, v in res.items() if k not in ("image", "mime")}
        picture = res.get("image")
        if isinstance(picture, str) and picture:
            out = Output(f"{_dumps(rest)}{IMAGE_ATTACHED}", images=[{"media_type": _media(res.get("mime")), "data": picture}])
        else:
            out = Output(_dumps(rest))
    else:
        out = Output(_dumps(res))
    out.text = truncate(out.text)
    return out
