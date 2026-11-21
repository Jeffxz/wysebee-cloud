"""SQL Query tools (apps/cloud/agent_chat/sql_tools.py): the template's checks and how a call is
rendered — values always bound — and, against the real test database, the routes that keep
and validate them (apps/cloud/user_tools.py) and an agent running one."""

import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from apps.cloud.agent_chat import postgres as pg
from apps.cloud.agent_chat import sql_tools as st
from apps.cloud.agent_chat.postgres import Invalid
from tests.cloud_agent_fixtures import _call as _tool
from tests.cloud_agent_fixtures import (  # noqa: F401 — fixtures
    _agent,
    _box,
    _connect,
    _give_tools,
    _offered,
    _save_tool,
    client,
    me,
)
from tests.conftest import needs_db
from tests.test_agent_mcp import _call as _assistant
from tests.test_agent_mcp import _signed, fake_verifier  # noqa: F401 — fixtures
from tests.test_cloud_postgres import _cfg, _db, loopback, table  # noqa: F401 — fixtures

CONN = "00000000-0000-0000-0000-0000000000aa"


def _p(name: str, type: str = "integer", **over) -> dict:
    return {"name": name, "type": type, **over}


def _parse(sql: str, params: list | None = None, name: str = "calc_my_metric") -> st.SqlTool:
    return st.parse(name, "Computes it.", {"connection_id": CONN, "params": params or [], "sql": sql})


# --- checks -------------------------------------------------------------------------------


def test_a_tool_is_checked() -> None:
    t = _parse("SELECT * FROM {database}.R.X WHERE BUILDING_ID = {building_id}", [_p("building_id", required=True, description=" Which building ")])
    assert t.params == (st.Param("building_id", "integer", "Which building", True, None, False),)
    assert t.config()["params"][0] == {"name": "building_id", "type": "integer", "description": "Which building", "required": True, "default": None, "optional": False}
    for name in ("calc-my-metric", "_x_", "a", "A" * 64):
        assert st.valid_name(name)
    for name in ("-a", "a-", "a b", "", "A" * 65, "naïve"):
        assert not st.valid_name(name)
    for sql, params, desc, config, why in [
        ("SELECT 1", [], "", None, "Say what the tool computes"),
        ("SELECT 1", [], "Computes.", {"connection_id": "nope"}, "Pick the database connection"),
        ("", [], "Computes.", None, "Write the SQL"),
        ("SELECT {x}", [], "Computes.", None, r"uses \{x\}, which is not a parameter"),
        ("SELECT 1", [_p("x")], "Computes.", None, r"does not use \{x\}"),
        ("SELECT {x}, {x}", [_p("x"), _p("x")], "Computes.", None, "Two parameters"),
        ("SELECT {database}", [_p("database")], "Computes.", None, "'database' is the connection"),
        ("SELECT {1x}", [_p("1x")], "Computes.", None, "A parameter's name"),
        ("SELECT {x}", [_p("x", "float")], "Computes.", None, "'x' is one of"),
        ("SELECT {x}", [_p("x", required=True, optional=True)], "Computes.", None, "cannot be required"),
        ("SELECT {x}", [_p("x", required="yes")], "Computes.", None, "'required' is true or false"),
        ("SELECT {x}", [_p("x", default="ten")], "Computes.", None, "whole number"),
        ("SELECT {x}", [_p("x", description="a\nb")], "Computes.", None, "on one line"),
        ("SELECT {x}", ["x"], "Computes.", None, "has a name and a type"),
        ("SELECT {x}", [_p("x", optional=True)], "Computes.", None, r"goes inside \[\["),
        ("SELECT 1 [[AND 1 = 1]]", [], "Computes.", None, "holds a parameter that only filters"),
        ("SELECT 1 [[AND {x} [[ ]]", [_p("x", optional=True)], "Computes.", None, "cannot hold another"),
        ("SELECT 1 [[AND {x}", [_p("x", optional=True)], "Computes.", None, "closed by"),
        ("SELECT 1", [_p(f"p{i}") for i in range(31)], "Computes.", None, "at most 30"),
        ("SELECT {x}", [_p("x", "string", default="x" * (st.MAX_DEFAULT + 1))], "Computes.", None, "'x''s default is at most 1000 characters"),
        ("SELECT '" + "x" * pg.MAX_SQL_CHARS + "'", [], "Computes.", None, f"The SQL is longer than {pg.MAX_SQL_CHARS} characters"),
    ]:
        with pytest.raises(Invalid, match=why):
            st.parse("calc", desc, config or {"connection_id": CONN, "params": params, "sql": sql})
    with pytest.raises(Invalid, match="^Its name has letters, digits, underscores and hyphens"):
        _parse("SELECT 1", name="-calc")


