"""Snowflake for agents living in Wysebee Cloud: the checks, the read-only guard, the key
pair's JWT and the SQL API's requests against a fake Snowflake
(apps/cloud/agent_chat/snowflake.py), and — against a real database, skipped without
WYSEBEE_TEST_DATABASE_URL — the connections' routes on any plan (apps/cloud/user_tools.py),
the plan route, and a cloud agent's tools using them."""

import asyncio
import base64
import hashlib
import json
import uuid

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud.agent_chat import snowflake as sf
from apps.cloud.agent_chat.postgres import Invalid
from apps.cloud.envelope import EnvelopeError
from tests.cloud_agent_fixtures import (  # noqa: F401 — fixtures
    _agent,
    _agent_id,
    _call,
    _client,
    _connect,
    _give_tools,
    _save_tool,
    _offered,
    client,
    me,
)
from tests.conftest import needs_db

GOOD = {"account": "myorg-acct", "database": "SHOP"}
QUICK = sf.Limits(statement=30, total=5, poll=0.005)


def run(coro):
    return asyncio.run(coro)


def rows(columns: list[str], data: list[list]) -> dict:
    return {"resultSetMetaData": {"numRows": len(data), "rowType": [{"name": c} for c in columns]}, "data": data}


class Snow:
    """A fake Snowflake account: answers what the test queues (else one row), records what
    it was sent."""

    def __init__(self) -> None:
        self.replies: list[tuple[int, object]] = []
        self.sent: list[dict] = []

    async def handle(self, request: httpx.Request) -> httpx.Response:
        self.sent.append({"method": request.method, "url": str(request.url), "headers": dict(request.headers), "body": json.loads(request.content) if request.content else None})
        status, body = self.replies.pop(0) if self.replies else (200, rows(["N"], [["1"]]))
        return httpx.Response(status, text=body) if isinstance(body, str) else httpx.Response(status, json=body)

    def http(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handle))


@pytest.fixture(scope="module")
def key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def pem(key, fmt=serialization.PrivateFormat.PKCS8, encryption=None) -> str:
    return key.private_bytes(serialization.Encoding.PEM, fmt, encryption or serialization.NoEncryption()).decode()


# --- checks -------------------------------------------------------------------------------


def test_a_connection_is_checked_as_the_desktop_checks_it() -> None:
    assert sf.parse("sales", {**GOOD, "description": " Orders "}) == sf.Connection("sales", "Orders", "myorg-acct", "SHOP", "", "", "", "", "token", False)
    c = sf.parse("ops", {**GOOD, "auth": "key", "user": "ada", "changes": True, "warehouse": "WH", "schema": "PUBLIC", "role": "ANALYST"})
    assert (c.auth, c.user, c.changes, c.warehouse, c.schema, c.role) == ("key", "ada", True, "WH", "PUBLIC", "ANALYST")
    for name, entry, why in [
        ("Sales", GOOD, "Its name"),
        ("sales", {**GOOD, "description": "x" * 1001}, "what it holds"),
        # The account is the host asked: nothing that could name another.
        ("sales", {**GOOD, "account": "evil.example/x"}, "Snowflake account"),
        ("sales", {**GOOD, "account": "a@b"}, "Snowflake account"),
        ("sales", {"database": "SHOP"}, "Snowflake account"),
        ("sales", {**GOOD, "auth": "password"}, "token or a key"),
        ("sales", {**GOOD, "changes": "yes"}, "'changes'"),
        ("sales", {"account": "myorg-acct"}, "database's name"),
        ("sales", {**GOOD, "warehouse": "big wh"}, "warehouse"),
        ("sales", {**GOOD, "role": "r" * 256}, "role"),
        ("sales", {**GOOD, "auth": "key"}, "user name"),
    ]:
        with pytest.raises(Invalid) as e:
            sf.parse(name, entry)
        assert why in e.value.message, (entry, e.value.message)


def test_only_statements_that_read_pass_a_read_only_connection() -> None:
    for sql in ["select 1", "  SELECT * FROM t", "with a as (select 1) select * from a", "SHOW TABLES", "describe table t", "DESC t", "explain select 1", "-- why\nselect 1", "/* a */ /* b */ (select 1)", "((select 1))"]:
        assert sf.reads_only(sql), sql
    for sql in ["insert into t values (1)", "DELETE FROM t", "update t set a = 1", "drop table t", "call p()", "-- select\ndelete from t", "/* select */ truncate t", "-- only a comment", "/* never closed", "", "selection", "1"]:
        assert not sf.reads_only(sql), sql


