"""The tools of an agent living in Wysebee Cloud (2026-10-31, the person's call), run for the
person's own AI app through Wysebee Assistant (apps/cloud/agent_mcp.py): **its skills,
read-only** — ``load_skill`` and ``skill_read_file`` over the agent's skills (apps/cloud/skills.py, their files in the
skill file store; a declared script runs only for an agent made by pairing Wysebee Agent for
Mac, on that Mac — ``skill_run_script``, apps/cloud/agent_chat/mac.py) — and **its PostgreSQL
connections kept in the cloud** (apps/cloud/agent_chat/postgres.py, 2026-10-31) — and, for an
agent made by pairing the Wysebee Agent browser extension, **the browser pack** over that one
browser (apps/cloud/agent_chat/browser.py, 2026-11-11) — and, for an agent made by pairing
Wysebee Agent for Mac, **that Mac's programs, skill scripts and folders**, run there
(apps/cloud/agent_chat/mac.py, 2026-11-13). Nothing else runs here. Widening it is a
decision, not a detail.
"""

import asyncio
import json
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession


LOAD = "load_skill"
READ = "skill_read_file"
SKILL_FILE = "SKILL.md"
# The longest text a tool answers (the desktop's 50k cap).
MAX_TEXT = 50_000


@dataclass
class Output:
    text: str
    is_error: bool = False
    # Pictures the tool returned (``[{media_type, data}]``, base64): a browser screenshot's
    # or snapshot's (apps/cloud/agent_chat/browser.py).
    images: list[dict] = field(default_factory=list)
    # Pictures for the person alone, never the model: a local folder's (mac.py).
    shown: list[dict] = field(default_factory=list)


def _ok(value: Any) -> Output:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return Output(text[:MAX_TEXT])


def _failed(text: str) -> Output:
    return Output(text, True)


# --- skills ------------------------------------------------------------------------------


@dataclass
class Skill:
    name: str
    description: str
    # [{path, id, size}], the skill's files.
    files: list[dict] = field(default_factory=list)


async def skills_of(session: AsyncSession, user_id: str, agent_id: str | None) -> list[Skill]:
    """The skills of the person's agent (apps/cloud/skills.py), in its order."""
    from apps.cloud import skills

    return [Skill(r.name, r.description, [f for f in r.files or [] if isinstance(f, dict)]) for r in await skills.of_agent(session, user_id, agent_id)]


# Were skills.rs `RUN` and `SCRIPTS_ON_MAC`; the only copy since the desktop's loop went (2026-11-13).
RUN = "skill_run_script"
SCRIPTS_ON_MAC = "its scripts run only for an agent made by pairing Wysebee Agent for Mac, Windows or Linux, not for you"


def skills_prompt(skills: list[Skill], can_run: bool = False, device: str = "Mac") -> str | None:
    """skills.rs ``prompt``: ``can_run`` for an agent made by pairing Wysebee Agent for Mac,
    whose scripts run on that Mac (apps/cloud/agent_chat/mac.py)."""
    if not skills:
        return None
    scripts = f"run its scripts with `{RUN}` when it tells you to (they run on the person's {device}, through Wysebee Agent, once the person allowed the skill there)" if can_run else SCRIPTS_ON_MAC
    lines = [f"You have skills: written instructions for particular jobs, each in a folder with its files. When a request matches a skill's description, call `{LOAD}` with its name first and follow what it says; read its files with `{READ}`; {scripts}. Your skills:"]
    lines += [f"- {s.name}: {s.description}" for s in skills]
    return "\n".join(lines)


def skill_tools(skills: list[Skill]) -> list[dict]:
    """skills.rs ``read_only_tools``: none without skills."""
    if not skills:
        return []
    skill = {"type": "string", "enum": [s.name for s in skills], "description": "The skill's name."}
    return [
        {"name": LOAD, "description": "Load one of your skills: its instructions, the files in its folder and the scripts it can run. Do this before following a skill.", "input_schema": {"type": "object", "properties": {"name": skill}, "required": ["name"]}},
        {"name": READ, "description": "Read a text file in one of your skills' folders (a template, notes, data), by its path inside the folder as load_skill lists it.", "input_schema": {"type": "object", "properties": {"skill": skill, "path": {"type": "string", "description": "The file's path inside the skill's folder, like templates/report.md."}}, "required": ["skill", "path"]}},
    ]


