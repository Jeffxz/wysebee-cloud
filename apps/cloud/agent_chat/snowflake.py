"""Snowflake for an agent living in Wysebee Cloud (2026-11-11, the person's call):
``snowflake_schema`` and ``snowflake_query``, run by Wysebee Cloud itself, over the person's
connections (``snowflake`` tools, apps/cloud/user_tools.py).

- **It signs in with a programmatic access token or a key pair** — Snowflake's SQL API takes
  no password. ``token``: sent as it is. ``key``: the person's RSA private key (PEM,
  unencrypted) signs a ten-minute JWT for each call (:func:`jwt_for`).
- **Read only unless allowed**: Snowflake has no read-only session, so without ``changes``
  only a statement that reads is sent (:func:`reads_only`).
- **One statement a call** (the SQL API refuses several unless asked for them), stopped by
  Snowflake after :data:`TIME_LIMIT`, at most :data:`MAX_ROWS` rows, every value as text.
- **Only Snowflake is reached**: the account is checked to be letters, digits, ``-``, ``_``
  and ``.``, and the address is ``https://<account>.snowflakecomputing.com`` — never a host
  the person names — so nothing on Wysebee Cloud's own network can be asked.
- **At most** :data:`CALLS_PER_MINUTE` calls a minute for each person, on each replica.
"""

import asyncio
import base64
import hashlib
import json
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from apps.cloud.agent_chat.postgres import MAX_ANSWER_CHARS, MAX_ROWS, MAX_SQL_CHARS, MAX_VALUE_CHARS, Invalid, tables_of, valid_name
from apps.cloud.agent_chat.tools import MAX_TEXT, Output

SCHEMA = "snowflake_schema"
QUERY = "snowflake_query"
MAX_CONNECTIONS = 10
MAX_DESCRIPTION = 1_000
MAX_SECRET_CHARS = 20_000
# What is read of one answer, at most.
MAX_READ_BYTES = 8 * 1024 * 1024
TIME_LIMIT = 30.0
TOTAL_LIMIT = 60.0
POLL_SECONDS = 1.0
JWT_LIFE = 600
CALLS_PER_MINUTE = 60
AUTHS = ("token", "key")
API = "https://{account}.snowflakecomputing.com"

SCHEMA_SQL = (
    "SELECT table_schema, table_name, column_name, data_type, is_nullable "
    "FROM information_schema.columns WHERE table_schema <> 'INFORMATION_SCHEMA' "
    "ORDER BY table_schema, table_name, ordinal_position"
)
VERSION_SQL = "SELECT CURRENT_VERSION()"

ACCOUNT = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}")
HANDLE = re.compile(r"[A-Za-z0-9-]+")
READS = ("SELECT", "WITH", "SHOW", "DESCRIBE", "DESC", "EXPLAIN")
NOT_A_KEY = "The private key could not be read: paste the whole PEM file, from -----BEGIN PRIVATE KEY----- to -----END PRIVATE KEY-----."


@dataclass(frozen=True)
class Connection:
    name: str
    description: str
    account: str
    database: str
    warehouse: str
    schema: str
    role: str
    user: str
    auth: str
    changes: bool


@dataclass(frozen=True)
class Limits:
    statement: float = TIME_LIMIT
    total: float = TOTAL_LIMIT
    poll: float = POLL_SECONDS


def _word(entry: dict, key: str, what: str, needed: bool) -> str:
    v = str(entry.get(key) or "").strip()
    if (needed and not v) or len(v) > 255 or any(c.isspace() for c in v):
        raise Invalid(f"Give its {what} (no spaces, at most 255 characters).")
    return v


def parse(name: str, entry: dict) -> Connection:
    """A connection as the dialog sends it, checked as the desktop's ``parse_one``."""
    if not valid_name(name):
        raise Invalid("Its name is a lowercase letter, then lowercase letters, digits or _, at most 30.")
    description = str(entry.get("description") or "").strip()
    if len(description) > MAX_DESCRIPTION:
        raise Invalid(f"Say what it holds in at most {MAX_DESCRIPTION} characters.")
    account = str(entry.get("account") or "").strip()
    if ACCOUNT.fullmatch(account) is None:
        raise Invalid("Give its Snowflake account, like myorg-myaccount (letters, digits, - _ . only).")
    auth = str(entry.get("auth") or "token")
    if auth not in AUTHS:
        raise Invalid("It signs in with a token or a key.")
    changes = entry.get("changes")
    if changes is None:
        changes = False
    elif not isinstance(changes, bool):
        raise Invalid("'changes' is true or false.")
    return Connection(
        name,
        description,
        account,
        _word(entry, "database", "database's name", True),
        _word(entry, "warehouse", "warehouse", False),
        _word(entry, "schema", "schema", False),
        _word(entry, "role", "role", False),
        # A key pair's JWT names the user; a token is its user's already.
        _word(entry, "user", "user name", auth == "key"),
        auth,
        changes,
    )


