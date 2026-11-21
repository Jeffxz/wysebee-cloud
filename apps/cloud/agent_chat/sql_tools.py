"""SQL Query tools (2026-11-17, the person's call): a tool the person writes — a name, what it
computes, its input parameters and a SQL template — that runs on one of their database
connections (a ``postgres`` or ``snowflake`` tool, apps/cloud/user_tools.py).

**Connections are not tools the AI sees** since then: an agent's connections are set on its
General tab, and the AI reaches a database only through the SQL Query tools the person wrote.
A SQL tool is offered to an agent only while that agent has the tool's connection.

The template:

- ``{name}`` is one of the tool's parameters. **Its value is always bound** (``$n`` for
  PostgreSQL, ``?`` with Snowflake's bindings), never written into the SQL, so no value can
  change the statement.
- ``{database}`` is the connection's database name, written in as an identifier.
- ``[[ ... ]]`` is a part kept only when every parameter in it has a value: what a parameter
  that **only filters when set** sits in, e.g. ``WHERE 1 = 1 [[AND building_id = {building_id}]]``.
  Such a parameter may appear nowhere else.

A parameter with no value takes its default; one still without a value is an error when it is
required, else NULL (outside ``[[ ]]``).
"""

import re
import uuid
from dataclasses import dataclass
from datetime import date
from typing import Any

from apps.cloud.agent_chat.postgres import MAX_SQL_CHARS, Invalid

# Letters, digits, _ and -; starting and ending with a letter, digit or _ (what Claude's and
# OpenAI's tool names allow), at most 64.
NAME = re.compile(r"[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,62}[A-Za-z0-9_])?")
PARAM = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,63}")
PLACEHOLDER = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")
OPTIONAL = re.compile(r"\[\[(.*?)\]\]", re.S)
IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_$]*")
DATABASE = "database"
TYPES = ("string", "integer", "number", "boolean", "date")
MAX_PARAMS = 30
MAX_DESCRIPTION = 1_000
MAX_PARAM_DESCRIPTION = 500
MAX_DEFAULT = 1_000
MAX_VALUE = 10_000
# Snowflake's binding type for each.
SNOWFLAKE_TYPES = {"string": "TEXT", "integer": "FIXED", "number": "REAL", "boolean": "BOOLEAN", "date": "DATE"}
JSON_TYPES = {"string": "string", "integer": "integer", "number": "number", "boolean": "boolean", "date": "string"}
# A value to check a statement with, where a parameter has no default.
SAMPLE = {"string": "", "integer": "0", "number": "0", "boolean": "false", "date": "2000-01-01"}


@dataclass(frozen=True)
class Param:
    name: str
    type: str
    description: str
    required: bool
    default: str | None
    # Only filter when set: the parameter sits in [[ ]] and the part goes when it has no value.
    optional: bool


@dataclass(frozen=True)
class SqlTool:
    name: str
    description: str
    connection_id: str
    params: tuple[Param, ...]
    sql: str

    def config(self) -> dict[str, Any]:
        """The tool's ``config`` as it is kept."""
        return {
            "connection_id": self.connection_id,
            "params": [
                {"name": p.name, "type": p.type, "description": p.description, "required": p.required, "default": p.default, "optional": p.optional}
                for p in self.params
            ],
            "sql": self.sql,
        }


def valid_name(name: str) -> bool:
    return NAME.fullmatch(name) is not None


def _bool(entry: dict, key: str) -> bool:
    v = entry.get(key, False)
    if not isinstance(v, bool):
        raise Invalid(f"'{key}' is true or false.")
    return v


