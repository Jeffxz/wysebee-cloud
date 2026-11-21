"""PostgreSQL for an agent living in Wysebee Cloud (2026-10-31, the person's call):
``postgres_schema`` and ``postgres_query``, run by Wysebee Cloud itself, over the person's
connections (``postgres`` tools, apps/cloud/user_tools.py).

What the cloud adds, because it runs them on its own network:

- **Public addresses only** (:func:`public_address`). The host is looked up first, and a
  name with any address that is not public — loopback, private, link-local (the cloud's
  metadata address among them), shared, multicast, reserved — is refused. The connection
  then goes to **the address that was checked** (libpq's ``hostaddr``), the name kept only
  for the server's certificate, so a name that answers differently a moment later cannot
  reach Wysebee Cloud's own network.
- **TLS always**: ``verify`` (the default) checks the server's certificate against the
  system's roots and its name (libpq's ``verify-full``); ``require`` encrypts without
  checking who answers. Never in the clear: every connection crosses the internet.
- **At most** :data:`CALLS_PER_MINUTE` calls a minute for each person, on each replica.

Read only unless the connection allows changes (the session opened with
``default_transaction_read_only=on`` and each statement in ``START TRANSACTION READ ONLY``,
rolled back after); one statement a call (sent with the extended protocol, which refuses
several); at most :data:`TIME_LIMIT` for the statement and :data:`TOTAL_LIMIT` for the
call; at most :data:`MAX_ROWS` rows, every value as PostgreSQL's own text; a fresh
connection each call, closed after.
"""

import asyncio
import ipaddress
import json
import re
import socket
import time
from collections import defaultdict, deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg import generators, pq

from apps.cloud.agent_chat.tools import MAX_TEXT, Output

SCHEMA = "postgres_schema"
QUERY = "postgres_query"
MAX_CONNECTIONS = 10
MAX_DESCRIPTION = 1_000
MAX_ROWS = 200
# A value longer than this is cut, as the desktop's are.
MAX_VALUE_CHARS = 2_000
MAX_SQL_CHARS = 100_000
# Rows stop once the answer would pass this, so it stays whole JSON under the tool cap.
MAX_ANSWER_CHARS = MAX_TEXT - 2_000
MAX_TABLES = 200
# A user name, longer than PostgreSQL's own 63 for hosted services whose proxy takes longer ones
# (Prisma Postgres's, 64).
MAX_USER = 255
DEFAULT_PORT = 5432
CONNECT_LIMIT = 10.0
TIME_LIMIT = 30.0
TOTAL_LIMIT = 45.0
CALLS_PER_MINUTE = 60
SSL_MODES = ("verify", "require")
# libpq's sslmode for each (the test suite's own database has no TLS).
LIBPQ_SSLMODE = {"verify": "verify-full", "require": "require"}

# The tables and columns of the schemas a person made (not PostgreSQL's own).
SCHEMA_SQL = (
    "SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.is_nullable "
    "FROM information_schema.columns c "
    "WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema') AND c.table_schema NOT LIKE 'pg_toast%' "
    "ORDER BY c.table_schema, c.table_name, c.ordinal_position"
)

NAME = re.compile(r"[a-z][a-z0-9_]{0,29}")
# A host name or an address: never a comma (libpq's list of hosts), a space or a slash (a
# Unix socket's directory).
HOST = re.compile(r"[A-Za-z0-9.\-:]{1,255}")
NOT_PUBLIC = "Wysebee Cloud reaches only databases with a public address; {host} is not one."


@dataclass(frozen=True)
class Connection:
    name: str
    description: str
    host: str
    port: int
    database: str
    user: str
    ssl: str
    changes: bool


@dataclass(frozen=True)
class Limits:
    connect: float = CONNECT_LIMIT
    statement: float = TIME_LIMIT
    total: float = TOTAL_LIMIT


