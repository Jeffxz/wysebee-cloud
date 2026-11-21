"""PostgreSQL for agents living in Wysebee Cloud: the checks and the public-address guard
(apps/cloud/agent_chat/postgres.py), and — against a real database, skipped without
WYSEBEE_TEST_DATABASE_URL — the tools themselves, the connections' routes
(apps/cloud/user_tools.py) and a cloud agent's tools using them. The test database is on
loopback with no TLS, so those tests let loopback count as public and connect in the clear;
everything else is as in production."""

import asyncio
import ipaddress
import json
import uuid
from urllib.parse import urlparse

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud.agent_chat import postgres as pg
from apps.cloud.agent_chat.tools import MAX_TEXT
from apps.cloud.envelope import EnvelopeError
from tests.conftest import TEST_DB_URL, needs_db
from tests.cloud_agent_fixtures import _call as _tool
from tests.cloud_agent_fixtures import (  # noqa: F401 — fixtures
    KEK,
    _agent,
    _agent_id,
    _connect,
    _give_tools,
    _save_tool,
    _box,
    _client,
    _offered,
    client,
    me,
)

GOOD = {"host": "db.example.com", "database": "shop", "user": "reader"}


def run(coro):
    return asyncio.run(coro)


# --- checks -------------------------------------------------------------------------------


def test_a_connection_is_checked_as_the_desktop_checks_it() -> None:
    c = pg.parse("sales", {**GOOD, "description": " Orders "})
    assert c == pg.Connection("sales", "Orders", "db.example.com", 5432, "shop", "reader", "verify", False)
    assert pg.parse("ops", {**GOOD, "port": 6543, "ssl": "require", "changes": True}).changes
    for name, entry, why in [
        ("Sales", GOOD, "Its name"),
        ("s" * 31, GOOD, "Its name"),
        ("sales", {**GOOD, "description": "x" * 1001}, "what it holds"),
        ("sales", {**GOOD, "port": 0}, "port"),
        ("sales", {**GOOD, "port": True}, "port"),
        ("sales", {**GOOD, "port": "5432"}, "port"),
        # Never in the clear from the cloud.
        ("sales", {**GOOD, "ssl": "disable"}, "never connects in the clear"),
        ("sales", {**GOOD, "changes": "yes"}, "'changes'"),
        ("sales", {**GOOD, "host": ""}, "server's host"),
        ("sales", {**GOOD, "host": "two words"}, "server's host"),
        # A list of hosts, or a socket's directory, is not one host.
        ("sales", {**GOOD, "host": "a.example.com,b.example.com"}, "Its host"),
        ("sales", {**GOOD, "host": "/var/run/postgresql"}, "Its host"),
        ("sales", {**GOOD, "database": ""}, "database's name"),
        ("sales", {**GOOD, "user": "x" * 256}, "user name"),
    ]:
        with pytest.raises(pg.Invalid, match=why):
            pg.parse(name, entry)


@pytest.mark.parametrize("host", ["localhost", "db.localhost", "127.0.0.1", "10.0.0.5", "192.168.1.2", "172.16.0.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1", "0.0.0.0", "224.0.0.1"])
def test_a_save_refuses_an_address_that_is_not_public(host: str) -> None:
    with pytest.raises(pg.Invalid, match="only databases with a public address"):
        pg.parse("sales", {**GOOD, "host": host})


def test_public_addresses_are_told_apart() -> None:
    assert pg.is_public(ipaddress.ip_address("8.8.8.8")) and pg.is_public(ipaddress.ip_address("2606:4700::1111"))
    assert not pg.is_public(ipaddress.ip_address("::ffff:127.0.0.1")) and pg.is_public(ipaddress.ip_address("::ffff:8.8.8.8"))
    assert not pg.is_public(ipaddress.ip_address("ff02::1"))