def value_of(p: Param, raw: Any) -> str:
    """A value as it is bound: text, checked against the parameter's type."""
    if p.type == "boolean":
        if isinstance(raw, bool):
            return "true" if raw else "false"
        if isinstance(raw, str) and raw.strip().lower() in ("true", "false"):
            return raw.strip().lower()
        raise Invalid(f"'{p.name}' is true or false.")
    if p.type == "integer":
        if isinstance(raw, bool):
            raise Invalid(f"'{p.name}' is a whole number.")
        if isinstance(raw, int):
            return str(raw)
        if isinstance(raw, float) and raw.is_integer():
            return str(int(raw))
        if isinstance(raw, str) and re.fullmatch(r"\s*-?\d{1,30}\s*", raw):
            return raw.strip()
        raise Invalid(f"'{p.name}' is a whole number.")
    if p.type == "number":
        if isinstance(raw, bool):
            raise Invalid(f"'{p.name}' is a number.")
        if isinstance(raw, (int, float)):
            return repr(raw)
        if isinstance(raw, str) and re.fullmatch(r"\s*-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*", raw):
            return raw.strip()
        raise Invalid(f"'{p.name}' is a number.")
    if p.type == "date":
        try:
            return date.fromisoformat(str(raw).strip()).isoformat() if isinstance(raw, str) else _no_date(p)
        except ValueError:
            return _no_date(p)
    if not isinstance(raw, (str, int, float)) or isinstance(raw, bool):
        raise Invalid(f"'{p.name}' is text.")
    text = str(raw)
    if len(text) > MAX_VALUE:
        raise Invalid(f"'{p.name}' is at most {MAX_VALUE} characters.")
    return text


def _no_date(p: Param) -> str:
    raise Invalid(f"'{p.name}' is a date, like 2026-11-17.")


def _param(entry: Any) -> Param:
    if not isinstance(entry, dict):
        raise Invalid("Each parameter has a name and a type.")
    name = str(entry.get("name") or "").strip()
    if PARAM.fullmatch(name) is None:
        raise Invalid("A parameter's name is a letter or _, then letters, digits or _, at most 64.")
    if name == DATABASE:
        raise Invalid("'database' is the connection's database name: give the parameter another name.")
    kind = entry.get("type")
    if kind not in TYPES:
        raise Invalid(f"'{name}' is one of {', '.join(TYPES)}.")
    description = str(entry.get("description") or "").strip()
    if len(description) > MAX_PARAM_DESCRIPTION or "\n" in description:
        raise Invalid(f"Say what '{name}' is on one line of at most {MAX_PARAM_DESCRIPTION} characters.")
    optional, required = _bool(entry, "optional"), _bool(entry, "required")
    if optional and required:
        raise Invalid(f"'{name}' only filters when set, so it cannot be required.")
    raw = entry.get("default")
    default = None if raw is None or raw == "" else raw
    p = Param(name, kind, description, required, None, optional)
    if default is not None:
        if isinstance(default, str) and len(default) > MAX_DEFAULT:
            raise Invalid(f"'{name}''s default is at most {MAX_DEFAULT} characters.")
        p = Param(name, kind, description, required, value_of(p, default), optional)
    return p


def check_template(sql: str, params: tuple[Param, ...]) -> None:
    """Every placeholder a parameter (or ``{database}``), every parameter used, ``[[ ]]`` whole
    and not nested, and a parameter that only filters when set only inside ``[[ ]]``."""
    names = {p.name for p in params}
    unknown = sorted({n for n in PLACEHOLDER.findall(sql) if n not in names and n != DATABASE})
    if unknown:
        raise Invalid(f"The SQL uses {', '.join('{' + n + '}' for n in unknown)}, which is not a parameter: add it, or take it out.")
    unused = [p.name for p in params if "{" + p.name + "}" not in sql]
    if unused:
        raise Invalid(f"The SQL does not use {', '.join('{' + n + '}' for n in unused)}.")
    outside = OPTIONAL.sub("", sql)
    for block in OPTIONAL.findall(sql):
        if "[[" in block:
            raise Invalid("A [[ ]] part cannot hold another.")
        if not any(p.optional and "{" + p.name + "}" in block for p in params):
            raise Invalid("Each [[ ]] part holds a parameter that only filters when set.")
    if "[[" in outside or "]]" in outside:
        raise Invalid("Each [[ is closed by ]].")
    for p in params:
        if p.optional and "{" + p.name + "}" in outside:
            raise Invalid(f"'{p.name}' only filters when set, so it goes inside [[ ]]: [[AND column = {{{p.name}}}]].")