def test_values_are_checked_by_type() -> None:
    p = lambda t: st.Param("v", t, "", False, None, False)  # noqa: E731
    assert [st.value_of(p("integer"), v) for v in (3, 3.0, " -12 ")] == ["3", "3", "-12"]
    assert [st.value_of(p("number"), v) for v in (1.5, 2, "1e3", ".5")] == ["1.5", "2", "1e3", ".5"]
    assert [st.value_of(p("boolean"), v) for v in (True, False, "TRUE")] == ["true", "false", "true"]
    assert st.value_of(p("date"), "2026-11-17") == "2026-11-17"
    assert st.value_of(p("string"), 7) == "7"
    for kind, bad in [("integer", True), ("integer", 1.5), ("integer", "1;"), ("number", True), ("number", "x"), ("boolean", 1), ("date", "17/11/2026"), ("date", 20261117), ("string", True), ("string", ["x"]), ("string", "x" * 10_001)]:
        with pytest.raises(Invalid):
            st.value_of(p(kind), bad)


# --- rendering ----------------------------------------------------------------------------


def test_a_call_binds_every_value() -> None:
    t = _parse(
        "SELECT * FROM {database}.R.X WHERE B = {b} AND (A = {b} OR C = {c}) [[AND D >= {since}]] [[AND E = {e}]]",
        [_p("b", required=True), _p("c", "string", default="all"), _p("since", "date", optional=True), _p("e", "boolean", optional=True, default=True)],
    )
    r = st.render(t, {"b": 7, "since": "2026-01-01"}, "postgres", "shop")
    # A repeated parameter is the same $n; a part whose parameter has no value goes.
    assert r.sql == "SELECT * FROM shop.R.X WHERE B = $1 AND (A = $1 OR C = $2) AND D >= $3 AND E = $4"
    assert r.values == [("integer", "7"), ("string", "all"), ("date", "2026-01-01"), ("boolean", "true")]
    r = st.render(t, {"b": "7", "c": "x' OR 1=1 --"}, "snowflake", "my db")
    assert r.sql == 'SELECT * FROM "my db".R.X WHERE B = ? AND (A = ? OR C = ?)  AND E = ?'
    assert st.snowflake_bindings(r.values) == {
        "1": {"type": "FIXED", "value": "7"}, "2": {"type": "FIXED", "value": "7"}, "3": {"type": "TEXT", "value": "x' OR 1=1 --"}, "4": {"type": "BOOLEAN", "value": "true"},
    }
    with pytest.raises(Invalid, match="Give 'b'"):
        st.render(t, {}, "postgres", "shop")
    # To check a statement: every part kept, every parameter given.
    assert st.render(t, {}, "postgres", "shop", sample=True).values == [("integer", "0"), ("string", "all"), ("date", "2000-01-01"), ("boolean", "true")]
    # A parameter neither required nor given, outside [[ ]]: NULL.
    assert st.render(_parse("SELECT {n}", [_p("n")]), {}, "postgres", "x").values == [("integer", None)]
    assert st.identifier('a"b') == '"a""b"'