def test_the_tools_read_like_the_desktops() -> None:
    assert sf.tool_defs([]) == []
    defs = sf.tool_defs([sf.parse("sales", {**GOOD, "description": "Orders"}), sf.parse("ops", {**GOOD, "changes": True})])
    assert [d["name"] for d in defs] == [sf.SCHEMA, sf.QUERY]
    assert "- sales (read only): database SHOP in account myorg-acct — Orders" in defs[1]["description"]
    assert "- ops (read and write)" in defs[1]["description"]
    assert defs[0]["input_schema"]["properties"]["database"]["enum"] == ["sales", "ops"]


def test_rows_come_back_capped_and_cut() -> None:
    out = sf.rows_of(rows(["ID", "NOTE"], [["1", "x" * (sf.MAX_VALUE_CHARS + 5)], ["2", None]]))
    assert out["columns"] == ["ID", "NOTE"] and len(out["rows"][0][1]) == sf.MAX_VALUE_CHARS + 1 and out["rows"][1] == ["2", None] and out["truncated"] is False
    out = sf.rows_of({"resultSetMetaData": {"rowType": [{"name": "N"}]}, "data": [[str(i)] for i in range(sf.MAX_ROWS + 5)]})
    assert len(out["rows"]) == sf.MAX_ROWS and out["truncated"] is True
    # More partitions than the first: said so.
    assert sf.rows_of({"resultSetMetaData": {"numRows": 9000, "rowType": []}, "data": [["a"]]})["truncated"] is True
    assert len(sf.rows_of({"data": [["y" * 1900] for _ in range(40)]})["rows"]) < 40
    assert sf.rows_of({}) == {"columns": [], "rows": [], "truncated": False}


def test_a_key_pair_signs_a_short_lived_jwt(key) -> None:
    token = sf.jwt_for("xy12345.us-east-1", "ada", pem(key), 1_700_000_000)
    public = key.public_key()
    spki = public.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    fingerprint = base64.b64encode(hashlib.sha256(spki).digest()).decode()
    claims = jwt.decode(token, public, algorithms=["RS256"], options={"verify_exp": False, "verify_iat": False})
    # The account without its region, and the user, in capitals; ten minutes.
    assert claims == {"iss": f"XY12345.ADA.SHA256:{fingerprint}", "sub": "XY12345.ADA", "iat": 1_700_000_000, "exp": 1_700_000_600}
    # The older PEM form is the same key.
    assert jwt.decode(sf.jwt_for("myorg-acct", "Ada", pem(key, serialization.PrivateFormat.TraditionalOpenSSL), 5), public, algorithms=["RS256"], options={"verify_exp": False, "verify_iat": False})["sub"] == "MYORG-ACCT.ADA"
    for bad, why in [
        (pem(key, encryption=serialization.BestAvailableEncryption(b"pw")), "passphrase"),
        ("a token, not a key", "could not be read"),
        (pem(ec.generate_private_key(ec.SECP256R1())), "could not be read"),
    ]:
        with pytest.raises(Invalid) as e:
            sf.jwt_for("a", "u", bad, 5)
        assert why in e.value.message


# --- the SQL API ---------------------------------------------------------------------------