def test_a_connection_goes_to_the_address_checked(monkeypatch) -> None:
    answers = {"db.example.com": ["93.184.216.34"], "mixed.example.com": ["93.184.216.34", "10.0.0.7"], "inside.example.com": ["169.254.169.254"], "gone.example.com": []}

    async def lookup(host: str) -> list[str]:
        if host == "broken.example.com":
            raise OSError("no such host")
        return answers[host]

    monkeypatch.setattr(pg, "lookup", lookup)
    assert run(pg.public_address("db.example.com")) == "93.184.216.34"
    assert run(pg.public_address("8.8.4.4")) == "8.8.4.4"
    # Any address that is not public refuses the name: it might answer that one next time.
    for host in ("mixed.example.com", "inside.example.com", "10.1.2.3"):
        with pytest.raises(pg.Invalid, match="public address"):
            run(pg.public_address(host))
    for host in ("gone.example.com", "broken.example.com"):
        with pytest.raises(pg.Invalid, match="could not be found"):
            run(pg.public_address(host))
    # The real lookup answers addresses.
    monkeypatch.undo()
    assert "127.0.0.1" in run(pg.lookup("localhost")) or "::1" in run(pg.lookup("localhost"))


def test_the_tools_read_like_the_desktops() -> None:
    assert pg.tool_defs([]) == []
    defs = pg.tool_defs([pg.Connection("sales", "Orders", "db.example.com", 5432, "shop", "r", "verify", False), pg.Connection("ops", "", "h.example.com", 5432, "ops", "w", "require", True)])
    assert [d["name"] for d in defs] == ["postgres_schema", "postgres_query"]
    assert "- sales (read only): database shop on db.example.com — Orders\n- ops (read and write): database ops on h.example.com" in defs[0]["description"]
    assert defs[1]["input_schema"]["properties"]["database"]["enum"] == ["sales", "ops"]
    assert "at most 200, every value as text" in defs[1]["description"] and "at most 30 seconds" in defs[1]["description"]


def test_tables_are_grouped_and_capped(monkeypatch) -> None:
    rows = [["public", "orders", "id", "integer", "NO"], ["public", "orders", "note", "text", "YES"], ["public", "users", "id", "integer", "NO"]]
    assert pg.tables_of({"rows": rows, "truncated": False}) == {
        "tables": [{"table": "public.orders", "columns": [{"name": "id", "type": "integer", "nullable": False}, {"name": "note", "type": "text", "nullable": True}]}, {"table": "public.users", "columns": [{"name": "id", "type": "integer", "nullable": False}]}],
        "more": False,
    }
    monkeypatch.setattr(pg, "MAX_TABLES", 1)
    assert pg.tables_of({"rows": rows, "truncated": False}) == {"tables": [{"table": "public.orders", "columns": [{"name": "id", "type": "integer", "nullable": False}, {"name": "note", "type": "text", "nullable": True}]}], "more": True}


def test_calls_are_limited_per_person() -> None:
    limit = pg.RateLimit(per_minute=2)
    assert limit.allow("a", 0) and limit.allow("a", 1) and not limit.allow("a", 2)
    assert limit.allow("b", 2)
    assert limit.allow("a", 61) and limit.allow("a")


def test_a_call_says_what_is_missing() -> None:
    conns = [pg.Connection("sales", "", "db.example.com", 5432, "shop", "r", "verify", False)]

    async def nothing(_: str) -> None:
        return None

    async def unreadable(_: str) -> None:
        raise pg.Invalid("The password for 'sales' could not be read: no")

    assert run(pg.call(conns, nothing, pg.QUERY, {"database": "other", "sql": "select 1"})) == pg.Output("Say which database: one of sales.", True)
    assert run(pg.call(conns, nothing, pg.QUERY, {"database": "sales", "sql": " "})) == pg.Output("Give the SQL statement to run.", True)
    assert run(pg.call(conns, nothing, pg.QUERY, {"database": "sales", "sql": "x" * (pg.MAX_SQL_CHARS + 1)})).text.startswith("The statement is longer")
    assert run(pg.call(conns, unreadable, pg.QUERY, {"database": "sales", "sql": "select 1"})).text == "The password for 'sales' could not be read: no"