def _unquote(value: str) -> str:
    v = value.strip()
    if len(v) >= 2 and v[0] == v[-1] == '"':
        try:
            return json.loads(v)
        except ValueError:
            return v[1:-1]
    if len(v) >= 2 and v[0] == v[-1] == "'":
        return v[1:-1].replace("''", "'")
    return v


def parse_manifest(text: str) -> tuple[str, list[dict]]:
    """A SKILL.md's instructions and its declared scripts (``name``, ``command``,
    ``description``) — enough of skills.rs ``parse`` to show them; a file that does not
    start with front matter is all instructions."""
    lines = text.lstrip("﻿").replace("\r\n", "\n").split("\n")
    if not lines or lines[0].rstrip() != "---" or "---" not in [line.rstrip() for line in lines[1:]]:
        return text.strip(), []
    close = [line.rstrip() for line in lines[1:]].index("---") + 1
    scripts: list[dict] = []
    in_scripts = False
    for line in lines[1:close]:
        t = line.strip()
        if not t or t.startswith("#"):
            continue
        if line[0] not in " \t-":
            in_scripts = t.split(":", 1)[0].strip() == "scripts"
            continue
        if not in_scripts:
            continue
        if t == "-" or t.startswith("- "):
            scripts.append({})
            t = t[1:].strip()
        if scripts and ":" in t:
            key, value = t.split(":", 1)
            scripts[-1][key.strip()] = _unquote(value)
    return "\n".join(lines[close + 1:]).strip(), [s for s in scripts if s.get("name")]


def loaded(skill: Skill, manifest: str, can_run: bool = False, device: str = "Mac") -> str:
    """What ``load_skill`` answers: the instructions, then the files and scripts."""
    body, scripts = parse_manifest(manifest)
    out = f"# Skill: {skill.name}\n\n{skill.description}\n\n{body}"
    files = [f"- {f.get('path')} ({f.get('size', 0)} bytes)" for f in skill.files if f.get("path") != SKILL_FILE]
    if files:
        out += "\n\n## Files in its folder\n" + "\n".join(files)
    if scripts:
        listed = [f"- {s['name']} — `{s.get('command', '')}`" + (f": {s['description']}" if s.get("description") else "") for s in scripts]
        how = f"run with {RUN}, on the person's {device}" if can_run else "they run only for an agent made by pairing Wysebee Agent for Mac, Windows or Linux, not here"
        out += f"\n\n## Scripts ({how})\n" + "\n".join(listed)
    return out


async def declares_scripts(store: Any, user_id: str, skills: list[Skill]) -> bool:
    """Whether one of the skills' ``SKILL.md`` declares a script (skills.rs ``tools_for``'s
    test for ``skill_run_script``): each read from the skill file store, at once."""

    async def one(skill: Skill) -> bool:
        file = next((f for f in skill.files if f.get("path") == SKILL_FILE), None)
        data = await store.read(user_id, str(file.get("id") or "")) if file else None
        return bool(data) and b"\0" not in data and bool(parse_manifest(data.decode("utf-8", errors="replace"))[1])

    return any(await asyncio.gather(*(one(s) for s in skills)))


async def call_skill(store: Any, user_id: str, skills: list[Skill], name: str, args: dict, can_run: bool = False, device: str = "Mac") -> Output:
    """``load_skill`` / ``skill_read_file`` over the skill file store; ``can_run``: the
    agent's scripts run on its Mac."""
    wanted = str(args.get("name" if name == LOAD else "skill") or "").strip()
    skill = next((s for s in skills if s.name == wanted), None)
    if skill is None:
        return _failed(f"'{wanted}' is not one of your skills. The person adds skills to an agent in its settings, on Skills.")
    path = SKILL_FILE if name == LOAD else str(args.get("path") or "").strip().removeprefix("./").replace("\\", "/")
    file = next((f for f in skill.files if f.get("path") == path), None)
    if file is None:
        if name == LOAD:
            return _ok(loaded(skill, "", can_run, device))
        return _failed(f"There is no file '{path}' in the skill '{skill.name}'. load_skill lists its files.")
    data = await store.read(user_id, str(file.get("id") or ""))
    if data is None:
        return _failed(f"'{path}' of the skill '{skill.name}' is not in Wysebee Cloud yet: save the skill again on the website.")
    if b"\0" in data:
        return _failed(f"'{path}' is not a text file.")
    text = data.decode("utf-8", errors="replace")
    return _ok(loaded(skill, text, can_run, device) if name == LOAD else text)
