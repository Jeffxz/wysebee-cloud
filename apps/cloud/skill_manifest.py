"""A skill's ``SKILL.md``, read as Wysebee Agent for Mac and for Windows read it (their
``skills.rs``) and as the website did (ui/app/src/cloud/skillManifest.ts): **change them there,
change it here**. Front matter between two ``---`` lines — ``name``, ``description``,
``scripts`` (other keys ignored) — then the instructions. Pure, so it is tested on its own."""

import json
import re
from dataclasses import dataclass, field

NAME = re.compile(r"^[a-z][a-z0-9_-]{0,39}$")
NAME_RULE = "a skill's name starts with a lowercase letter and holds only lowercase letters, digits, '-' or '_' (40 at most)"
SCRIPT_NAME = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
MAX_SCRIPTS = 20
MAX_DESCRIPTION = 1024
MAX_TEXT = 1000
MAX_BODY = 100_000
SHAPE = "SKILL.md starts with a line '---', then 'name:' and 'description:', then another '---'."


class Unreadable(ValueError):
    """What is wrong with a SKILL.md, in a sentence to show."""


@dataclass
class Manifest:
    name: str
    description: str
    scripts: list[dict[str, str]] = field(default_factory=list)
    body: str = ""


def _unquote(raw: str) -> str:
    v = raw.strip()
    if v.startswith('"'):
        try:
            s = json.loads(v)
        except ValueError:
            s = None
        if not isinstance(s, str):
            raise Unreadable(f"The value {v} could not be read.")
        return s
    if len(v) >= 2 and v.startswith("'") and v.endswith("'"):
        return v[1:-1].replace("''", "'")
    return v


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _block(lines: list[str], at: int, under: int, style: str) -> tuple[str, int]:
    end, parts = at + 1, []
    while end < len(lines) and (not lines[end].strip() or _indent(lines[end]) > under):
        parts.append(lines[end].strip())
        end += 1
    return ("\n" if style.startswith("|") else " ").join(parts).strip(), end


def _front(text: str) -> tuple[list[str], int]:
    """The lines of the text and where its closing ``---`` is, or an :class:`Unreadable`."""
    lines = text.lstrip("﻿").replace("\r\n", "\n").split("\n")
    close = next((i for i, line in enumerate(lines[1:], 1) if line.rstrip() == "---"), 0) if lines[0].rstrip() == "---" else 0
    if close == 0:
        raise Unreadable(SHAPE)
    return lines, close


def parse(source: str, folder: str) -> Manifest:
    """``SKILL.md`` read and checked; ``folder`` is the name when the front matter has none."""
    lines, close = _front(source)
    front, body = lines[1:close], "\n".join(lines[close + 1:]).strip()
    name = description = ""
    scripts: list[dict[str, str]] = []
    in_scripts = False
    i = 0
    while i < len(front):
        line = front[i]
        t = line.strip()
        if not t or t.startswith("#"):
            i += 1
            continue
        depth = _indent(line)
        if depth == 0:
            key, sep, raw = t.partition(":")
            if not sep:
                raise Unreadable(f"The line '{t}' of SKILL.md could not be read.")
            raw = raw.strip()
            value, nxt = _block(front, i, 0, raw) if raw.startswith((">", "|")) else (_unquote(raw), i + 1)
            key = key.strip()
            in_scripts = key == "scripts"
            if key == "name":
                name = value
            elif key == "description":
                description = value
            i = nxt
            continue
        if in_scripts:
            item = t[1:] if t == "-" or t.startswith("- ") else None
            if item is not None:
                scripts.append({})
                if not item.strip():
                    i += 1
                    continue
            entry = (item if item is not None else t).strip()
            key, sep, raw = entry.partition(":")
            if not scripts or not sep:
                raise Unreadable(f"The line '{t}' of SKILL.md could not be read.")
            raw = raw.strip()
            value, nxt = _block(front, i, depth, raw) if raw.startswith((">", "|")) else (_unquote(raw), i + 1)
            scripts[-1][key.strip()] = value
            i = nxt
            continue
        i += 1
    manifest = Manifest(name or folder, description, check_scripts(scripts), body)
    check(manifest)
    return manifest