def test_a_statement_is_one_signed_request_and_its_rows_come_back(key) -> None:
    snow = Snow()
    c = sf.parse("sales", {**GOOD, "account": "MyOrg-Acct", "warehouse": "WH", "role": "ANALYST"})
    snow.replies.append((200, rows(["ID", "NAME"], [["1", "Ada"], ["2", None]])))
    out = run(sf.run(snow.http(), c, " pat-123 \n", "SELECT * FROM people", QUICK))
    assert out == {"columns": ["ID", "NAME"], "rows": [["1", "Ada"], ["2", None]], "truncated": False}
    sent = snow.sent[0]
    # The account is the host, in small letters: nowhere else is ever asked.
    assert (sent["method"], sent["url"]) == ("POST", "https://myorg-acct.snowflakecomputing.com/api/v2/statements")
    assert (sent["headers"]["authorization"], sent["headers"]["x-snowflake-authorization-token-type"]) == ("Bearer pat-123", "PROGRAMMATIC_ACCESS_TOKEN")
    assert sent["body"] == {"statement": "SELECT * FROM people", "timeout": 30, "database": "SHOP", "warehouse": "WH", "role": "ANALYST"}

    # A key pair sends its JWT, said to be one.
    keyed = sf.parse("sales", {**GOOD, "auth": "key", "user": "ada"})
    run(sf.run(snow.http(), keyed, pem(key), "SELECT 1", QUICK))
    assert snow.sent[-1]["headers"]["x-snowflake-authorization-token-type"] == "KEYPAIR_JWT"
    assert jwt.decode(snow.sent[-1]["headers"]["authorization"].removeprefix("Bearer "), key.public_key(), algorithms=["RS256"])["sub"] == "MYORG-ACCT.ADA"

    # Still running: asked after by its handle until it ends.
    snow.replies += [(202, {"statementHandle": "01ab-cd"}), (202, {"statementHandle": "01ab-cd"}), (200, rows(["N"], [["7"]]))]
    assert run(sf.run(snow.http(), c, "tok", "SELECT 7", QUICK))["rows"] == [["7"]]
    assert [s["url"] for s in snow.sent[-2:]] == ["https://myorg-acct.snowflakecomputing.com/api/v2/statements/01ab-cd"] * 2
    # …a handle that could not go in an address is not asked after; one that never ends is given up.
    for reply, limits, why in [
        ((202, {"statementHandle": "../x"}), QUICK, "gave no handle"),
        ((202, {}), QUICK, "gave no handle"),
        ((422, {"code": "001003", "message": "SQL compilation error: syntax error line 1"}), QUICK, "Snowflake: SQL compilation error: syntax error line 1"),
        ((401, {"message": "JWT token is invalid."}), QUICK, "JWT token is invalid. Check the connection's token or key"),
        ((503, "<html>down</html>"), QUICK, "Snowflake: it answered 503"),
        ((500, [1]), QUICK, "Snowflake: it answered 500"),
        ((200, "x" * (sf.MAX_READ_BYTES + 10)), QUICK, "larger than 8 MB"),
    ]:
        snow.replies[:] = [reply]
        with pytest.raises(Invalid) as e:
            run(sf.run(snow.http(), c, "tok", "SELECT 1", limits))
        assert why in e.value.message, e.value.message
    snow.replies[:] = [(202, {"statementHandle": "slow"})] * 500
    with pytest.raises(Invalid) as e:
        run(sf.run(snow.http(), c, "tok", "SELECT 1", sf.Limits(total=0.05, poll=0.005)))
    assert "took longer than 0 seconds" in e.value.message

    async def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route")

    with pytest.raises(Invalid) as e:
        run(sf.run(httpx.AsyncClient(transport=httpx.MockTransport(down)), c, "tok", "SELECT 1", QUICK))
    assert e.value.message == "Snowflake could not be reached: ConnectError"


def test_a_call_says_what_is_missing() -> None:
    snow = Snow()
    connections = [sf.parse("sales", GOOD), sf.parse("ops", {**GOOD, "changes": True}), sf.parse("empty", GOOD)]

    async def secret(name: str) -> str | None:
        return None if name == "empty" else "pat-9"

    def call(tool: str, args: dict):
        return run(sf.call(snow.http(), connections, secret, tool, args, QUICK))

    for args, why in [
        ({"sql": "SELECT 1"}, "Say which database: one of sales, ops, empty."),
        ({"database": "sales"}, "Give the SQL statement to run."),
        ({"database": "sales", "sql": "x" * (sf.MAX_SQL_CHARS + 1)}, "longer than"),
        ({"database": "sales", "sql": "DELETE FROM orders"}, "'sales' is read only"),
        ({"database": "empty", "sql": "SELECT 1"}, "no access token or key yet"),
    ]:
        out = call(sf.QUERY, args)
        assert out.is_error and why in out.text, out.text
    assert snow.sent == []
    # Where changes are allowed, anything is sent; the schema tool groups columns by table.
    assert not call(sf.QUERY, {"database": "ops", "sql": "DELETE FROM orders"}).is_error
    snow.replies.append((200, rows(["S", "T", "C", "D", "N"], [["PUBLIC", "ORDERS", "ID", "NUMBER", "NO"], ["PUBLIC", "ORDERS", "NOTE", "TEXT", "YES"]])))
    out = call(sf.SCHEMA, {"database": "sales"})
    assert json.loads(out.text)["tables"] == [{"table": "PUBLIC.ORDERS", "columns": [{"name": "ID", "type": "NUMBER", "nullable": False}, {"name": "NOTE", "type": "TEXT", "nullable": True}]}]
    assert snow.sent[-1]["body"]["statement"] == sf.SCHEMA_SQL
    # The test answers Snowflake's version, and needs a secret.
    snow.replies.append((200, rows(["V"], [["9.30.1"]])))
    assert run(sf.test(snow.http(), connections[0], "pat", QUICK)) == "9.30.1"
    snow.replies.append((200, rows(["V"], [])))
    assert run(sf.test(snow.http(), connections[0], "pat", QUICK)) == ""
    with pytest.raises(Invalid):
        run(sf.test(snow.http(), connections[0], None, QUICK))