def test_the_servers_error_is_told() -> None:
    class Diag:
        message_primary = "relation does not exist"

    class WithDiag(Exception):
        diag = Diag()

    assert pg._db_error(WithDiag("x")) == "PostgreSQL: relation does not exist"
    assert pg._db_error(Exception(" refused ")) == "PostgreSQL: refused"
    assert pg._db_error(Exception()) == "PostgreSQL: Exception"


# --- against a real database ----------------------------------------------------------------


@pytest.fixture
def loopback(monkeypatch):
    """The test database counts as public and is reached in the clear."""
    monkeypatch.setattr(pg, "is_public", lambda ip: True)
    monkeypatch.setattr(pg, "LIBPQ_SSLMODE", {"verify": "disable", "require": "disable"})


def _db() -> dict:
    u = urlparse(TEST_DB_URL.replace("+psycopg", ""))
    return {"host": "127.0.0.1", "port": u.port or 5432, "database": u.path.lstrip("/"), "user": u.username, "password": u.password}


@pytest.fixture
def table(migrated_db_url: str):
    name = f"pg_tool_{uuid.uuid4().hex[:8]}"
    with create_engine(migrated_db_url).begin() as conn:
        conn.execute(text(f"CREATE TABLE {name} (id integer NOT NULL, note text)"))
        conn.execute(text(f"INSERT INTO {name} SELECT g, 'n' || g FROM generate_series(1, 3) g"))
    yield name
    with create_engine(migrated_db_url).begin() as conn:
        conn.execute(text(f"DROP TABLE {name}"))


def _conn(changes: bool = False, **over) -> tuple[pg.Connection, str]:
    db = _db()
    return pg.Connection("main", "", over.get("host", db["host"]), over.get("port", db["port"]), db["database"], db["user"], "verify", changes), over.get("password", db["password"])


def _call(c: pg.Connection, password: str | None, tool: str, args: dict, limits: pg.Limits = pg.Limits()) -> pg.Output:
    async def opened(_: str) -> str | None:
        return password

    return run(pg.call([c], opened, tool, {"database": c.name, **args}, limits))


@needs_db
def test_the_tools_read_a_real_database(loopback, table: str) -> None:
    c, password = _conn()
    schema = json.loads(_call(c, password, pg.SCHEMA, {}).text)
    assert {"table": f"public.{table}", "columns": [{"name": "id", "type": "integer", "nullable": False}, {"name": "note", "type": "text", "nullable": True}]} in schema["tables"]
    # Every value as PostgreSQL's own text, a NULL as null.
    out = json.loads(_call(c, password, pg.QUERY, {"sql": f"SELECT id, note, NULL AS n, 1.50::numeric AS m, '{{\"a\":1}}'::jsonb AS j FROM {table} ORDER BY id LIMIT 1"}).text)
    assert out == {"columns": ["id", "note", "n", "m", "j"], "rows": [["1", "n1", None, "1.50", '{"a": 1}']], "truncated": False}
    # Read only: a change is refused, whatever the statement.
    refused = _call(c, password, pg.QUERY, {"sql": f"DELETE FROM {table}"})
    assert refused.is_error and "read-only transaction" in refused.text
    assert _call(c, password, pg.QUERY, {"sql": f"SELECT count(*) FROM {table}"}).text == '{"columns": ["count"], "rows": [["3"]], "truncated": false}'
    # One statement a call.
    several = _call(c, password, pg.QUERY, {"sql": "SELECT 1; SELECT 2"})
    assert several.is_error and "multiple commands" in several.text
    # At most 200 rows, and long values cut.
    many = json.loads(_call(c, password, pg.QUERY, {"sql": "SELECT g FROM generate_series(1, 500) g"}).text)
    assert (len(many["rows"]), many["truncated"]) == (200, True)
    long = json.loads(_call(c, password, pg.QUERY, {"sql": "SELECT repeat('x', 3000) AS v"}).text)
    assert long["rows"][0][0] == "x" * pg.MAX_VALUE_CHARS + "…"
    # The server's own error.
    missing = _call(c, password, pg.QUERY, {"sql": "SELECT * FROM no_such_table"})
    assert missing == pg.Output('PostgreSQL: relation "no_such_table" does not exist', True)