def test_the_ai_reads_its_input() -> None:
    t = _parse("SELECT {a} [[AND {b}]] {c}", [_p("a", required=True, description="The id."), _p("b", "date", optional=True), _p("c", "string", required=True, default="x")])
    d = st.tool_def(t, "PostgreSQL")
    assert d["name"] == "calc_my_metric" and d["description"].startswith("Computes it.")
    assert d["input_schema"] == {
        "type": "object",
        "properties": {
            "a": {"type": "integer", "description": "The id."},
            "b": {"type": "string", "format": "date", "description": "Leave it out to not filter by it."},
            "c": {"type": "string", "description": "Default: x."},
        },
        "required": ["a"],
    }
    assert "required" not in st.input_schema(_parse("SELECT 1"))


# --- against a real database ----------------------------------------------------------------


@needs_db
def test_tools_are_kept_with_their_connection(client: TestClient, me: dict[str, str], loopback) -> None:  # noqa: F811
    conn = _connect(client, me, "sky", "postgres", "shop", _cfg(password=_db()["password"])).json()["id"]
    body = {"connection_id": conn, "params": [_p("x", required=True)], "sql": "SELECT {x}"}
    chosen = str(uuid.uuid4())
    r = client.post("/api/v1/tools", json={"kind": "sql", "id": chosen, "name": "calc-x", "description": "X.", "config": body}, headers=me)
    assert r.status_code == 201, r.text
    assert (r.json()["id"], r.json()["config"]["params"][0]["name"]) == (chosen, "x")
    # The id is a new one's; the connection the person's own.
    again = client.post("/api/v1/tools", json={"kind": "sql", "id": chosen, "name": "other", "description": "X.", "config": body}, headers=me)
    assert again.status_code == 422 and "'id'" in again.json()["detail"]
    other = _save_tool(client, me, "sql", "y", description="Y.", config={**body, "connection_id": str(uuid.uuid4())})
    assert other.status_code == 422 and "database connections" in other.json()["detail"]
    bad = _save_tool(client, me, "sql", "y", description="Y.", config={**body, "sql": "SELECT {z}"})
    assert bad.status_code == 422 and "{z}" in bad.json()["detail"]
    renamed = _save_tool(client, me, "sql", "calc_x", description="X.", config=body, tool_id=chosen)
    assert renamed.status_code == 200 and renamed.json()["name"] == "calc_x"


@needs_db
def test_validate_asks_the_database_without_running(client: TestClient, me: dict[str, str], migrated_db_url: str, loopback, table: str) -> None:  # noqa: F811
    conn = _connect(client, me, "sky", "postgres", "shop", _cfg(password=_db()["password"])).json()["id"]

    def validate(sql: str, params: list | None = None) -> dict:
        r = client.post("/api/v1/tools/validate-sql", json={"name": "", "description": "", "config": {"connection_id": conn, "params": params or [], "sql": sql}}, headers=me)
        assert r.status_code == 200, r.text
        return r.json()

    assert validate(f"SELECT note FROM {table} WHERE id = {{id}} [[AND note = {{n}}]]", [_p("id", required=True), _p("n", "string", optional=True)]) == {"ok": True, "error": None}
    assert validate("SELECT nope FROM nowhere") == {"ok": False, "error": 'PostgreSQL: relation "nowhere" does not exist'}
    assert validate("SELECT {q}")["error"].startswith("The SQL uses {q}")
    # Never run, even where it would change data.
    assert validate(f"DELETE FROM {table}")["ok"]
    with create_engine(migrated_db_url).connect() as c:
        assert c.execute(text(f"SELECT count(*) FROM {table}")).scalar() == 3
    gone = client.post("/api/v1/tools/validate-sql", json={"config": {"connection_id": str(uuid.uuid4()), "sql": "SELECT 1"}}, headers=me)
    assert gone.status_code == 422
    client.app.state.postgres_limit = pg.RateLimit(per_minute=0)
    assert client.post("/api/v1/tools/validate-sql", json={"config": {"connection_id": conn, "sql": "SELECT 1"}}, headers=me).status_code == 429