def parse(name: str, description: str, config: dict[str, Any]) -> SqlTool:
    """A SQL tool as the editor sends it, or :class:`Invalid` saying what is wrong."""
    if not valid_name(name):
        raise Invalid("Its name has letters, digits, underscores and hyphens, starts and ends with a letter, digit or underscore, and is at most 64 characters.")
    description = description.strip()
    if not description or len(description) > MAX_DESCRIPTION:
        raise Invalid(f"Say what the tool computes, in at most {MAX_DESCRIPTION} characters: the AI picks the tool by it.")
    connection = config.get("connection_id")
    try:
        connection_id = str(uuid.UUID(str(connection)))
    except ValueError:
        raise Invalid("Pick the database connection it queries.") from None
    raw = config.get("params") or []
    if not isinstance(raw, list) or len(raw) > MAX_PARAMS:
        raise Invalid(f"A tool has at most {MAX_PARAMS} parameters.")
    params = tuple(_param(p) for p in raw)
    seen: set[str] = set()
    for p in params:
        if p.name in seen:
            raise Invalid(f"Two parameters are named '{p.name}'.")
        seen.add(p.name)
    sql = str(config.get("sql") or "").strip()
    if not sql:
        raise Invalid("Write the SQL it runs.")
    if len(sql) > MAX_SQL_CHARS:
        raise Invalid(f"The SQL is longer than {MAX_SQL_CHARS} characters.")
    check_template(sql, params)
    return SqlTool(name, description, connection_id, params, sql)


def input_schema(tool: SqlTool) -> dict[str, Any]:
    """The tool's input as the AI reads it."""
    props: dict[str, Any] = {}
    for p in tool.params:
        prop: dict[str, Any] = {"type": JSON_TYPES[p.type]}
        if p.type == "date":
            prop["format"] = "date"
        words = [p.description] if p.description else []
        if p.optional:
            words.append("Leave it out to not filter by it.")
        if p.default is not None:
            words.append(f"Default: {p.default}.")
        if words:
            prop["description"] = " ".join(words)
        props[p.name] = prop
    required = [p.name for p in tool.params if p.required and p.default is None]
    schema: dict[str, Any] = {"type": "object", "properties": props}
    if required:
        schema["required"] = required
    return schema


def tool_def(tool: SqlTool, engine: str) -> dict[str, Any]:
    return {"name": tool.name, "description": f"{tool.description}\n\n(A SQL query on the person's {engine} database.)", "input_schema": input_schema(tool)}


def identifier(name: str) -> str:
    """A database name written in as an identifier: as it is when plain, else quoted."""
    return name if IDENTIFIER.fullmatch(name) else '"' + name.replace('"', '""') + '"'


@dataclass(frozen=True)
class Rendered:
    sql: str
    # Each placeholder's value in order (a Snowflake ``?`` each), and its type.
    values: list[tuple[str, str | None]]


def render(tool: SqlTool, args: dict[str, Any], engine: str, database: str, sample: bool = False) -> Rendered:
    """The statement to send and its values: ``$n`` placeholders for PostgreSQL (the same
    ``$n`` each time a parameter repeats), ``?`` for Snowflake. ``sample``: every part kept and
    every parameter given (its default, else a sample value), to check the statement."""
    values: dict[str, str | None] = {}
    for p in tool.params:
        raw = args.get(p.name)
        if raw is None or (raw == "" and p.type != "string"):
            v = p.default
        else:
            v = value_of(p, raw)
        if v is None and sample:
            v = SAMPLE[p.type]
        if v is None and p.required:
            raise Invalid(f"Give '{p.name}'.")
        values[p.name] = v
    types = {p.name: p.type for p in tool.params}

    def keep(m: re.Match) -> str:
        block = m.group(1)
        used = PLACEHOLDER.findall(block)
        return block if all(n == DATABASE or values.get(n) is not None for n in used) else ""

    sql = OPTIONAL.sub(keep, tool.sql)
    out: list[tuple[str, str | None]] = []
    numbers: dict[str, int] = {}

    def put(m: re.Match) -> str:
        n = m.group(1)
        if n == DATABASE:
            return identifier(database)
        if engine == "postgres":
            if n not in numbers:
                out.append((types[n], values[n]))
                numbers[n] = len(out)
            return f"${numbers[n]}"
        out.append((types[n], values[n]))
        return "?"

    return Rendered(PLACEHOLDER.sub(put, sql).strip(), out)


def snowflake_bindings(values: list[tuple[str, str | None]]) -> dict[str, dict[str, Any]]:
    return {str(i): {"type": SNOWFLAKE_TYPES[t], "value": v} for i, (t, v) in enumerate(values, start=1)}