@needs_db
def test_changes_only_where_allowed(loopback, table: str) -> None:
    c, password = _conn(changes=True)
    assert _call(c, password, pg.QUERY, {"sql": f"UPDATE {table} SET note = 'x' WHERE id < 3"}).text == '{"rows_affected": 2}'
    assert _call(c, password, pg.QUERY, {"sql": f"SELECT count(*) FROM {table} WHERE note = 'x'"}).text == '{"columns": ["count"], "rows": [["2"]], "truncated": false}'
    # The schema tool reads only, even here.
    assert not _call(c, password, pg.SCHEMA, {}).is_error


@needs_db
def test_calls_stop_in_time(loopback) -> None:
    c, password = _conn()
    slow = _call(c, password, pg.QUERY, {"sql": "SELECT pg_sleep(3)"}, pg.Limits(statement=0.3))
    assert slow == pg.Output("PostgreSQL: canceling statement due to statement timeout", True)
    stuck = _call(c, password, pg.QUERY, {"sql": "SELECT pg_sleep(3)"}, pg.Limits(total=0.5))
    assert stuck == pg.Output("PostgreSQL: the call took longer than 0 seconds and was stopped.", True)


@needs_db
def test_a_connection_that_fails_says_why(loopback, monkeypatch) -> None:
    c, _ = _conn()
    wrong = _call(c, "not-the-password", pg.QUERY, {"sql": "SELECT 1"})
    assert wrong.is_error and wrong.text.startswith("PostgreSQL: ") and "password" in wrong.text
    closed, password = _conn(port=1)
    assert _call(closed, password, pg.QUERY, {"sql": "SELECT 1"}).text.startswith("PostgreSQL: ")

    async def hang(**params):
        await asyncio.sleep(5)

    monkeypatch.setattr(pg.psycopg.AsyncConnection, "connect", hang)
    assert _call(c, password, pg.QUERY, {"sql": "SELECT 1"}, pg.Limits(connect=0.2)) == pg.Output(f"PostgreSQL: 127.0.0.1:{c.port} did not answer within 0 seconds.", True)


@needs_db
def test_an_answer_stops_before_the_tool_cap(loopback, monkeypatch) -> None:
    monkeypatch.setattr(pg, "MAX_ANSWER_CHARS", 100)
    c, password = _conn()
    out = json.loads(_call(c, password, pg.QUERY, {"sql": "SELECT repeat('y', 40) FROM generate_series(1, 50)"}).text)
    assert out["truncated"] and 1 < len(out["rows"]) < 50
    assert MAX_TEXT == 50_000


@needs_db
def test_the_test_answers_the_servers_version(loopback) -> None:
    c, password = _conn()
    assert run(pg.test(c, password)).startswith("PostgreSQL ")


# --- the routes -----------------------------------------------------------------------------


def _cfg(**over) -> dict:
    db = _db()
    return {"host": db["host"], "port": db["port"], "database": db["database"], "user": db["user"], **over}


def _pg(client: TestClient, me: dict[str, str], name: str = "shop", *, config: dict | None = None, secret: str | None = None, tool_id: str | None = None, description: str = "The shop"):
    return _save_tool(client, me, "postgres", name, description=description, config=_cfg() if config is None else config, secret=secret, tool_id=tool_id)