@needs_db
def test_an_agent_runs_a_tool_with_its_values_bound(client: TestClient, me: dict[str, str], loopback, table: str) -> None:  # noqa: F811
    conn = _connect(client, me, "sky", "postgres", "shop", _cfg(password=_db()["password"])).json()["id"]
    sql = f"SELECT id FROM {table} WHERE 1 = 1 [[AND id >= {{least}}]] [[AND note = {{note}}]] ORDER BY id"
    params = [_p("least", optional=True), _p("note", "string", optional=True)]
    assert _save_tool(client, me, "sql", "ids", description="Ids.", config={"connection_id": conn, "params": params, "sql": sql}).status_code == 201
    # A tool whose name another tool has is left out.
    assert _save_tool(client, me, "sql", "send_notification", description="Clash.", config={"connection_id": conn, "sql": "SELECT 1"}).status_code == 201
    assert _give_tools(client, me, "sky", "sql", ["ids", "send_notification"]).status_code == 200
    assert _offered(client, me, "sky") == {"send_notification", "ids"}

    def ids(args: dict) -> list:
        out = _tool(client, me, "sky", "ids", args)
        assert not out.is_error, out.text
        return [r[0] for r in json.loads(out.text)["rows"]]

    assert ids({}) == ["1", "2", "3"]
    assert ids({"least": 2}) == ["2", "3"]
    # A value never changes the statement.
    assert ids({"note": "n1' OR '1'='1"}) == []
    assert ids({"note": "n3"}) == ["3"]
    bad = _tool(client, me, "sky", "ids", {"least": "two"})
    assert bad.is_error and "whole number" in bad.text
    # Read only unless the connection allows changes.
    assert _save_tool(client, me, "sql", "wipe", description="Wipes.", config={"connection_id": conn, "sql": f"DELETE FROM {table}"}).status_code == 201
    _give_tools(client, me, "sky", "sql", ["ids", "wipe"])
    refused = _tool(client, me, "sky", "wipe", {})
    assert refused.is_error and "read-only transaction" in refused.text


# --- drafted by the person's AI app (apps/cloud/tool_drafts.py) -----------------------------


@needs_db
def test_an_ai_app_drafts_a_tool_that_waits_for_the_person(client: TestClient, me: dict[str, str], loopback, table: str) -> None:  # noqa: F811
    auth = _signed(client, me)

    def ask(tool: str, args: dict) -> tuple[str, bool]:
        out = _assistant(client, auth, tool, args)
        return out["content"][0]["text"], out["isError"]

    _agent(client, me, "sky", {"label": "Sky"})
    assert ask("list_database_connections", {"agent": "sky"}) == ("@sky has no database connection yet: the person adds a PostgreSQL or Snowflake one on its General tab.", False)
    assert ask("list_database_connections", {"agent": "nobody"})[1]
    _connect(client, me, "sky", "postgres", "shop", _cfg(password=_db()["password"], description="The shop"))
    listed, _ = ask("list_database_connections", {"agent": "sky"})
    assert "- shop (PostgreSQL, database" in listed and "read only) — The shop" in listed and _db()["host"] not in listed
    # Its tables and columns, names only.
    tables = json.loads(ask("describe_database", {"agent": "sky", "connection": "shop"})[0])
    assert {"table": f"public.{table}", "columns": [{"name": "id", "type": "integer", "nullable": False}, {"name": "note", "type": "text", "nullable": True}]} in tables["tables"]
    assert ask("describe_database", {"agent": "sky", "connection": "nope"}) == ("Say which connection, by its name: shop.", True)
    tool = {"agent": "sky", "name": "notes_since", "description": "Notes from an id on.", "connection": "shop", "params": [{"name": "least", "type": "integer", "required": True}], "sql": f"SELECT note FROM {table} WHERE id >= {{least}}"}
    assert ask("check_sql_tool", {**tool, "sql": "SELECT * FROM nowhere WHERE id = {least}"}) == ('PostgreSQL: relation "nowhere" does not exist', True)
    assert ask("check_sql_tool", {**tool, "sql": "SELECT {x}"})[0].startswith("The SQL uses {x}")
    assert ask("check_sql_tool", tool)[0].startswith("Valid")
    drafted = json.loads(ask("draft_sql_tool", tool)[0])
    assert drafted["drafted"] == "notes_since" and drafted["review"].endswith("/tools") and "Only a draft" in drafted["note"]
    # A draft: listed, given, with a notification — and not offered to the agent.
    kept = client.get(f"/api/v1/tools/{drafted['id']}", headers=me).json()
    assert kept["config"]["draft"] is True
    assert "notes_since" not in _offered(client, me, "sky")
    assert "- notes_since (a draft, waiting for the person)" in ask("list_database_connections", {"agent": "sky"})[0]
    note = client.get("/api/v1/notifications", headers=me).json()["notifications"][0]
    assert note["title"] == "Review the SQL tool notes_since"
    assert ask("draft_sql_tool", tool)[0].startswith("The person already has a SQL tool named 'notes_since': pick another name")
    # The person creates it, from the website: no longer a draft, and the agent has it.
    created = _save_tool(client, me, "sql", "notes_since", description=kept["description"], config={k: v for k, v in kept["config"].items() if k != "draft"}, tool_id=drafted["id"])
    assert created.status_code == 200 and "draft" not in created.json()["config"]
    assert "notes_since" in _offered(client, me, "sky")