def check(m: Manifest) -> None:
    if not NAME.match(m.name):
        raise Unreadable(f"'{m.name}': {NAME_RULE}.")
    if not m.description.strip() or len(m.description) > MAX_DESCRIPTION or "\n" in m.description:
        raise Unreadable(f"'{m.name}': describe what it is for and when to use it, on one line of 1 to {MAX_DESCRIPTION} characters.")
    if len(m.body) > MAX_BODY:
        raise Unreadable(f"'{m.name}': the instructions are at most {MAX_BODY} characters.")


def check_scripts(items: list[dict[str, str]]) -> list[dict[str, str]]:
    if len(items) > MAX_SCRIPTS:
        raise Unreadable(f"A skill has at most {MAX_SCRIPTS} scripts.")
    out: list[dict[str, str]] = []
    for n, item in enumerate(items, 1):
        name, command, description = (item.get(k, "").strip() for k in ("name", "command", "description"))
        if not SCRIPT_NAME.match(name):
            raise Unreadable(f"Script {n}: its name is lowercase letters, digits and _, starting with a letter (up to 40).")
        if not command or len(command) > MAX_TEXT:
            raise Unreadable(f"Script '{name}': give the command that runs it, like 'python3 scripts/{name}.py'.")
        if split_command(command) is None:
            raise Unreadable(f"Script '{name}': a quote in its command is not closed.")
        if len(description) > MAX_TEXT:
            raise Unreadable(f"Script '{name}': the description is at most {MAX_TEXT} characters.")
        if any(s["name"] == name for s in out):
            raise Unreadable(f"Two scripts are named '{name}'.")
        out.append({"name": name, "command": command, "description": description})
    return out


def split_command(command: str) -> list[str] | None:
    """A command line as words; None when a quote is not closed."""
    words: list[str] = []
    word, quote, started = "", None, False
    for c in command:
        if quote is not None:
            if c == quote:
                quote = None
            else:
                word += c
        elif c in "\"'":
            quote, started = c, True
        elif c.isspace():
            if started or word:
                words.append(word)
            word, started = "", False
        else:
            word += c
    if quote is not None:
        return None
    if started or word:
        words.append(word)
    return words


def render(name: str, description: str, body: str) -> str:
    """A new SKILL.md: what :func:`parse` reads back."""
    return f"---\nname: {name}\ndescription: {json.dumps(description, ensure_ascii=False)}\n---\n\n{body.strip()}\n"


def with_name(source: str, name: str) -> str:
    """The SKILL.md with its front matter's ``name`` set to ``name`` — the line replaced, or
    added after the opening ``---``. Its other lines stay as they are."""
    lines, close = _front(source)
    at = next((i for i in range(1, close) if _indent(lines[i]) == 0 and lines[i].strip().partition(":")[0].strip() == "name"), None)
    if at is None:
        lines.insert(1, f"name: {name}")
    else:
        lines[at] = f"name: {name}"
    return "\n".join(lines)


def is_secret(path: str) -> bool:
    """A file that looks like it holds a key, a token or a password, by its name: never kept in
    Wysebee Cloud (skillManifest.ts ``isSecret``)."""
    file = path.rsplit("/", 1)[-1].lower()
    ext = file.rsplit(".", 1)[-1] if "." in file else ""
    return (
        file.startswith(".env")
        or ext in ("pem", "key", "p12", "pfx", "keystore", "jks", "secret", "secrets", "kdbx", "ppk")
        or file in (".npmrc", ".netrc", ".pypirc", ".git-credentials", ".htpasswd")
        or (file.startswith("id_") and not file.endswith(".pub"))
        or any(w in file for w in ("secret", "credential", "password", "token"))
    )