class Invalid(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def valid_name(name: str) -> bool:
    return NAME.fullmatch(name) is not None


def _word(entry: dict, key: str, what: str, most: int) -> str:
    v = str(entry.get(key) or "").strip()
    if not v or len(v) > most or any(c.isspace() for c in v):
        raise Invalid(f"Give its {what} (no spaces, at most {most} characters).")
    return v


def parse(name: str, entry: dict) -> Connection:
    """A connection as the dialog sends it, checked as the desktop's ``parse_one``, with
    TLS ``verify`` or ``require`` only."""
    if not valid_name(name):
        raise Invalid("Its name is a lowercase letter, then lowercase letters, digits or _, at most 30.")
    description = str(entry.get("description") or "").strip()
    if len(description) > MAX_DESCRIPTION:
        raise Invalid(f"Say what it holds in at most {MAX_DESCRIPTION} characters.")
    port = entry.get("port")
    if port is None:
        port = DEFAULT_PORT
    elif isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise Invalid("Its port is a number from 1 to 65535.")
    ssl = str(entry.get("ssl") or "verify")
    if ssl not in SSL_MODES:
        raise Invalid("Its TLS is verify or require: Wysebee Cloud never connects in the clear.")
    changes = entry.get("changes")
    if changes is None:
        changes = False
    elif not isinstance(changes, bool):
        raise Invalid("'changes' is true or false.")
    host = _word(entry, "host", "server's host", 255)
    if HOST.fullmatch(host) is None:
        raise Invalid("Its host is a name like db.example.com, or an address.")
    if not _maybe_public(host):
        raise Invalid(NOT_PUBLIC.format(host=host))
    return Connection(name, description, host, port, _word(entry, "database", "database's name", 63), _word(entry, "user", "user name", MAX_USER), ssl, changes)


def is_public(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """A public address: not loopback, private, link-local, shared, multicast or reserved —
    an IPv4 address inside IPv6 judged as itself."""
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def _maybe_public(host: str) -> bool:
    """What a save can tell without looking the name up: an address, or localhost."""
    if host.rstrip(".").lower() == "localhost" or host.lower().endswith(".localhost"):
        return False
    try:
        return is_public(ipaddress.ip_address(host))
    except ValueError:
        return True


async def lookup(host: str) -> list[str]:
    """Every address the host has (the test suite stands in its own)."""
    infos = await asyncio.get_running_loop().getaddrinfo(host, None, type=socket.SOCK_STREAM)
    return [str(info[4][0]) for info in infos]


async def public_address(host: str) -> str:
    """The address to connect to: the host's own, once every address it has is public."""
    try:
        found = [ipaddress.ip_address(host)]
    except ValueError:
        try:
            found = [ipaddress.ip_address(a) for a in await lookup(host)]
        except OSError:
            found = []
        if not found:
            raise Invalid(f"PostgreSQL: {host} could not be found.") from None
    if not all(is_public(ip) for ip in found):
        raise Invalid(NOT_PUBLIC.format(host=host))
    return str(found[0])


def _db_error(exc: Exception) -> str:
    """The server's error as the model reads it: PostgreSQL's own message when there is one."""
    diag = getattr(exc, "diag", None)
    primary = diag.message_primary if diag is not None else None
    return f"PostgreSQL: {primary or str(exc).strip() or type(exc).__name__}"


async def connect(c: Connection, password: str | None, limits: Limits = Limits()) -> psycopg.AsyncConnection:
    """Open a connection for one call: read-only sessions where changes are not allowed."""
    address = await public_address(c.host)
    options = f"-c statement_timeout={int(limits.statement * 1000)} -c client_encoding=UTF8"
    if not c.changes:
        options += " -c default_transaction_read_only=on"
    params: dict[str, Any] = {
        "host": c.host,
        "hostaddr": address,
        "port": c.port,
        "dbname": c.database,
        "user": c.user,
        "application_name": "Wysebee",
        "connect_timeout": max(1, int(limits.connect)),
        "options": options,
        "sslmode": LIBPQ_SSLMODE[c.ssl],
        "gssencmode": "disable",
        "autocommit": True,
    }
    if params["sslmode"] == "verify-full":
        # The system's roots (libpq refuses them beside a weaker mode).
        params["sslrootcert"] = "system"
    if password:
        params["password"] = password
    try:
        return await asyncio.wait_for(psycopg.AsyncConnection.connect(**params), limits.connect)
    except TimeoutError:
        raise Invalid(f"PostgreSQL: {c.host}:{c.port} did not answer within {int(limits.connect)} seconds.") from None
    except psycopg.Error as exc:
        raise Invalid(_db_error(exc)) from None


def _cut(value: bytes | None) -> str | None:
    if value is None:
        return None
    text = value.decode("utf-8", errors="replace")
    return text if len(text) <= MAX_VALUE_CHARS else text[:MAX_VALUE_CHARS] + "…"


async def _collect(conn: psycopg.AsyncConnection, sql: str, params: list[str | None] | None = None) -> dict[str, Any]:
    """One statement, row by row: the extended protocol refuses several, and every value
    comes back as PostgreSQL's text. Rows stop at :data:`MAX_ROWS` or
    :data:`MAX_ANSWER_CHARS`; the rest is never read (the connection closes after)."""
    pgconn = conn.pgconn
    pgconn.send_query_params(sql.encode(), [None if v is None else v.encode() for v in params] if params else None)
    pgconn.set_single_row_mode()
    await conn.wait(generators.send(pgconn))
    columns: list[str] = []
    rows: list[list[str | None]] = []
    truncated, affected, size, error = False, 0, 0, None
    while (res := await conn.wait(generators.fetch(pgconn))) is not None:
        status = res.status
        if status in (pq.ExecStatus.SINGLE_TUPLE, pq.ExecStatus.TUPLES_OK):
            if not columns:
                columns = [(res.fname(i) or b"").decode() for i in range(res.nfields)]
            if status == pq.ExecStatus.SINGLE_TUPLE:
                if len(rows) >= MAX_ROWS or size >= MAX_ANSWER_CHARS:
                    truncated = True
                    break
                values = [_cut(res.get_value(0, i)) for i in range(res.nfields)]
                size += len(json.dumps(values, ensure_ascii=False)) + 1
                rows.append(values)
        elif status == pq.ExecStatus.COMMAND_OK:
            affected = res.command_tuples or 0
        elif error is None:
            error = (res.error_field(pq.DiagnosticField.MESSAGE_PRIMARY) or res.error_message or b"").decode(errors="replace").strip()
    if error is not None:
        raise Invalid(f"PostgreSQL: {error}")
    return {"columns": columns, "rows": rows, "truncated": truncated} if columns else {"rows_affected": affected}


async def run_sql(conn: psycopg.AsyncConnection, sql: str, read_only: bool, params: list[str | None] | None = None) -> dict[str, Any]:
    """Inside a read-only transaction where changes are not allowed, rolled back after;
    ``params`` the values of ``$1``, ``$2``… as text (a SQL Query tool's, sql_tools.py)."""
    try:
        if read_only:
            await conn.execute("START TRANSACTION READ ONLY")
        return await _collect(conn, sql, params)
    except psycopg.Error as exc:
        raise Invalid(_db_error(exc)) from None


def tables_of(listed: dict[str, Any]) -> dict[str, Any]:
    """The schema tool's answer: each table with its columns, from :data:`SCHEMA_SQL`."""
    tables: list[tuple[str, list[dict]]] = []
    for row in listed.get("rows", []):
        table = f"{row[0]}.{row[1]}"
        column = {"name": row[2], "type": row[3], "nullable": row[4] == "YES"}
        if tables and tables[-1][0] == table:
            tables[-1][1].append(column)
        elif len(tables) >= MAX_TABLES:
            break
        else:
            tables.append((table, [column]))
    more = len(tables) >= MAX_TABLES or listed.get("truncated") is True
    return {"tables": [{"table": t, "columns": cols} for t, cols in tables], "more": more}


def tool_defs(connections: list[Connection]) -> list[dict]:
    """The desktop's ``tools_for``, word for word: none without a connection."""
    if not connections:
        return []
    lines = []
    for c in connections:
        mode = "read and write" if c.changes else "read only"
        what = f" — {c.description}" if c.description else ""
        lines.append(f"- {c.name} ({mode}): database {c.database} on {c.host}{what}")
    note = "The person's PostgreSQL databases:\n" + "\n".join(lines)
    which = {"type": "string", "enum": [c.name for c in connections], "description": "Which connection, by its name."}
    return [
        {
            "name": SCHEMA,
            "description": f"List the tables of one of the person's PostgreSQL databases, with each table's columns and types. Start here before writing a query.\n\n{note}",
            "input_schema": {"type": "object", "properties": {"database": which}, "required": ["database"]},
        },
        {
            "name": QUERY,
            "description": f"Run one SQL statement on one of the person's PostgreSQL databases and get its rows (at most {MAX_ROWS}, every value as text) or how many rows it changed. A read-only connection runs it in a read-only transaction, so only reads work there; change data only where the person allows changes and asked for it. One statement per call, at most {int(TIME_LIMIT)} seconds.\n\n{note}",
            "input_schema": {
                "type": "object",
                "properties": {"database": which, "sql": {"type": "string", "description": "One SQL statement, values written in it (no $1 parameters)."}},
                "required": ["database", "sql"],
            },
        },
    ]


class RateLimit:
    """At most ``per_minute`` calls in any minute, for each person."""

    def __init__(self, per_minute: int = CALLS_PER_MINUTE) -> None:
        self.per_minute = per_minute
        self.calls: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, user_id: str, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        recent = self.calls[user_id]
        while recent and recent[0] <= now - 60:
            recent.popleft()
        if len(recent) >= self.per_minute:
            return False
        recent.append(now)
        return True


async def call(connections: list[Connection], password_of: Callable[[str], Awaitable[str | None]], tool: str, args: dict, limits: Limits = Limits()) -> Output:
    """Run one of the tools over the agent's connections; ``password_of`` opens the chosen
    one's password (an :class:`Invalid` when it cannot)."""
    try:
        name = str(args.get("database") or "")
        c = next((c for c in connections if c.name == name), None)
        if c is None:
            raise Invalid(f"Say which database: one of {', '.join(c.name for c in connections)}.")
        sql = SCHEMA_SQL if tool == SCHEMA else str(args.get("sql") or "").strip()
        if not sql:
            raise Invalid("Give the SQL statement to run.")
        if len(sql) > MAX_SQL_CHARS:
            raise Invalid(f"The statement is longer than {MAX_SQL_CHARS} characters.")
        password = await password_of(c.name)
        out = await _within(c, password, sql, tool == SCHEMA or not c.changes, None, limits)
        answer = tables_of(out) if tool == SCHEMA else out
        return Output(json.dumps(answer, ensure_ascii=False)[:MAX_TEXT])
    except Invalid as e:
        return Output(e.message, True)


async def _within(c: Connection, password: str | None, sql: str, read_only: bool, params: list[str | None] | None, limits: Limits) -> dict[str, Any]:
    """One statement on a fresh connection, closed after, within the call's time."""

    async def work() -> dict[str, Any]:
        conn = await connect(c, password, limits)
        try:
            return await run_sql(conn, sql, read_only, params)
        finally:
            await conn.close()

    try:
        return await asyncio.wait_for(work(), limits.total)
    except TimeoutError:
        raise Invalid(f"PostgreSQL: the call took longer than {int(limits.total)} seconds and was stopped.") from None


async def execute(c: Connection, password: str | None, sql: str, params: list[str | None], limits: Limits = Limits()) -> Output:
    """A SQL Query tool's statement (sql_tools.py), its values bound: read only unless the
    connection allows changes."""
    try:
        out = await _within(c, password, sql, not c.changes, params, limits)
        return Output(json.dumps(out, ensure_ascii=False)[:MAX_TEXT])
    except Invalid as e:
        return Output(e.message, True)


async def check(c: Connection, password: str | None, sql: str, limits: Limits = Limits()) -> None:
    """Whether PostgreSQL accepts a statement — its syntax, tables and columns — prepared and
    never run (in a read-only transaction, rolled back): :class:`Invalid` saying why not."""

    async def work() -> None:
        conn = await connect(c, password, limits)
        try:
            await conn.execute("START TRANSACTION READ ONLY")
            pgconn = conn.pgconn
            pgconn.send_prepare(b"", sql.encode(), None)
            await conn.wait(generators.send(pgconn))
            error = None
            while (res := await conn.wait(generators.fetch(pgconn))) is not None:
                if res.status == pq.ExecStatus.FATAL_ERROR and error is None:
                    error = (res.error_field(pq.DiagnosticField.MESSAGE_PRIMARY) or res.error_message or b"").decode(errors="replace").strip()
            if error is not None:
                raise Invalid(f"PostgreSQL: {error}")
        except psycopg.Error as exc:
            raise Invalid(_db_error(exc)) from None
        finally:
            await conn.close()

    try:
        await asyncio.wait_for(work(), limits.total)
    except TimeoutError:
        raise Invalid(f"PostgreSQL: the call took longer than {int(limits.total)} seconds and was stopped.") from None


async def test(c: Connection, password: str | None, limits: Limits = Limits()) -> str:
    """``Test connection``: the server's version, or :class:`Invalid` saying why not."""
    conn = await connect(c, password, limits)
    try:
        out = await run_sql(conn, "SELECT version()", True)
    finally:
        await conn.close()
    return str(out["rows"][0][0])