def test_a_sql_tools_statement_is_held_to_its_connection_and_checked_unrun() -> None:
    snow = Snow()
    sales, ops = sf.parse("sales", GOOD), sf.parse("ops", {**GOOD, "changes": True})
    # A SQL Query tool's statement: only a read on a read-only connection, and only with a secret.
    refused = run(sf.execute(snow.http(), sales, "pat-9", "DELETE FROM orders WHERE id = ?", {"1": {"type": "FIXED", "value": "1"}}, QUICK))
    assert refused.is_error and refused.text.startswith("'sales' is read only: only SELECT, WITH, SHOW, DESCRIBE and EXPLAIN run on it.")
    bare = run(sf.execute(snow.http(), ops, None, "SELECT 1", {}, QUICK))
    assert bare == sf.Output("'ops' has no access token or key yet: enter one in the connection, on the agent's General tab.", True)
    assert snow.sent == []
    # Checked: explained, never run, its values bound; no secret, nothing sent.
    with pytest.raises(Invalid, match="^Enter the connection's access token or private key first"):
        run(sf.check(snow.http(), sales, None, "SELECT 1", {}, QUICK))
    assert snow.sent == []
    run(sf.check(snow.http(), sales, "pat-9", "SELECT * FROM orders WHERE id = ?", {"1": {"type": "FIXED", "value": "0"}}, QUICK))
    assert snow.sent[-1]["body"]["statement"] == "EXPLAIN USING TEXT SELECT * FROM orders WHERE id = ?"
    assert snow.sent[-1]["body"]["bindings"] == {"1": {"type": "FIXED", "value": "0"}}
    snow.replies.append((422, {"code": "002003", "message": "SQL compilation error: Object 'NOWHERE' does not exist."}))
    with pytest.raises(Invalid, match="^Snowflake: SQL compilation error: Object 'NOWHERE' does not exist."):
        run(sf.check(snow.http(), sales, "pat-9", "SELECT * FROM nowhere", {}, QUICK))


# --- the routes, the plan and the tools --------------------------------------------------------


@pytest.fixture
def snow(client: TestClient) -> Snow:  # noqa: F811
    fake = Snow()
    client.app.state.ai_http = fake.http()
    return fake


def _sf(client: TestClient, me: dict[str, str], name: str = "sales", *, config: dict | None = None, secret: str | None = None, tool_id: str | None = None, description: str = ""):
    return _save_tool(client, me, "snowflake", name, description=description, config=GOOD if config is None else config, secret=secret, tool_id=tool_id)


def _test(client: TestClient, me: dict[str, str], **over):
    return client.post("/api/v1/tools/test", json={"kind": "snowflake", "name": "sales", "config": GOOD, **over}, headers=me)