@needs_db
def test_a_connection_in_use_cannot_be_deleted(client: TestClient, me: dict[str, str], loopback) -> None:  # noqa: F811
    conn = _connect(client, me, "sky", "postgres", "shop", _cfg(password=_db()["password"])).json()["id"]
    _agent(client, me, "sea", {"label": "Sea Agent"})
    body = {"connection_id": conn, "params": [], "sql": "SELECT 1"}
    assert _save_tool(client, me, "sql", "ones", description="Ones.", config=body).status_code == 201
    assert _save_tool(client, me, "sql", "spare", description="Spare.", config=body).status_code == 201
    _give_tools(client, me, "sky", "sql", ["ones"])
    _give_tools(client, me, "sea", "sql", ["ones"])
    used = client.get(f"/api/v1/tools/{conn}/used-by", headers=me).json()["tools"]
    assert [(t["name"], t["draft"], [a["label"] for a in t["agents"]]) for t in used] == [("ones", False, ["Sea Agent", "sky"]), ("spare", False, [])]
    refused = client.delete(f"/api/v1/tools/{conn}", headers=me)
    assert refused.status_code == 409 and "(ones, spare)" in refused.json()["detail"]
    # Not a connection: nothing uses it.
    assert client.get(f"/api/v1/tools/{used[0]['id']}/used-by", headers=me).json() == {"tools": []}
    for t in used:
        assert client.delete(f"/api/v1/tools/{t['id']}", headers=me).status_code == 204
    # Unused, it goes — from every agent that had it.
    assert client.delete(f"/api/v1/tools/{conn}", headers=me).status_code == 204
    assert client.get("/api/v1/tools?kind=postgres", headers=me).json()["tools"] == []


@needs_db
def test_a_tool_that_no_longer_reads_is_left_out(client: TestClient, me: dict[str, str], migrated_db_url: str, loopback) -> None:  # noqa: F811
    conn = _connect(client, me, "sky", "postgres", "shop", _cfg(password=_db()["password"])).json()["id"]
    made = _save_tool(client, me, "sql", "ones", description="Ones.", config={"connection_id": conn, "params": [], "sql": "SELECT 1"})
    assert made.status_code == 201
    _give_tools(client, me, "sky", "sql", ["ones"])
    assert _offered(client, me, "sky") == {"send_notification", "ones"}
    # Kept from before a check it does not pass (its SQL gone): the agent is not offered it.
    with create_engine(migrated_db_url).begin() as c:
        c.execute(text("UPDATE user_tools SET config = config - 'sql' WHERE tool_id = CAST(:t AS uuid)"), {"t": made.json()["id"]})
    assert _offered(client, me, "sky") == {"send_notification"}