def reads_only(sql: str) -> bool:
    """Whether a statement only reads, by its first word once comments and opening brackets
    are passed: what a connection without Allow changes sends."""
    rest = sql.lstrip()
    while True:
        before = rest
        if rest.startswith("--"):
            rest = rest.partition("\n")[2]
        elif rest.startswith("/*"):
            rest = rest[2:].partition("*/")[2]
        elif rest.startswith("("):
            rest = rest[1:]
        rest = rest.lstrip()
        if rest == before:
            break
    found = re.match(r"[A-Za-z]+", rest)
    return found is not None and found.group(0).upper() in READS


def jwt_for(account: str, user: str, pem: str, now: int) -> str:
    """The JWT a key pair signs in with: issued by ``ACCOUNT.USER.SHA256:<the public key's
    fingerprint>`` for ``ACCOUNT.USER``, good for :data:`JWT_LIFE` seconds, signed RS256. The
    account is the identifier's part before any ``.``, in capitals like the user."""
    if "ENCRYPTED" in pem:
        raise Invalid("The private key is encrypted with a passphrase, which Wysebee cannot use: make one without (openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -out rsa_key.p8 -nocrypt).")
    try:
        key = serialization.load_pem_private_key(pem.strip().encode(), password=None)
    except (ValueError, TypeError):
        raise Invalid(NOT_A_KEY) from None
    if not isinstance(key, rsa.RSAPrivateKey):
        raise Invalid(NOT_A_KEY)
    public = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    fingerprint = base64.b64encode(hashlib.sha256(public).digest()).decode()
    who = f"{account.split('.')[0].upper()}.{user.upper()}"
    return jwt.encode({"iss": f"{who}.SHA256:{fingerprint}", "sub": who, "iat": now, "exp": now + JWT_LIFE}, key, algorithm="RS256")


def _cut(value: Any) -> Any:
    return value[:MAX_VALUE_CHARS] + "…" if isinstance(value, str) and len(value) > MAX_VALUE_CHARS else value


def rows_of(answer: dict) -> dict[str, Any]:
    """A finished statement's answer as the tool gives it: columns, rows (capped) and whether
    there were more."""
    meta = answer.get("resultSetMetaData") or {}
    data = answer.get("data") or []
    rows: list[list] = []
    size = 0
    for row in data:
        if len(rows) >= MAX_ROWS or size >= MAX_ANSWER_CHARS:
            break
        values = [_cut(v) for v in row]
        size += len(json.dumps(values, ensure_ascii=False)) + 1
        rows.append(values)
    total = meta.get("numRows")
    return {"columns": [c.get("name") for c in meta.get("rowType") or []], "rows": rows, "truncated": len(rows) < (total if isinstance(total, int) else len(data))}


async def _ask(http: httpx.AsyncClient, method: str, url: str, headers: dict, body: dict | None, timeout: float) -> tuple[int, dict]:
    try:
        async with http.stream(method, url, headers=headers, json=body, timeout=timeout) as response:
            raw = bytearray()
            async for chunk in response.aiter_bytes():
                raw.extend(chunk)
                if len(raw) > MAX_READ_BYTES:
                    raise Invalid(f"Snowflake's answer is larger than {MAX_READ_BYTES // 1024 // 1024} MB: ask for fewer rows or columns (add a LIMIT).")
            status = response.status_code
    except httpx.HTTPError as exc:
        raise Invalid(f"Snowflake could not be reached: {type(exc).__name__}") from None
    try:
        answer = json.loads(raw)
    except ValueError:
        answer = None
    answer = answer if isinstance(answer, dict) else {}
    if status >= 400:
        said = answer.get("message") if isinstance(answer.get("message"), str) else f"it answered {status}"
        hint = " Check the connection's token or key, and that it has not expired, in the connection, on the agent's General tab." if status == 401 else ""
        raise Invalid(f"Snowflake: {said}{hint}")
    return status, answer


async def run(http: httpx.AsyncClient, c: Connection, secret: str, sql: str, limits: Limits = Limits(), api: str = API, bindings: dict[str, Any] | None = None) -> dict[str, Any]:
    """Run one statement on a connection and give its rows; ``bindings`` the values of its
    ``?``s (a SQL Query tool's, sql_tools.py)."""
    if c.auth == "key":
        token, kind = jwt_for(c.account, c.user, secret, int(time.time())), "KEYPAIR_JWT"
    else:
        token, kind = secret.strip(), "PROGRAMMATIC_ACCESS_TOKEN"
    base = api.replace("{account}", c.account.lower())
    headers = {"Authorization": f"Bearer {token}", "X-Snowflake-Authorization-Token-Type": kind, "Accept": "application/json", "User-Agent": "Wysebee"}
    body: dict[str, Any] = {"statement": sql, "timeout": int(limits.statement)}
    body.update({k: v for k, v in (("database", c.database), ("schema", c.schema), ("warehouse", c.warehouse), ("role", c.role)) if v})
    if bindings:
        body["bindings"] = bindings

    async def work() -> dict[str, Any]:
        status, answer = await _ask(http, "POST", f"{base}/api/v2/statements", headers, body, limits.total)
        # Still running: asked after by its handle until it ends (Snowflake stops it itself).
        while status == 202:
            handle = answer.get("statementHandle")
            if not isinstance(handle, str) or HANDLE.fullmatch(handle) is None:
                raise Invalid("Snowflake: the statement is still running, and gave no handle to ask after it.")
            await asyncio.sleep(limits.poll)
            status, answer = await _ask(http, "GET", f"{base}/api/v2/statements/{handle}", headers, None, limits.total)
        return rows_of(answer)

    try:
        return await asyncio.wait_for(work(), limits.total)
    except TimeoutError:
        raise Invalid(f"Snowflake: the call took longer than {int(limits.total)} seconds and was given up.") from None