@needs_db
def test_connections_are_kept_with_a_write_only_password(client: TestClient, me: dict[str, str], migrated_db_url: str, loopback) -> None:  # noqa: F811
    assert client.get("/api/v1/tools?kind=postgres", headers=me).json() == {"tools": []}
    saved = _pg(client, me, secret="s3cret-pw")
    assert saved.status_code == 201, saved.text
    row = saved.json()
    assert {k: row[k] for k in ("kind", "name", "description", "has_secret")} == {"kind": "postgres", "name": "shop", "description": "The shop", "has_secret": True}
    assert (row["config"]["ssl"], row["config"]["changes"]) == ("verify", False)
    # Never in an answer, nor in the database in the clear.
    assert "s3cret-pw" not in saved.text + client.get("/api/v1/tools", headers=me).text
    with create_engine(migrated_db_url).begin() as conn:
        stored = conn.execute(text("SELECT ciphertext, kek_id FROM user_tools WHERE user_id = :u"), {"u": me["X-Test-User"]}).one()
    assert b"s3cret-pw" not in bytes(stored[0]) and stored[1].startswith("local:")
    # A save without a password keeps it; "" removes it. Renamed, it is the same tool.
    assert _pg(client, me, "store", config=_cfg(changes=True), tool_id=row["id"]).json()["has_secret"] is True
    tested = client.post("/api/v1/tools/test", json={"kind": "postgres", "name": "store", "config": _cfg(), "tool_id": row["id"]}, headers=me).json()
    assert tested["ok"] is False and "password" in tested["error"]
    assert _pg(client, me, "store", secret="", tool_id=row["id"]).json()["has_secret"] is False
    # Checked: names, TLS in the clear.
    assert _pg(client, me, "Shop").status_code == 422
    assert _pg(client, me, "shop", config=_cfg(ssl="disable")).status_code == 422
    # Another person sees none of it; a delete removes it.
    assert client.get("/api/v1/tools", headers={"X-Test-User": "someone-else"}).json() == {"tools": []}
    assert client.delete(f"/api/v1/tools/{row['id']}", headers=me).status_code == 204
    assert client.get("/api/v1/tools", headers=me).json() == {"tools": []}


@needs_db
def test_the_test_uses_the_password_typed_or_stored(client: TestClient, me: dict[str, str], loopback) -> None:  # noqa: F811
    password = _db()["password"]
    test = lambda **over: client.post("/api/v1/tools/test", json={"kind": "postgres", "name": "shop", "config": _cfg(), **over}, headers=me)  # noqa: E731
    typed = test(secret=password).json()
    assert typed["ok"] and typed["version"].startswith("PostgreSQL ") and typed["error"] is None
    # None stored yet: tried without one.
    assert test().json()["ok"] is False
    tool = _pg(client, me, secret=password).json()
    assert test(tool_id=tool["id"]).json()["ok"] is True
    assert test(config=_cfg(ssl="nope")).status_code == 422
    # Another person's tool is not found.
    assert client.post("/api/v1/tools/test", json={"kind": "postgres", "name": "shop", "config": _cfg(), "tool_id": tool["id"]}, headers={"X-Test-User": "someone-else"}).status_code == 404
    # At most so many a minute.
    client.app.state.postgres_limit = pg.RateLimit(per_minute=0)
    limited = test()
    assert limited.status_code == 429 and "a minute" in limited.json()["detail"]


@needs_db
def test_an_address_that_is_not_public_is_refused_on_save(client: TestClient, me: dict[str, str]) -> None:  # noqa: F811
    refused = _pg(client, me, config={**GOOD, "host": "10.0.0.5"})
    assert refused.status_code == 422 and "public address" in refused.json()["detail"]


@needs_db
def test_at_most_ten_connections_an_agent(client: TestClient, me: dict[str, str]) -> None:  # noqa: F811
    _agent(client, me, "sky", {"label": "Sky"})
    for i in range(pg.MAX_CONNECTIONS + 1):
        assert _pg(client, me, f"c{i}", config=GOOD).status_code == 201
    assert _give_tools(client, me, "sky", "postgres", [f"c{i}" for i in range(pg.MAX_CONNECTIONS)]).status_code == 200
    eleventh = _give_tools(client, me, "sky", "postgres", [f"c{i}" for i in range(pg.MAX_CONNECTIONS + 1)])
    assert eleventh.status_code == 422 and "at most 10" in eleventh.json()["detail"]
    # The same connection given to another agent too: one tool, two agents.
    _agent(client, me, "other", {"label": "Other"})
    assert _give_tools(client, me, "other", "postgres", ["c0"]).status_code == 200
    assert len(client.get("/api/v1/tools?kind=postgres", headers=me).json()["tools"]) == pg.MAX_CONNECTIONS + 1