@needs_db
def test_a_connection_is_added_on_any_plan(client: TestClient, me: dict[str, str], migrated_db_url: str, snow: Snow) -> None:  # noqa: F811
    user = me["X-Test-User"]
    assert _sf(client, me, "Sales", secret=" pat-1 ", description="Orders").status_code == 422
    # On Free (no subscription), since 2026-11-12.
    r = _sf(client, me, secret=" pat-1 ", description="Orders")
    assert r.status_code == 201, r.text
    saved = r.json()
    assert saved["has_secret"] is True and "secret" not in saved and saved["config"]["auth"] == "token" and saved["config"]["schema"] == ""
    assert [t["name"] for t in client.get("/api/v1/tools?kind=snowflake", headers=me).json()["tools"]] == ["sales"]
    # The secret is not in the row as it was typed.
    with create_engine(migrated_db_url).begin() as conn:
        stored = conn.execute(text("SELECT ciphertext FROM user_tools WHERE user_id = :u"), {"u": user}).scalar_one()
    assert b"pat-1" not in bytes(stored)

    # Test connection: the stored secret, one typed, and Snowflake's refusal in its words.
    snow.replies.append((200, rows(["V"], [["9.30.1"]])))
    assert _test(client, me, tool_id=saved["id"]).json() == {"ok": True, "version": "9.30.1", "error": None}
    assert snow.sent[-1]["headers"]["authorization"] == "Bearer pat-1"
    _test(client, me, secret=" typed ")
    assert snow.sent[-1]["headers"]["authorization"] == "Bearer typed"
    snow.replies.append((401, {"message": "Programmatic access token is invalid."}))
    got = _test(client, me, secret="bad").json()
    assert got["ok"] is False and "token is invalid" in got["error"]
    assert _test(client, me).json()["ok"] is False
    assert _test(client, me, config={"database": "X"}).status_code == 422
    assert _test(client, me, kind="website").status_code == 422
    client.app.state.snowflake_limit.per_minute = 0
    assert _test(client, me).status_code == 429
    client.app.state.snowflake_limit.per_minute = sf.CALLS_PER_MINUTE

    # Changed (the secret kept), another added, cleared or removed.
    r = _sf(client, me, config={**GOOD, "changes": True, "schema": "PUBLIC"}, tool_id=saved["id"])
    assert r.status_code == 200 and r.json()["config"]["changes"] is True and r.json()["has_secret"] is True and r.json()["config"]["schema"] == "PUBLIC"
    assert _sf(client, me, "ops", secret="pat-2").status_code == 201
    assert _sf(client, me, secret=" ", tool_id=saved["id"]).json()["has_secret"] is False
    assert client.delete(f"/api/v1/tools/{saved['id']}", headers=me).status_code == 204
    assert [t["name"] for t in client.get("/api/v1/tools?kind=snowflake", headers=me).json()["tools"]] == ["ops"]


@needs_db
def test_one_with_no_secret_is_tested_without_a_call(client: TestClient, me: dict[str, str], snow: Snow) -> None:  # noqa: F811
    saved = _sf(client, me, description="Orders").json()
    assert (saved["name"], saved["description"], saved["has_secret"]) == ("sales", "Orders", False)
    got = _test(client, me, tool_id=saved["id"]).json()
    assert got["ok"] is False and got["error"]
    assert snow.sent == []


@needs_db
def test_at_most_ten_connections_and_a_secret_needs_the_key(ui_dist, migrated_db_url: str, tmp_path, client: TestClient, me: dict[str, str], monkeypatch) -> None:  # noqa: F811
    _agent(client, me, "sky", {"label": "Sky"})
    for i in range(sf.MAX_CONNECTIONS + 1):
        assert _sf(client, me, f"c{i}").status_code == 201
    r = _give_tools(client, me, "sky", "snowflake", [f"c{i}" for i in range(sf.MAX_CONNECTIONS + 1)])
    assert r.status_code == 422 and "at most 10" in r.json()["detail"]

    # The vault refusing keeps nothing; no key-encryption key at all says so.
    async def refuse(*args, **kwargs):
        raise EnvelopeError("The key vault is not answering.")

    monkeypatch.setattr("apps.cloud.user_tools.seal", refuse)
    r = _sf(client, me, "fresh", secret="pat")
    assert r.status_code == 503 and "not answering" in r.json()["detail"]
    bare = _client(ui_dist, migrated_db_url, tmp_path)
    try:
        r = _sf(bare, me, "fresh", secret="pat")
        assert r.status_code == 503 and "no key-encryption key" in r.json()["detail"]
    finally:
        bare.__exit__(None, None, None)