def tool_defs(connections: list[Connection]) -> list[dict]:
    """The desktop's ``tools_for``, word for word: none without a connection."""
    if not connections:
        return []
    lines = []
    for c in connections:
        mode = "read and write" if c.changes else "read only"
        what = f" — {c.description}" if c.description else ""
        lines.append(f"- {c.name} ({mode}): database {c.database} in account {c.account}{what}")
    note = "The person's Snowflake databases:\n" + "\n".join(lines)
    which = {"type": "string", "enum": [c.name for c in connections], "description": "Which connection, by its name."}
    return [
        {
            "name": SCHEMA,
            "description": f"List the tables of one of the person's Snowflake databases, with each table's columns and types. Start here before writing a query.\n\n{note}",
            "input_schema": {"type": "object", "properties": {"database": which}, "required": ["database"]},
        },
        {
            "name": QUERY,
            "description": f"Run one SQL statement on one of the person's Snowflake databases and get its rows (at most {MAX_ROWS}, every value as text). A read-only connection takes only statements that read (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN); change data only where the person allows changes and asked for it. One statement per call, at most {int(TIME_LIMIT)} seconds. Snowflake bills the person for the warehouse time a query uses: add a LIMIT, and do not repeat a query whose answer you have.\n\n{note}",
            "input_schema": {
                "type": "object",
                "properties": {"database": which, "sql": {"type": "string", "description": "One SQL statement, values written in it (no ? parameters)."}},
                "required": ["database", "sql"],
            },
        },
    ]


async def call(
    http: httpx.AsyncClient, connections: list[Connection], secret_of: Callable[[str], Awaitable[str | None]], tool: str, args: dict, limits: Limits = Limits(), api: str = API
) -> Output:
    """Run one of the tools over the agent's connections; ``secret_of`` opens the chosen
    one's token or key (an :class:`Invalid` when it cannot)."""
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
        if not c.changes and not reads_only(sql):
            raise Invalid(f"'{c.name}' is read only: only SELECT, WITH, SHOW, DESCRIBE and EXPLAIN run on it. The person can allow changes in the connection, on the agent's General tab.")
        secret = await secret_of(c.name)
        if not secret:
            raise Invalid(f"'{c.name}' has no access token or key yet: enter one in the connection, on the agent's General tab.")
        out = await run(http, c, secret, sql, limits, api)
        answer = tables_of(out) if tool == SCHEMA else out
        return Output(json.dumps(answer, ensure_ascii=False)[:MAX_TEXT])
    except Invalid as e:
        return Output(e.message, True)


async def execute(
    http: httpx.AsyncClient, c: Connection, secret: str | None, sql: str, bindings: dict[str, Any], limits: Limits = Limits(), api: str = API
) -> Output:
    """A SQL Query tool's statement (sql_tools.py), its values bound: only a read where the
    connection does not allow changes."""
    try:
        if not c.changes and not reads_only(sql):
            raise Invalid(f"'{c.name}' is read only: only SELECT, WITH, SHOW, DESCRIBE and EXPLAIN run on it. The person can allow changes in the connection, on the agent's General tab.")
        if not secret:
            raise Invalid(f"'{c.name}' has no access token or key yet: enter one in the connection, on the agent's General tab.")
        out = await run(http, c, secret, sql, limits, api, bindings)
        return Output(json.dumps(out, ensure_ascii=False)[:MAX_TEXT])
    except Invalid as e:
        return Output(e.message, True)


async def check(http: httpx.AsyncClient, c: Connection, secret: str | None, sql: str, bindings: dict[str, Any], limits: Limits = Limits(), api: str = API) -> None:
    """Whether Snowflake accepts a statement — its syntax, tables and columns — explained and
    never run: :class:`Invalid` saying why not."""
    if not secret:
        raise Invalid("Enter the connection's access token or private key first, on the agent's General tab.")
    await run(http, c, secret, f"EXPLAIN USING TEXT {sql}", limits, api, bindings)


async def test(http: httpx.AsyncClient, c: Connection, secret: str | None, limits: Limits = Limits(), api: str = API) -> str:
    """``Test connection``: Snowflake's version, or :class:`Invalid` saying why not."""
    if not secret:
        raise Invalid("Enter its access token or private key first.")
    out = await run(http, c, secret, VERSION_SQL, limits, api)
    return str(out["rows"][0][0]) if out["rows"] and out["rows"][0] else ""