@needs_db
def test_a_password_needs_the_key_encryption_key(ui_dist, migrated_db_url: str, tmp_path, me: dict[str, str]) -> None:  # noqa: F811
    c = _client(ui_dist, migrated_db_url, tmp_path)
    try:
        refused = _save_tool(c, me, "postgres", "shop", config=GOOD, secret="pw")
        assert refused.status_code == 503 and "key-encryption key" in refused.json()["detail"]
        # Without a password, kept all the same.
        assert _save_tool(c, me, "postgres", "shop", config=GOOD).json()["has_secret"] is False
    finally:
        c.__exit__(None, None, None)


@needs_db
def test_the_vault_refusing_a_save_keeps_nothing(client: TestClient, me: dict[str, str]) -> None:  # noqa: F811
    async def refuse(data_key: bytes):
        raise EnvelopeError("The key vault refused (403).")

    client.app.state.ai_kek.wrap = refuse
    refused = _save_tool(client, me, "postgres", "shop", config=GOOD, secret="pw")
    assert (refused.status_code, refused.json()) == (503, {"detail": "The key vault refused (403)."})
    assert client.get("/api/v1/tools", headers=me).json() == {"tools": []}


@needs_db
def test_an_agent_deleted_keeps_its_connections_for_the_others(client: TestClient, me: dict[str, str]) -> None:  # noqa: F811
    _connect(client, me, "sky", "postgres", "shop", {**GOOD, "password": "pw"})
    _connect(client, me, "other", "postgres", "shop", GOOD)
    assert client.delete(f"/api/v1/agents/{_agent_id(client, me, 'sky')}", headers=me).status_code == 204
    # The tool stays, still the other agent's.
    assert [t["name"] for t in client.get(f"/api/v1/agents/{_agent_id(client, me, 'other')}/tools", headers=me).json()["tools"]] == ["shop"]


# --- a cloud agent's tools -------------------------------------------------------------------


def _sql_tool(client: TestClient, me: dict[str, str], connection_id: str, sql: str, name: str = "count_rows", params: list | None = None):
    return _save_tool(client, me, "sql", name, description="Counts the rows.", config={"connection_id": connection_id, "params": params or [], "sql": sql})


@needs_db
def test_a_cloud_agent_queries_its_database(client: TestClient, me: dict[str, str], loopback, table: str) -> None:  # noqa: F811
    _agent(client, me, "sky", {"label": "Sky"})
    # No connection: no database tools (only every agent's send_notification).
    assert _offered(client, me, "sky") == {"send_notification"}
    made = _connect(client, me, "sky", "postgres", "shop", _cfg(password=_db()["password"]))
    # The connection is not a tool the AI sees.
    assert _offered(client, me, "sky") == {"send_notification"}
    params = [{"name": "least", "type": "integer", "required": True, "description": "The smallest id."}]
    assert _sql_tool(client, me, made.json()["id"], f"SELECT count(*) FROM {table} WHERE id >= {{least}}", params=params).status_code == 201
    assert _give_tools(client, me, "sky", "sql", ["count_rows"]).status_code == 200
    tools = {t["name"]: t for t in _box(client, me, "sky").defs}
    assert tools["count_rows"]["input_schema"] == {"type": "object", "properties": {"least": {"type": "integer", "description": "The smallest id."}}, "required": ["least"]}
    answered = _tool(client, me, "sky", "count_rows", {"least": 2})
    assert (answered.text, answered.is_error) == ('{"columns": ["count"], "rows": [["2"]], "truncated": false}', False)
    missing = _tool(client, me, "sky", "count_rows", {})
    assert missing.is_error and missing.text == "Give 'least'."
    # At most so many calls a minute.
    client.app.state.postgres_limit = pg.RateLimit(per_minute=0)
    limited = _tool(client, me, "sky", "count_rows", {"least": 1})
    assert limited.is_error and "a minute" in limited.text
    # Its connection taken from the agent: the tool is no longer offered.
    assert _give_tools(client, me, "sky", "postgres", []).status_code == 200
    assert _offered(client, me, "sky") == {"send_notification"}