@needs_db
def test_a_cloud_agent_queries_snowflake_on_any_plan(client: TestClient, me: dict[str, str], migrated_db_url: str, snow: Snow, monkeypatch) -> None:  # noqa: F811
    _agent(client, me, "sky", {"label": "Sky", "home": "cloud"})
    made = _connect(client, me, "sky", "snowflake", "sales", {**GOOD, "secret": "pat-1"})
    assert made.status_code == 201
    # The connection is not a tool the AI sees: a SQL Query tool on it is.
    assert _offered(client, me, "sky") == {"send_notification"}
    sql = {"connection_id": made.json()["id"], "params": [{"name": "region", "type": "string", "required": True}], "sql": "SELECT COUNT(*) FROM {database}.PUBLIC.ORDERS WHERE REGION = {region}"}
    assert _save_tool(client, me, "sql", "count_orders", description="Orders in a region.", config=sql).status_code == 201
    assert _give_tools(client, me, "sky", "sql", ["count_orders"]).status_code == 200

    def turn() -> str:
        return _call(client, me, "sky", "count_orders", {"region": "EU'; DROP TABLE x"}).text

    snow.replies.append((200, rows(["COUNT(*)"], [["12"]])))
    assert json.loads(turn())["rows"] == [["12"]]
    assert _offered(client, me, "sky") == {"send_notification", "count_orders"}
    assert snow.sent[-1]["headers"]["authorization"] == "Bearer pat-1"
    # The value is bound, never written into the statement.
    assert snow.sent[-1]["body"]["statement"] == "SELECT COUNT(*) FROM SHOP.PUBLIC.ORDERS WHERE REGION = ?"
    assert snow.sent[-1]["body"]["bindings"] == {"1": {"type": "TEXT", "value": "EU'; DROP TABLE x"}}
    sent = len(snow.sent)

    # At most so many a minute; a secret that cannot be read is said.
    client.app.state.snowflake_limit.per_minute = 0
    assert "Snowflake calls a minute" in turn()
    client.app.state.snowflake_limit.per_minute = sf.CALLS_PER_MINUTE

    async def unreadable(*args, **kwargs):
        raise EnvelopeError("The key vault is not answering.")

    with monkeypatch.context() as m:
        m.setattr("apps.cloud.user_tools.open_sealed", unreadable)
        assert "could not be read: The key vault is not answering." in turn()
    kek, client.app.state.ai_kek = client.app.state.ai_kek, None
    assert "no key-encryption key" in turn()
    client.app.state.ai_kek = kek

    assert len(snow.sent) == sent

    # The agent deleted: its link to the connection goes, the connection stays.
    assert client.delete(f"/api/v1/agents/{_agent_id(client, me, 'sky')}", headers=me).status_code == 204
    assert [t["name"] for t in client.get("/api/v1/tools?kind=snowflake", headers=me).json()["tools"]] == ["sales"]


@needs_db
def test_validate_asks_snowflake_to_explain_the_statement(client: TestClient, me: dict[str, str], snow: Snow) -> None:  # noqa: F811
    conn = _sf(client, me, secret="pat-1").json()["id"]
    bare = _sf(client, me, "bare").json()["id"]

    def validate(connection_id: str, sql: str, params: list | None = None) -> dict:
        r = client.post("/api/v1/tools/validate-sql", json={"name": "", "description": "", "config": {"connection_id": connection_id, "params": params or [], "sql": sql}}, headers=me)
        assert r.status_code == 200, r.text
        return r.json()

    region = [{"name": "region", "type": "string", "required": True}]
    assert validate(conn, "SELECT COUNT(*) FROM {database}.PUBLIC.ORDERS WHERE REGION = {region}", region) == {"ok": True, "error": None}
    # Explained, never run: every value a sample, bound.
    assert snow.sent[-1]["body"]["statement"] == "EXPLAIN USING TEXT SELECT COUNT(*) FROM SHOP.PUBLIC.ORDERS WHERE REGION = ?"
    assert snow.sent[-1]["body"]["bindings"]["1"]["type"] == "TEXT"
    snow.replies.append((422, {"code": "002003", "message": "SQL compilation error: Object 'NOWHERE' does not exist."}))
    assert validate(conn, "SELECT * FROM NOWHERE") == {"ok": False, "error": "Snowflake: SQL compilation error: Object 'NOWHERE' does not exist."}
    # No secret yet: said, nothing sent.
    sent = len(snow.sent)
    assert validate(bare, "SELECT 1") == {"ok": False, "error": "Enter the connection's access token or private key first, on the agent's General tab."}
    assert len(snow.sent) == sent