@needs_db
def test_a_password_that_cannot_be_read_is_said(client: TestClient, me: dict[str, str], loopback) -> None:  # noqa: F811
    made = _connect(client, me, "sky", "postgres", "shop", _cfg(password="pw"))
    assert _sql_tool(client, me, made.json()["id"], "SELECT 1").status_code == 201
    _give_tools(client, me, "sky", "sql", ["count_rows"])

    async def refuse(wrapped: bytes, kek_id: str):
        raise EnvelopeError("The key vault refused (403).")

    real = client.app.state.ai_kek.unwrap
    client.app.state.ai_kek.unwrap = refuse
    out = _tool(client, me, "sky", "count_rows", {})
    assert out.is_error and out.text == "The password for 'shop' could not be read: The key vault refused (403)."
    client.app.state.ai_kek.unwrap = real
    # With no key-encryption key at all, said so too.
    from apps.cloud import user_tools

    row = type("Row", (), {"ciphertext": b"x", "name": "shop", "kind": "postgres"})()
    with pytest.raises(pg.Invalid, match="no key-encryption key"):
        run(user_tools.secret_of(None, row))


def test_tls_is_always_asked_of_libpq(monkeypatch) -> None:
    sent: list[dict] = []

    async def capture(**params):
        sent.append(params)
        raise pg.psycopg.OperationalError("stop here")

    async def lookup(host: str) -> list[str]:
        return ["93.184.216.34"]

    monkeypatch.setattr(pg, "lookup", lookup)
    monkeypatch.setattr(pg.psycopg.AsyncConnection, "connect", capture)
    for ssl in ("verify", "require"):
        c = pg.Connection("sales", "", "db.example.com", 5432, "shop", "r", ssl, False)
        with pytest.raises(pg.Invalid, match="stop here"):
            run(pg.connect(c, "pw"))
    verify, require = sent
    # To the address checked, the name kept for the certificate; read-only; no Kerberos.
    assert (verify["host"], verify["hostaddr"], verify["sslmode"], verify["sslrootcert"], verify["password"]) == ("db.example.com", "93.184.216.34", "verify-full", "system", "pw")
    assert "default_transaction_read_only=on" in verify["options"] and "statement_timeout=30000" in verify["options"] and verify["gssencmode"] == "disable"
    assert require["sslmode"] == "require" and "sslrootcert" not in require


@needs_db
def test_a_connection_lost_mid_call_says_so(loopback) -> None:
    c, password = _conn()

    async def lost() -> None:
        conn = await pg.connect(c, password)
        await conn.close()
        await pg.run_sql(conn, "SELECT 1", True)

    with pytest.raises(pg.Invalid, match="^PostgreSQL: "):
        run(lost())


@needs_db
def test_a_check_says_when_the_connection_is_lost_or_too_slow(loopback, monkeypatch) -> None:
    c, password = _conn()
    opened = pg.connect

    async def lost(*args, **kwargs):
        conn = await opened(*args, **kwargs)
        await conn.close()
        return conn

    with monkeypatch.context() as m:
        m.setattr(pg, "connect", lost)
        with pytest.raises(pg.Invalid, match="^PostgreSQL: the connection is closed"):
            run(pg.check(c, password, "SELECT 1"))

    async def hang(*args, **kwargs):
        await asyncio.sleep(5)

    monkeypatch.setattr(pg, "connect", hang)
    with pytest.raises(pg.Invalid) as e:
        run(pg.check(c, password, "SELECT 1", pg.Limits(total=0.2)))
    assert e.value.message == "PostgreSQL: the call took longer than 0 seconds and was stopped."


@needs_db
def test_a_stored_connection_without_a_password_is_tried_without_one(client: TestClient, me: dict[str, str], loopback) -> None:  # noqa: F811
    tool = _pg(client, me).json()
    tested = client.post("/api/v1/tools/test", json={"kind": "postgres", "name": "shop", "config": _cfg(), "tool_id": tool["id"]}, headers=me).json()
    assert tested["ok"] is False and "password" in tested["error"]
