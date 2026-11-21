"""Data migrations, run for real against the test database (skipped without
WYSEBEE_TEST_DATABASE_URL)."""

import json
import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

from tests.conftest import needs_db

pytestmark = needs_db


def _alembic(url: str) -> Config:
    cfg = Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))
    cfg.attributes["url"] = url
    return cfg


def test_0006_deletes_tool_credential_and_connection_items(migrated_db_url):
    me = f"test-{uuid.uuid4().hex}"
    kinds = ["tool", "credential", "database_connection", "agent", "skill"]
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    try:
        command.downgrade(cfg, "0005")
        with engine.begin() as conn:
            for i, kind in enumerate(kinds):
                # A live item and a tombstone of each kind.
                for n, deleted in enumerate([False, True]):
                    conn.execute(text(
                        "INSERT INTO cloud_configs (user_id, kind, item_id, name, data, secret, revision, deleted_at)"
                        " VALUES (:u, :k, :id, :name, '{}'::jsonb, :secret, :rev,"
                        " CASE WHEN :deleted THEN now() ELSE NULL END)"
                    ), {"u": me, "k": kind, "id": f"i{n}", "name": f"{kind}-{n}", "secret": "x" if kind == "credential" else None,
                        "rev": i * 2 + n + 1, "deleted": deleted})
        command.upgrade(cfg, "0062")
        with engine.connect() as conn:
            left = conn.execute(text(
                "SELECT kind, item_id FROM cloud_configs WHERE user_id = :u ORDER BY kind, item_id"
            ), {"u": me}).all()
        # Skills went later, with 0009; agents with 0063.
        assert [tuple(r) for r in left] == [("agent", "i0"), ("agent", "i1")]
    finally:
        command.upgrade(cfg, "head")
        with engine.begin() as conn:
            for table in ("user_tasks", "user_agents"):
                conn.execute(text(f"DELETE FROM {table} WHERE user_id = :u"), {"u": me})
            conn.execute(text("DELETE FROM user_agents WHERE user_id = :u"), {"u": me})
            conn.execute(text("DELETE FROM cloud_config_heads WHERE user_id = :u"), {"u": me})
        engine.dispose()


def test_0009_deletes_skill_items_and_nothing_else(migrated_db_url):
    me = f"test-{uuid.uuid4().hex}"
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    try:
        command.downgrade(cfg, "0008")
        with engine.begin() as conn:
            for i, kind in enumerate(["skill", "task", "profile"]):
                for n, deleted in enumerate([False, True]):
                    conn.execute(text(
                        "INSERT INTO cloud_configs (user_id, kind, item_id, name, data, revision, deleted_at)"
                        " VALUES (:u, :k, :id, :name, '{}'::jsonb, :rev, CASE WHEN :deleted THEN now() ELSE NULL END)"
                    ), {"u": me, "k": kind, "id": f"i{n}", "name": f"{kind}-{n}", "rev": i * 2 + n + 1, "deleted": deleted})
        command.upgrade(cfg, "0009")
        with engine.connect() as conn:
            left = conn.execute(text(
                "SELECT kind, item_id FROM cloud_configs WHERE user_id = :u ORDER BY kind, item_id"
            ), {"u": me}).all()
        assert [tuple(r) for r in left] == [("profile", "i0"), ("profile", "i1"), ("task", "i0"), ("task", "i1")]
        # The desktop's profile items went later, with 0062.
        command.upgrade(cfg, "0064")
        with engine.connect() as conn:
            left = conn.execute(text("SELECT kind FROM cloud_configs WHERE user_id = :u ORDER BY kind, item_id"), {"u": me}).all()
        assert [r[0] for r in left] == ["task", "task"]
    finally:
        command.upgrade(cfg, "head")
        with engine.begin() as conn:
            for table in ("user_tasks", "user_agents"):
                conn.execute(text(f"DELETE FROM {table} WHERE user_id = :u"), {"u": me})
            conn.execute(text("DELETE FROM cloud_config_heads WHERE user_id = :u"), {"u": me})
        engine.dispose()


def test_0031_drops_the_people_s_ai_keys_and_its_downgrade_makes_the_table_again(migrated_db_url):
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    exists = text("SELECT to_regclass('public.cloud_ai_keys') IS NOT NULL")
    try:
        command.downgrade(cfg, "0030")
        with engine.begin() as conn:
            assert conn.execute(exists).scalar_one()
            conn.execute(text("INSERT INTO cloud_ai_keys (user_id, provider, ciphertext, nonce, wrapped_key, kek_id) VALUES ('u', 'anthropic', 'x', 'n', 'w', 'local:1')"))
        command.upgrade(cfg, "head")
        with engine.connect() as conn:
            assert not conn.execute(exists).scalar_one()
    finally:
        command.upgrade(cfg, "head")
        engine.dispose()


def test_0044_makes_the_browser_link_tables_and_its_downgrade_drops_them(migrated_db_url):
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    exists = text("SELECT to_regclass('public.browser_links') IS NOT NULL AND to_regclass('public.browser_calls') IS NOT NULL")
    try:
        command.downgrade(cfg, "0043")
        with engine.connect() as conn:
            assert not conn.execute(exists).scalar_one()
        command.upgrade(cfg, "head")
        with engine.begin() as conn:
            assert conn.execute(exists).scalar_one()
            conn.execute(text("INSERT INTO browser_links (id, code, code_expires_at, secret_hash, name, agent_type_id) VALUES ('m44', 'MIGRATE4', now(), 'h', 'Scout', '6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c01')"))
            conn.execute(text("INSERT INTO browser_calls (id, link_id, user_id, op, args, status, timeout_seconds) VALUES ('c44', 'm44', 'u', 'ping', '{}'::jsonb, 'pending', 60)"))
            # A link's calls go with it.
            conn.execute(text("DELETE FROM browser_links WHERE id = 'm44'"))
            assert conn.execute(text("SELECT count(*) FROM browser_calls WHERE id = 'c44'")).scalar_one() == 0
    finally:
        command.upgrade(cfg, "head")
        engine.dispose()


def test_0045_gives_a_link_its_kind_and_what_its_mac_allowed(migrated_db_url):
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    columns = text("SELECT count(*) FROM information_schema.columns WHERE table_name = 'browser_links' AND column_name IN ('kind', 'approved')")
    try:
        command.downgrade(cfg, "0044")
        with engine.begin() as conn:
            assert conn.execute(columns).scalar_one() == 0
            conn.execute(text("INSERT INTO browser_links (id, code, code_expires_at, secret_hash, name) VALUES ('m45', 'MIGRATE5', now(), 'h', 'Scout')"))
        command.upgrade(cfg, "head")
        with engine.begin() as conn:
            assert conn.execute(columns).scalar_one() == 2
            # A link from before is a browser's, with nothing allowed.
            assert conn.execute(text("SELECT kind, approved FROM browser_links WHERE id = 'm45'")).one() == ("browser", [])
            conn.execute(text("UPDATE browser_links SET kind = 'osx', approved = '[\"open_postman\"]'::jsonb WHERE id = 'm45'"))
            assert conn.execute(text("SELECT approved FROM browser_links WHERE id = 'm45'")).scalar_one() == ["open_postman"]
    finally:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM browser_links WHERE id = 'm45'"))
        command.upgrade(cfg, "head")
        engine.dispose()


def test_0046_gives_a_link_the_skills_its_mac_allowed(migrated_db_url):
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    column = text("SELECT count(*) FROM information_schema.columns WHERE table_name = 'browser_links' AND column_name = 'approved_skills'")
    try:
        command.downgrade(cfg, "0045")
        with engine.begin() as conn:
            assert conn.execute(column).scalar_one() == 0
            conn.execute(text("INSERT INTO browser_links (id, code, code_expires_at, secret_hash, name, kind) VALUES ('m46', 'MIGRATE6', now(), 'h', 'Studio Mac', 'osx')"))
        command.upgrade(cfg, "head")
        with engine.begin() as conn:
            assert conn.execute(column).scalar_one() == 1
            # A link from before has allowed no skill.
            assert conn.execute(text("SELECT approved_skills FROM browser_links WHERE id = 'm46'")).scalar_one() == []
    finally:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM browser_links WHERE id = 'm46'"))
        command.upgrade(cfg, "head")
        engine.dispose()


def test_0047_gives_a_link_the_folders_its_mac_offers(migrated_db_url):
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    column = text("SELECT count(*) FROM information_schema.columns WHERE table_name = 'browser_links' AND column_name = 'folders'")
    try:
        command.downgrade(cfg, "0046")
        with engine.begin() as conn:
            assert conn.execute(column).scalar_one() == 0
            conn.execute(text("INSERT INTO browser_links (id, code, code_expires_at, secret_hash, name, kind) VALUES ('m47', 'MIGRATE7', now(), 'h', 'Studio Mac', 'osx')"))
        command.upgrade(cfg, "head")
        with engine.begin() as conn:
            assert conn.execute(column).scalar_one() == 1
            # A link from before offers no folder.
            assert conn.execute(text("SELECT folders FROM browser_links WHERE id = 'm47'")).scalar_one() == []
    finally:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM browser_links WHERE id = 'm47'"))
        command.upgrade(cfg, "head")
        engine.dispose()


def test_0048_moves_a_browsers_agent_to_the_cloud(migrated_db_url):
    import json

    me = f"test-{uuid.uuid4().hex}"
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    agents = {
        "chrome": {"label": "Chrome", "browser_access": True, "browser_link": "l1", "home": "desk-1", "home_name": "Sam's Mac"},
        "edge": {"label": "Edge", "browser_link": "l2", "home": "cloud", "home_name": "Wysebee Cloud"},
        "mac": {"label": "Mac", "mac_link": "m1", "home": "desk-1", "home_name": "Sam's Mac"},
        "plain": {"label": "Plain"},
    }
    try:
        command.downgrade(cfg, "0047")
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO cloud_config_heads (user_id, revision) VALUES (:u, 5)"), {"u": me})
            for n, (name, config) in enumerate(agents.items(), start=1):
                conn.execute(
                    text("INSERT INTO cloud_configs (user_id, kind, item_id, name, data, revision) VALUES (:u, 'agent', :i, :n, CAST(:d AS jsonb), :r)"),
                    {"u": me, "i": f"i-{name}", "n": name, "d": json.dumps({"AGENT_NAME": name, "CONFIG": json.dumps(config)}), "r": n},
                )
            # Unreadable settings are left alone.
            conn.execute(text("INSERT INTO cloud_configs (user_id, kind, item_id, name, data, revision) VALUES (:u, 'agent', 'i-bad', 'bad', '{\"CONFIG\": \"not json\"}'::jsonb, 5)"), {"u": me})
        command.upgrade(cfg, "0048")
        with engine.begin() as conn:
            rows = {r.name: (json.loads(r.data["CONFIG"]), r.revision, r.changed_by) for r in conn.execute(text("SELECT name, data, revision, changed_by FROM cloud_configs WHERE user_id = :u AND name <> 'bad'"), {"u": me})}
            bad = conn.execute(text("SELECT data, changed_by FROM cloud_configs WHERE user_id = :u AND name = 'bad'"), {"u": me}).one()
            head = conn.execute(text("SELECT revision FROM cloud_config_heads WHERE user_id = :u"), {"u": me}).scalar_one()
        assert rows["chrome"] == ({**agents["chrome"], "home": "cloud", "home_name": "Wysebee Cloud"}, 6, "migration/0048")
        assert head == 6
        assert tuple(bad) == ({"CONFIG": "not json"}, None)
        for name in ("edge", "mac", "plain"):
            assert rows[name][0] == agents[name] and rows[name][2] is None, name
    finally:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM cloud_configs WHERE user_id = :u"), {"u": me})
            conn.execute(text("DELETE FROM cloud_config_heads WHERE user_id = :u"), {"u": me})
        command.upgrade(cfg, "head")
        engine.dispose()


def test_0049_moves_every_agent_living_elsewhere_to_the_cloud_and_back(migrated_db_url):
    import json

    me = f"test-{uuid.uuid4().hex}"
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    agents = {
        "desk": {"label": "Desk", "home": "desk-1", "home_name": "Sam's PC"},
        "mac": {"label": "Mac", "mac_link": "m1", "home": "desk-2"},
        "cloud": {"label": "Cloud", "home": "cloud", "home_name": "Wysebee Cloud"},
        "plain": {"label": "Plain"},
    }

    def read():
        with engine.begin() as conn:
            rows = {r.name: (json.loads(r.data["CONFIG"]), r.revision, r.changed_by) for r in conn.execute(text("SELECT name, data, revision, changed_by FROM cloud_configs WHERE user_id = :u"), {"u": me})}
            head = conn.execute(text("SELECT revision FROM cloud_config_heads WHERE user_id = :u"), {"u": me}).scalar_one()
        return rows, head

    try:
        command.downgrade(cfg, "0048")
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO cloud_config_heads (user_id, revision) VALUES (:u, 4)"), {"u": me})
            for n, (name, config) in enumerate(agents.items(), start=1):
                conn.execute(
                    text("INSERT INTO cloud_configs (user_id, kind, item_id, name, data, revision) VALUES (:u, 'agent', :i, :n, CAST(:d AS jsonb), :r)"),
                    {"u": me, "i": f"i-{name}", "n": name, "d": json.dumps({"AGENT_NAME": name, "CONFIG": json.dumps(config)}), "r": n},
                )
        command.upgrade(cfg, "0049")
        rows, head = read()
        assert rows["desk"][0] == {"label": "Desk", "home": "cloud", "home_name": "Wysebee Cloud", "former_home": "desk-1", "former_home_name": "Sam's PC"}
        assert rows["mac"][0] == {"label": "Mac", "mac_link": "m1", "home": "cloud", "home_name": "Wysebee Cloud", "former_home": "desk-2"}
        assert {rows["desk"][1], rows["mac"][1]} == {5, 6} and head == 6 and rows["desk"][2] == "migration/0049"
        for name in ("cloud", "plain"):
            assert rows[name][0] == agents[name] and rows[name][2] is None, name
        # Undone, each lives where it did.
        command.downgrade(cfg, "0048")
        rows, _ = read()
        for name in agents:
            assert rows[name][0] == agents[name], name
    finally:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM cloud_configs WHERE user_id = :u"), {"u": me})
            conn.execute(text("DELETE FROM cloud_config_heads WHERE user_id = :u"), {"u": me})
        command.upgrade(cfg, "head")
        engine.dispose()


def test_0050_makes_agent_types_and_types_every_link_and_agent(migrated_db_url):
    import json

    me = f"test-{uuid.uuid4().hex}"
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    chrome, osx = "6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c01", "6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c02"
    agents = {
        "scout": {"label": "Scout", "browser_link": "b50", "paired_kind": "browser"},
        "studio": {"label": "Studio", "paired_kind": "osx"},
        "older": {"label": "Older", "mac_link": "m50"},
        "plain": {"label": "Plain"},
        "unread": "not json",
    }

    def configs():
        with engine.begin() as conn:
            rows = conn.execute(text("SELECT name, data, changed_by FROM cloud_configs WHERE user_id = :u"), {"u": me}).all()
        return {r.name: (json.loads(r.data["CONFIG"]) if r.name != "unread" else r.data["CONFIG"], r.changed_by) for r in rows}

    try:
        command.downgrade(cfg, "0049")
        with engine.begin() as conn:
            for link, kind, agent in (("b50", "browser", "scout"), ("m50", "osx", "older")):
                conn.execute(text("INSERT INTO browser_links (id, user_id, code_expires_at, secret_hash, name, agent, kind) VALUES (:i, :u, now(), 'h', 'x', :a, :k)"), {"i": link, "u": me, "a": agent, "k": kind})
            for name, config in agents.items():
                data = {"AGENT_NAME": name, "CONFIG": config if isinstance(config, str) else json.dumps(config)}
                conn.execute(text("INSERT INTO cloud_configs (user_id, kind, item_id, name, data, revision) VALUES (:u, 'agent', :i, :n, CAST(:d AS jsonb), 1)"), {"u": me, "i": f"i-{name}", "n": name, "d": json.dumps(data)})
        command.upgrade(cfg, "0050")
        with engine.begin() as conn:
            types = {r.key: (str(r.id), r.name, r.link_field, r.ops, r.tool_kinds, r.enabled) for r in conn.execute(text("SELECT * FROM agent_types"))}
            links = dict(conn.execute(text("SELECT id, agent_type_id::text FROM browser_links WHERE user_id = :u"), {"u": me}).all())
        assert types["wysebee-osx"] == (osx, "Wysebee OSX Agent", "mac_link", ["ping", "local_run", "skill_run", "folder_call"], ["local", "folder", "sqlite", "skill_scripts"], True)
        assert types["wysebee-browser-chrome"][:3] == (chrome, "Wysebee Chrome Agent", "browser_link") and len(types["wysebee-browser-chrome"][3]) == 24
        assert links == {"b50": chrome, "m50": osx}
        rows = configs()
        assert rows["scout"] == ({**agents["scout"], "paired_kind": "wysebee-browser-chrome", "agent_type_id": chrome}, "migration/0050")
        assert rows["studio"] == ({**agents["studio"], "paired_kind": "wysebee-osx", "agent_type_id": osx}, "migration/0050")
        # Paired before paired_kind: from its link.
        assert rows["older"] == ({**agents["older"], "paired_kind": "wysebee-osx", "agent_type_id": osx}, "migration/0050")
        assert rows["plain"] == (agents["plain"], None) and rows["unread"] == ("not json", None)
        # Undone: the old kinds, no type ids, no table.
        command.downgrade(cfg, "0049")
        rows = configs()
        assert {n: rows[n][0] for n in ("scout", "studio")} == {"scout": agents["scout"], "studio": agents["studio"]}
        assert rows["older"][0] == {**agents["older"], "paired_kind": "osx"}
        with engine.begin() as conn:
            assert conn.execute(text("SELECT to_regclass('public.agent_types')")).scalar_one() is None
    finally:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM browser_links WHERE user_id = :u"), {"u": me})
            conn.execute(text("DELETE FROM cloud_configs WHERE user_id = :u"), {"u": me})
            conn.execute(text("DELETE FROM cloud_config_heads WHERE user_id = :u"), {"u": me})
        command.upgrade(cfg, "head")
        engine.dispose()


def test_0051_registers_wysebee_windows_and_keeps_one_registered_by_hand(migrated_db_url):
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    windows = "6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c04"

    def row():
        with engine.begin() as conn:
            r = conn.execute(text("SELECT id::text, name, link_field, ops, tool_kinds, enabled FROM agent_types WHERE key = 'wysebee-windows'")).first()
        return tuple(r) if r is not None else None

    try:
        # The Mac type's row, but for its key, name and description.
        assert row()[:2] == (windows, "Wysebee Windows Agent")
        # Links of it that other tests left in this database name it: gone first, as a real
        # downgrade needs every Windows PC unpaired.
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM browser_links WHERE agent_type_id = CAST(:i AS uuid)"), {"i": windows})
        command.downgrade(cfg, "0050")
        assert row() is None
        # Registered by hand meanwhile (Admin): kept as it is, not a second one.
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO agent_types (id, key, name, link_field, ops, tool_kinds) VALUES (gen_random_uuid(), 'wysebee-windows', 'By hand', 'mac_link', '[\"ping\"]', '[]')"))
        command.upgrade(cfg, "0051")
        assert row()[1:4] == ("By hand", "mac_link", ["ping"])
    finally:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM agent_types WHERE key = 'wysebee-windows'"))
        command.upgrade(cfg, "0050")
        command.downgrade(cfg, "0050")
        command.upgrade(cfg, "head")
        # Migration 0069 added program_run and any_program after it.
        # Later migrations (0069-0071) added ops and tool kinds after it.
        assert row()[:3] == (windows, "Wysebee Windows Agent", "mac_link") and row()[3][:4] == ["ping", "local_run", "skill_run", "folder_call"] and row()[4][:4] == ["local", "folder", "sqlite", "skill_scripts"]


def test_0059_registers_wysebee_android_and_keeps_one_registered_by_hand(migrated_db_url):
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    android = "6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c05"
    ops = ["ping", "android_apps", "android_launch", "android_snapshot", "android_screenshot", "android_tap", "android_type", "android_swipe", "android_scroll", "android_key"]

    def row():
        with engine.begin() as conn:
            r = conn.execute(text("SELECT id::text, name, link_field, ops, tool_kinds, enabled FROM agent_types WHERE key = 'wysebee-android'")).first()
        return tuple(r) if r is not None else None

    try:
        # Its own link field; its poll carries only calls, as a browser's does.
        assert row() == (android, "Wysebee Android Agent", "android_link", ops, ["android"], True)
        command.downgrade(cfg, "0058")
        assert row() is None
        # Registered by hand meanwhile (Admin): kept as it is, not a second one.
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO agent_types (id, key, name, link_field, ops, tool_kinds) VALUES (gen_random_uuid(), 'wysebee-android', 'By hand', 'android_link', '[\"ping\"]', '[]')"))
        command.upgrade(cfg, "0059")
        assert row()[1:4] == ("By hand", "android_link", ["ping"])
    finally:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM agent_types WHERE key = 'wysebee-android'"))
        command.downgrade(cfg, "0058")
        command.upgrade(cfg, "head")
        assert row() == (android, "Wysebee Android Agent", "android_link", ops, ["android"], True)
        engine.dispose()


def test_0060_moves_skills_to_tables_linked_by_id_and_back(migrated_db_url):
    me, other = f"test-{uuid.uuid4().hex}", f"test-{uuid.uuid4().hex}"
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    good = {"path": "SKILL.md", "id": "a" * 64, "size": 12}
    files = [good, {"path": "x", "id": "A" * 64, "size": 1}, {"path": "", "id": "a" * 64, "size": 1}, {"path": "y", "id": "a" * 64, "size": True}, "SKILL.md"]

    def item(user, kind, item_id, name, data, deleted=False):
        return {"u": user, "k": kind, "i": item_id, "n": name, "d": json.dumps(data), "del": deleted}

    def agent(skills):
        return {"AGENT_NAME": "x", "CONFIG": json.dumps({"label": "X", **({"skills": skills} if skills is not None else {})})}

    try:
        command.downgrade(cfg, "0059")
        with engine.begin() as conn:
            for row in (
                item(me, "skill", "forecast", "forecast", {"SKILL_NAME": "forecast", "DESCRIPTION": "Weather.", "CONFIG": json.dumps({"files": files})}),
                item(me, "skill", "bare", "bare", {"CONFIG": "{not json"}),
                item(me, "skill", "Bad.Name", "Bad.Name", {"DESCRIPTION": "Never read."}),
                item(me, "skill", "old", "old", {}, deleted=True),
                item(other, "skill", "forecast", "forecast", {"DESCRIPTION": "Theirs.", "CONFIG": json.dumps({"files": "x"})}),
                item(me, "agent", "a1", "sky", agent(["bare", "missing", "forecast", 5, "bare", "old"])),
                item(me, "agent", "a2", "plain", agent(None)),
                item(me, "agent", "a3", "odd", {"CONFIG": "not json"}),
                item(me, "agent", "a4", "gone", agent(["forecast"]), deleted=True),
                item(other, "agent", "b1", "theirs", agent("forecast")),
            ):
                conn.execute(text(
                    "INSERT INTO cloud_configs (user_id, kind, item_id, name, data, revision, deleted_at)"
                    " VALUES (:u, :k, :i, :n, CAST(:d AS jsonb), 1, CASE WHEN :del THEN now() ELSE NULL END)"
                ), row)
            conn.execute(text("INSERT INTO cloud_config_heads (user_id, revision) VALUES (:u, 7)"), {"u": me})
        command.upgrade(cfg, "0060")
        with engine.begin() as conn:
            skills = {(r.user_id, r.name): r for r in conn.execute(text("SELECT skill_id::text AS id, user_id, name, description, files FROM user_skills WHERE user_id IN (:a, :b)"), {"a": me, "b": other})}
            assert sorted(skills) == sorted([(me, "forecast"), (me, "bare"), (other, "forecast")])
            assert (skills[(me, "forecast")].description, skills[(me, "forecast")].files) == ("Weather.", [good])
            assert (skills[(me, "bare")].description, skills[(me, "bare")].files) == ("", [])
            assert skills[(other, "forecast")].files == []
            links = conn.execute(text("SELECT user_id, agent_id, skill_id::text, position FROM agent_skills WHERE user_id IN (:a, :b) ORDER BY user_id, agent_id, position"), {"a": me, "b": other}).all()
            assert [tuple(r) for r in links] == [(me, "a1", skills[(me, "bare")].id, 0), (me, "a1", skills[(me, "forecast")].id, 1)]
            configs = dict(conn.execute(text("SELECT item_id, data->>'CONFIG' FROM cloud_configs WHERE user_id IN (:a, :b) AND kind = 'agent'"), {"a": me, "b": other}).all())
            assert json.loads(configs["a1"]) == json.loads(configs["a2"]) == json.loads(configs["b1"]) == {"label": "X"}
            assert configs["a3"] is None or configs["a3"] == "not json"
            assert conn.execute(text("SELECT count(*) FROM cloud_configs WHERE kind = 'skill' AND user_id IN (:a, :b)"), {"a": me, "b": other}).scalar_one() == 0
        # Back: the skills are items again, named in their agents' settings in order.
        command.downgrade(cfg, "0059")
        with engine.begin() as conn:
            back = {(r.user_id, r.item_id): r for r in conn.execute(text("SELECT user_id, item_id, name, data, revision FROM cloud_configs WHERE kind = 'skill' AND user_id IN (:a, :b)"), {"a": me, "b": other})}
            assert sorted(back) == sorted([(me, "forecast"), (me, "bare"), (other, "forecast")])
            forecast = back[(me, "forecast")]
            assert (forecast.name, forecast.revision, forecast.data["DESCRIPTION"], json.loads(forecast.data["CONFIG"])) == ("forecast", 7, "Weather.", {"files": [good]})
            assert back[(other, "forecast")].revision == 0
            sky = conn.execute(text("SELECT data->>'CONFIG' FROM cloud_configs WHERE user_id = :u AND item_id = 'a1'"), {"u": me}).scalar_one()
            assert json.loads(sky) == {"label": "X", "skills": ["bare", "forecast"]}
            # An agent whose settings cannot be read keeps them as they are.
            conn.execute(text("INSERT INTO cloud_configs (user_id, kind, item_id, name, data, revision) VALUES (:u, 'agent', 'a5', 'later', CAST(:d AS jsonb), 1)"), {"u": me, "d": json.dumps(agent(["forecast"]))})
        command.upgrade(cfg, "0060")
        with engine.begin() as conn:
            a5 = conn.execute(text("SELECT agent_id FROM agent_skills WHERE user_id = :u AND agent_id = 'a5'"), {"u": me}).scalar_one()
            conn.execute(text("UPDATE cloud_configs SET data = '{\"CONFIG\": \"not json\"}'::jsonb WHERE user_id = :u AND item_id = :a"), {"u": me, "a": a5})
        command.downgrade(cfg, "0059")
        with engine.begin() as conn:
            assert conn.execute(text("SELECT data->>'CONFIG' FROM cloud_configs WHERE user_id = :u AND item_id = 'a5'"), {"u": me}).scalar_one() == "not json"
    finally:
        command.upgrade(cfg, "head")
        with engine.begin() as conn:
            for table in ("agent_skills", "user_skills", "user_tasks", "user_agents", "cloud_config_heads"):
                conn.execute(text(f"DELETE FROM {table} WHERE user_id IN (:a, :b)"), {"a": me, "b": other})
        engine.dispose()


def test_0061_moves_connections_links_and_mac_programs_to_tools_and_back(migrated_db_url):
    me, other = f"test-{uuid.uuid4().hex}", f"test-{uuid.uuid4().hex}"
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    osx = "6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c02"
    program = {"name": "wc", "description": "Count", "command": "wc", "args": [{"value": "-w"}]}
    site = {"address": "https://example.com/", "description": "Work"}

    def agent(user, item_id, name, config):
        return {"u": user, "i": item_id, "n": name, "d": json.dumps({"AGENT_NAME": name, "CONFIG": json.dumps(config) if isinstance(config, dict) else config})}

    try:
        command.downgrade(cfg, "0060")
        with engine.begin() as conn:
            for row in (
                agent(me, "a1", "sky", {"label": "Sky", "websites": [site, {"address": " "}, "odd"], "news_sites": [site], "local_programs": [program]}),
                agent(me, "a2", "studio-mac", {"label": "Mac", "mac_link": "m" * 32, "websites": [site, site], "local_programs": [program, program, {**program, "description": "Other"}, {"name": ""}, "odd"]}),
                agent(me, "a3", "typed-mac", {"label": "Typed", "agent_type_id": osx, "local_programs": [{**program, "args": "x", "command": 5}]}),
                agent(me, "a4", "odd", "not json"),
                agent(me, "a5", "plain", {"label": "Plain"}),
            ):
                conn.execute(text("INSERT INTO cloud_configs (user_id, kind, item_id, name, data, revision) VALUES (:u, 'agent', :i, :n, CAST(:d AS jsonb), 1)"), row)
            pg = "INSERT INTO cloud_postgres (user_id, agent, name, description, host, port, database, db_user, ssl, changes, ciphertext, nonce, wrapped_key, kek_id) VALUES (:u, :a, :n, 'Shop', 'db.example.com', 5432, 'shop', 'r', 'verify', false, :c, :c, :c, :k)"
            conn.execute(text(pg), {"u": me, "a": "sky", "n": "shop", "c": b"sealed", "k": "local:k"})
            conn.execute(text(pg), {"u": me, "a": "plain", "n": "shop", "c": None, "k": None})
            conn.execute(text(pg), {"u": me, "a": "gone", "n": "x" * 30, "c": None, "k": None})
            conn.execute(text(pg), {"u": me, "a": "plain", "n": "x" * 30, "c": None, "k": None})
            conn.execute(text("INSERT INTO cloud_snowflake (user_id, agent, name, account, database, schema_name, auth, ciphertext, nonce, wrapped_key, kek_id) VALUES (:u, 'sky', 'wh', 'org-acct', 'DB', 'PUBLIC', 'token', 'x', 'x', 'x', 'local:k')"), {"u": me})
        command.upgrade(cfg, "0061")
        with engine.begin() as conn:
            tools = {(r.kind, r.name): r for r in conn.execute(text("SELECT tool_id::text AS id, kind, name, description, config, secret_aad, ciphertext FROM user_tools WHERE user_id = :u"), {"u": me})}
            assert sorted(tools) == sorted([
                ("postgres", "shop"), ("postgres", "shop_2"), ("postgres", "x" * 30), ("postgres", "x" * 28 + "_2"), ("snowflake", "wh"),
                ("website", "https://example.com/"), ("news", "https://example.com/"), ("program", "wc"), ("program", "wc_2"), ("program", "wc_3"),
            ])
            # In order of agent: plain's "shop" first, sky's renamed.
            shop = tools[("postgres", "shop_2")]
            assert (shop.secret_aad, bytes(shop.ciphertext), shop.config) == ("postgres:sky:shop", b"sealed", {"host": "db.example.com", "port": 5432, "database": "shop", "user": "r", "ssl": "verify", "changes": False})
            assert (tools[("postgres", "shop")].secret_aad, tools[("postgres", "shop")].ciphertext) == (None, None)
            assert tools[("snowflake", "wh")].config == {"account": "org-acct", "database": "DB", "warehouse": "", "schema": "PUBLIC", "role": "", "user": "", "auth": "token", "changes": False}
            assert (tools[("program", "wc")].description, tools[("program", "wc")].config) == ("Count", {"command": "wc", "args": [{"value": "-w"}]})
            assert tools[("program", "wc_3")].config == {"command": "", "args": []}
            links = conn.execute(text("SELECT a.agent_id, t.kind, t.name, a.position FROM agent_tools a JOIN user_tools t ON t.tool_id = a.tool_id WHERE a.user_id = :u ORDER BY a.agent_id, a.position"), {"u": me}).all()
            assert [tuple(r) for r in links] == [
                ("a1", "postgres", "shop_2", 0), ("a1", "snowflake", "wh", 1), ("a1", "news", "https://example.com/", 2), ("a1", "website", "https://example.com/", 3),
                ("a2", "website", "https://example.com/", 0), ("a2", "program", "wc", 1), ("a2", "program", "wc_2", 2),
                ("a3", "program", "wc_3", 0),
                ("a5", "postgres", "shop", 0), ("a5", "postgres", "x" * 28 + "_2", 1),
            ]
            configs = dict(conn.execute(text("SELECT item_id, data->>'CONFIG' FROM cloud_configs WHERE user_id = :u"), {"u": me}).all())
            # A plain agent's programs are its desktop's: kept.
            assert json.loads(configs["a1"]) == {"label": "Sky", "local_programs": [program]}
            assert json.loads(configs["a2"]) == {"label": "Mac", "mac_link": "m" * 32}
            assert json.loads(configs["a3"]) == {"label": "Typed", "agent_type_id": osx}
            assert configs["a4"] == "not json" and json.loads(configs["a5"]) == {"label": "Plain"}
            # One sealed since under the tool's own binding cannot go back.
            conn.execute(text("UPDATE user_tools SET secret_aad = NULL WHERE user_id = :u AND kind = 'snowflake'"), {"u": me})
        command.downgrade(cfg, "0060")
        with engine.begin() as conn:
            back = {(r.agent, r.name): r for r in conn.execute(text("SELECT agent, name, host, ciphertext FROM cloud_postgres WHERE user_id = :u"), {"u": me})}
            # Back under its new name: a secret bound to the old one is left out.
            assert sorted(back) == sorted([("sky", "shop_2"), ("plain", "shop"), ("plain", "x" * 28 + "_2")])
            assert back[("sky", "shop_2")].ciphertext is None
            assert conn.execute(text("SELECT ciphertext FROM cloud_snowflake WHERE user_id = :u"), {"u": me}).scalar_one() is None
            configs = dict(conn.execute(text("SELECT item_id, data->>'CONFIG' FROM cloud_configs WHERE user_id = :u"), {"u": me}).all())
            assert json.loads(configs["a1"]) == {"label": "Sky", "local_programs": [program], "news_sites": [site], "websites": [site]}
            assert json.loads(configs["a2"])["local_programs"] == [program, {**program, "name": "wc_2", "description": "Other"}]
            # A link to an agent gone meanwhile, or whose settings cannot be read, is left out.
            conn.execute(text("UPDATE cloud_configs SET deleted_at = now() WHERE user_id = :u AND item_id = 'a5'"), {"u": me})
        command.upgrade(cfg, "0061")
        with engine.begin() as conn:
            conn.execute(text("UPDATE cloud_configs SET data = '{\"CONFIG\": \"not json\"}'::jsonb WHERE user_id = :u AND item_id = 'a2'"), {"u": me})
            conn.execute(text("INSERT INTO agent_tools (user_id, agent_id, tool_id, position) SELECT user_id, 'a5', tool_id, 9 FROM user_tools WHERE user_id = :u AND kind = 'website'"), {"u": me})
        command.downgrade(cfg, "0060")
        with engine.begin() as conn:
            assert conn.execute(text("SELECT data->>'CONFIG' FROM cloud_configs WHERE user_id = :u AND item_id = 'a2'"), {"u": me}).scalar_one() == "not json"
    finally:
        command.upgrade(cfg, "head")
        with engine.begin() as conn:
            for table in ("agent_tools", "user_tools", "user_tasks", "user_agents", "cloud_config_heads"):
                conn.execute(text(f"DELETE FROM {table} WHERE user_id IN (:a, :b)"), {"a": me, "b": other})
        engine.dispose()


def test_0062_drops_what_only_the_desktop_used_and_its_downgrade_makes_the_tables_again(migrated_db_url):
    me = f"test-{uuid.uuid4().hex}"
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    tables = ("usage", "backup_keys", "backups", "user_desktops", "user_credentials", "relay_desktops", "relay_calls", "remote_turns")

    def present() -> set[str]:
        with engine.connect() as conn:
            return {t for t in tables if conn.execute(text("SELECT to_regclass(:t) IS NOT NULL"), {"t": f"public.{t}"}).scalar_one()}

    def agent(item_id: str, data: dict) -> dict:
        return {"u": me, "i": item_id, "d": json.dumps(data)}

    try:
        assert present() == set()
        command.downgrade(cfg, "0061")
        assert present() == set(tables)
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO usage (insert_id, event, distinct_id, event_time) VALUES (:i, 'e', 'd', now())"), {"i": uuid.uuid4().hex})
            for item_id, data in (
                ("a1", {"CONFIG": json.dumps({"label": "A", "home": "pc", "home_name": "PC", "postgres_databases": [], "local_programs": [], "browser": "C"}), "DEVICES": {"pc": {}}}),
                ("a2", {"CONFIG": json.dumps({"label": "B"})}),
                ("a3", {"CONFIG": "not json", "DEVICES": {}}),
                ("a4", {"CONFIG": "not json"}),
            ):
                conn.execute(text("INSERT INTO cloud_configs (user_id, kind, item_id, name, data, revision) VALUES (:u, 'agent', :i, :i, CAST(:d AS jsonb), 1)"), agent(item_id, data))
            conn.execute(text("INSERT INTO cloud_configs (user_id, kind, item_id, name, data, revision) VALUES (:u, 'profile', 'wysebee', 'Wysebee', '{}'::jsonb, 1)"), {"u": me})
        command.upgrade(cfg, "0062")
        assert present() == set()
        with engine.connect() as conn:
            rows = {r.item_id: (r.kind, r.data) for r in conn.execute(text("SELECT kind, item_id, data FROM cloud_configs WHERE user_id = :u"), {"u": me})}
        assert sorted(rows) == ["a1", "a2", "a3", "a4"]
        assert rows["a1"][1] == {"CONFIG": json.dumps({"label": "A"}, separators=(",", ":"))}
        assert rows["a2"][1] == {"CONFIG": json.dumps({"label": "B"})}
        assert rows["a3"][1] == {"CONFIG": "not json"}
    finally:
        command.upgrade(cfg, "head")
        with engine.begin() as conn:
            for table in ("user_tasks", "user_agents"):
                conn.execute(text(f"DELETE FROM {table} WHERE user_id = :u"), {"u": me})
        engine.dispose()


def test_0063_moves_agents_to_their_table_and_every_reference_to_their_id_and_back(migrated_db_url):
    me, other = f"test-{uuid.uuid4().hex}", f"test-{uuid.uuid4().hex}"
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    hexed = "a" * 32
    alpha = str(uuid.UUID(hexed))
    skill, tool, link, lost_link = str(uuid.uuid4()), str(uuid.uuid4()), uuid.uuid4().hex, uuid.uuid4().hex
    steps = [{"agent": "alpha", "tool": "t", "arguments": {}}, {"agent": "@wysebee", "tool": "u"}, {"agent": "nobody", "tool": "v"}, "junk"]
    dropped = ("cloud_agent_keys", "user_chat_turns", "content_reports")

    def present() -> set[str]:
        with engine.connect() as conn:
            return {t for t in dropped if conn.execute(text("SELECT to_regclass(:t) IS NOT NULL"), {"t": f"public.{t}"}).scalar_one()}

    def item(kind, item_id, name, data, deleted=False):
        return {"u": me, "k": kind, "i": item_id, "n": name, "d": json.dumps(data), "del": deleted}

    try:
        command.downgrade(cfg, "0062")
        assert present() == set(dropped)
        with engine.begin() as conn:
            chrome = conn.execute(text("SELECT id FROM agent_types ORDER BY key LIMIT 1")).scalar_one()
            for row in (
                item("agent", hexed, "alpha", {"AGENT_NAME": "alpha", "CONFIG": json.dumps({"label": "Alpha"}), "DESCRIPTION": "Does A."}),
                item("agent", "wysebee", "wysebee", {"CONFIG": json.dumps({"label": "Wysebee", "instructions": "Hi."})}),
                item("agent", "odd-id", "odd", {"CONFIG": "not json", "DESCRIPTION": ""}),
                item("agent", "b" * 32, "gone", {}, deleted=True),
                item("task", "t1", "daily", {"CONFIG": json.dumps({"prompt": "Go.", "steps": steps})}),
                item("task", "t2", "plain", {"CONFIG": json.dumps({"prompt": "Remember."})}),
            ):
                conn.execute(text(
                    "INSERT INTO cloud_configs (user_id, kind, item_id, name, data, revision, deleted_at) "
                    "VALUES (:u, :k, :i, :n, CAST(:d AS jsonb), 1, CASE WHEN :del THEN now() END)"
                ), row)
            conn.execute(text("INSERT INTO user_skills (skill_id, user_id, name, description) VALUES (:s, :u, 'forecast', 'Weather.')"), {"s": skill, "u": me})
            for agent_id, n in ((hexed, 0), ("wysebee", 0), ("nope", 0)):
                conn.execute(text("INSERT INTO agent_skills (user_id, agent_id, skill_id, position) VALUES (:u, :a, :s, :n)"), {"u": me, "a": agent_id, "s": skill, "n": n})
            conn.execute(text("INSERT INTO user_tools (tool_id, user_id, kind, name, description) VALUES (:t, :u, 'website', 'https://x.test', '')"), {"t": tool, "u": me})
            conn.execute(text("INSERT INTO agent_tools (user_id, agent_id, tool_id, position) VALUES (:u, 'odd-id', :t, 0)"), {"u": me, "t": tool})
            for link_id, agent in ((link, "alpha"), (lost_link, "missing")):
                conn.execute(text(
                    "INSERT INTO browser_links (id, user_id, code_expires_at, secret_hash, name, agent, agent_type_id) "
                    "VALUES (:i, :u, now(), :h, 'L', :a, :t)"
                ), {"i": link_id, "u": me, "h": "0" * 64, "a": agent, "t": chrome})
            # Someone else's later agent with the same item id (ids were unique per person only).
            conn.execute(text(
                "INSERT INTO cloud_configs (user_id, kind, item_id, name, data, revision, created_at) VALUES (:u, 'agent', :i, 'beta', '{}'::jsonb, 1, now() + interval '1 day')"
            ), {"u": other, "i": hexed})
            for user, agent in ((me, "alpha"), (me, "wysebee"), (me, "missing"), (other, "wysebee")):
                conn.execute(text("INSERT INTO mcp_hidden_agents (user_id, agent) VALUES (:u, :a)"), {"u": user, "a": agent})
            for n, agent in enumerate(("alpha", "missing", None)):
                conn.execute(text("INSERT INTO user_notifications (id, user_id, title, body, agent) VALUES (:i, :u, 'T', '', :a)"), {"i": f"n{n}{me[-8:]}", "u": me, "a": agent})
            conn.execute(text("INSERT INTO user_task_runs (user_id, run_id, task_id, status, agent_name) VALUES (:u, 'r1', 't1', 'succeeded', 'odd')"), {"u": me})

        command.upgrade(cfg, "0063")
        assert present() == set()
        with engine.connect() as conn:
            rows = {r.name: r for r in conn.execute(text("SELECT * FROM user_agents WHERE user_id = :u"), {"u": me})}
            ids = {name: str(r.agent_id) for name, r in rows.items()}
            assert sorted(rows) == ["alpha", "odd", "wysebee"]
            assert (ids["alpha"], rows["alpha"].config, rows["alpha"].description) == (alpha, {"label": "Alpha"}, "Does A.")
            assert (rows["wysebee"].config, rows["odd"].config, rows["odd"].description) == ({"label": "Wysebee", "instructions": "Hi."}, {}, None)
            assert {str(r.agent_id) for r in conn.execute(text("SELECT agent_id FROM agent_skills WHERE user_id = :u"), {"u": me})} == {alpha, ids["wysebee"]}
            assert [str(r.agent_id) for r in conn.execute(text("SELECT agent_id FROM agent_tools WHERE user_id = :u"), {"u": me})] == [ids["odd"]]
            assert [(r.id, str(r.agent_id)) for r in conn.execute(text("SELECT id, agent_id FROM browser_links WHERE user_id = :u"), {"u": me})] == [(link, alpha)]
            assert {str(r.agent_id) for r in conn.execute(text("SELECT agent_id FROM mcp_hidden_agents WHERE user_id = :u"), {"u": me})} == {alpha, ids["wysebee"]}
            # Someone whose only mention of Wysebee's own agent was turning it off gets its row.
            theirs = conn.execute(text("SELECT a.name FROM mcp_hidden_agents h JOIN user_agents a USING (agent_id) WHERE h.user_id = :u"), {"u": other}).scalars().all()
            assert theirs == ["wysebee"]
            beta = conn.execute(text("SELECT agent_id FROM user_agents WHERE user_id = :u AND name = 'beta'"), {"u": other}).scalar_one()
            assert str(beta) != alpha
            notes = sorted((str(r.agent_id) if r.agent_id else None) or "" for r in conn.execute(text("SELECT agent_id FROM user_notifications WHERE user_id = :u"), {"u": me}))
            assert notes == ["", "", alpha]
            assert str(conn.execute(text("SELECT agent_id FROM user_task_runs WHERE user_id = :u"), {"u": me}).scalar_one()) == ids["odd"]
            tasks = {r.item_id: json.loads(r.data["CONFIG"]) for r in conn.execute(text("SELECT item_id, data FROM cloud_configs WHERE user_id = :u AND kind = 'task'"), {"u": me})}
            assert tasks["t1"]["steps"] == [
                {"agent_id": alpha, "tool": "t", "arguments": {}}, {"agent_id": ids["wysebee"], "tool": "u"}, {"agent_id": None, "tool": "v"}, "junk",
            ]
            assert tasks["t2"] == {"prompt": "Remember."}
            assert conn.execute(text("SELECT count(*) FROM cloud_configs WHERE user_id = :u AND kind = 'agent'"), {"u": me}).scalar_one() == 0

        command.downgrade(cfg, "0062")
        assert present() == set(dropped)
        with engine.connect() as conn:
            items = {r.name: (r.item_id, r.data) for r in conn.execute(text("SELECT item_id, name, data FROM cloud_configs WHERE user_id = :u AND kind = 'agent'"), {"u": me})}
            assert (items["alpha"][0], items["wysebee"][0], items["odd"][0]) == (hexed, "wysebee", uuid.UUID(ids["odd"]).hex)
            assert (json.loads(items["alpha"][1]["CONFIG"]), items["alpha"][1]["DESCRIPTION"], items["alpha"][1]["AGENT_NAME"]) == ({"label": "Alpha"}, "Does A.", "alpha")
            assert {r.agent_id for r in conn.execute(text("SELECT agent_id FROM agent_skills WHERE user_id = :u"), {"u": me})} == {hexed, "wysebee"}
            assert [r.agent_id for r in conn.execute(text("SELECT agent_id FROM agent_tools WHERE user_id = :u"), {"u": me})] == [uuid.UUID(ids["odd"]).hex]
            assert [r.agent for r in conn.execute(text("SELECT agent FROM browser_links WHERE user_id = :u"), {"u": me})] == ["alpha"]
            assert {r.agent for r in conn.execute(text("SELECT agent FROM mcp_hidden_agents WHERE user_id = :u"), {"u": me})} == {"alpha", "wysebee"}
            assert sorted(r.agent or "" for r in conn.execute(text("SELECT agent FROM user_notifications WHERE user_id = :u"), {"u": me})) == ["", "", "alpha"]
            assert conn.execute(text("SELECT agent_name FROM user_task_runs WHERE user_id = :u"), {"u": me}).scalar_one() == "odd"
            data = conn.execute(text("SELECT data FROM cloud_configs WHERE user_id = :u AND item_id = 't1'"), {"u": me}).scalar_one()
            assert json.loads(data["CONFIG"])["steps"] == [
                {"agent": "alpha", "tool": "t", "arguments": {}}, {"agent": "wysebee", "tool": "u"}, {"agent": None, "tool": "v"}, "junk",
            ]
    finally:
        command.upgrade(cfg, "head")
        with engine.begin() as conn:
            for table in ("agent_skills", "user_skills", "agent_tools", "user_tools", "browser_links", "mcp_hidden_agents", "user_notifications", "user_task_runs", "user_tasks", "user_agents"):
                conn.execute(text(f"DELETE FROM {table} WHERE user_id = ANY(:u)"), {"u": [me, other]})
        engine.dispose()


def test_0064_makes_project_ids_uuids_and_keeps_old_files_where_they_are(migrated_db_url):
    import pytest

    me = f"test-{uuid.uuid4().hex}"
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    hexed = uuid.uuid4().hex
    try:
        command.downgrade(cfg, "0063")
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO user_projects (project_id, user_id, name, resource_url) VALUES (:p, :u, 'My Docs', 'x')"), {"p": hexed, "u": me})
            conn.execute(text(
                "INSERT INTO project_assistants (user_id, project_id, path, content, revision, writer) VALUES (:u, :p, 'README.md', '', 1, 'person')"
            ), {"p": hexed, "u": me})
        command.upgrade(cfg, "0064")
        with engine.connect() as conn:
            row = conn.execute(text("SELECT project_id, folder FROM user_projects WHERE user_id = :u"), {"u": me}).one()
            assert (str(row.project_id), row.folder) == (str(uuid.UUID(hexed)), "My Docs")
            assert str(conn.execute(text("SELECT project_id FROM project_assistants WHERE user_id = :u"), {"u": me}).scalar_one()) == str(uuid.UUID(hexed))
        # Files still under the name: back to hex.
        command.downgrade(cfg, "0063")
        with engine.connect() as conn:
            assert conn.execute(text("SELECT project_id FROM project_assistants WHERE user_id = :u"), {"u": me}).scalar_one() == hexed
        command.upgrade(cfg, "0064")
        # Moved under its id: 0063 could not find them, so no downgrade.
        with engine.begin() as conn:
            conn.execute(text("UPDATE user_projects SET folder = NULL WHERE user_id = :u"), {"u": me})
        with pytest.raises(RuntimeError, match="keep their files under their id"):
            command.downgrade(cfg, "0063")
    finally:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM project_assistants WHERE user_id = :u"), {"u": me})
            conn.execute(text("DELETE FROM user_projects WHERE user_id = :u"), {"u": me})
        command.upgrade(cfg, "head")
        engine.dispose()


def test_0065_moves_tasks_to_their_table_drops_cloud_items_and_back(migrated_db_url):
    me = f"test-{uuid.uuid4().hex}"
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    hexed, gone = uuid.uuid4().hex, uuid.uuid4().hex
    config = {"prompt": "Go.", "trigger": {"type": "recurring", "repeat": "hours", "every": 1}, "steps": [{"agent_id": None, "tool": "x"}]}

    def present() -> bool:
        with engine.connect() as conn:
            return conn.execute(text("SELECT to_regclass('public.cloud_configs') IS NOT NULL")).scalar_one()

    try:
        command.downgrade(cfg, "0064")
        with engine.begin() as conn:
            for item_id, name, data, deleted in (
                (hexed, "Daily", {"ID": hexed, "CONFIG": json.dumps(config), "CREATOR": "me@example.com"}, False),
                ("odd", "Odd", {"CONFIG": "not json"}, False),
                (gone, "Gone", {}, True),
            ):
                conn.execute(text(
                    "INSERT INTO cloud_configs (user_id, kind, item_id, name, data, revision, deleted_at) "
                    "VALUES (:u, 'task', :i, :n, CAST(:d AS jsonb), 1, CASE WHEN :del THEN now() END)"
                ), {"u": me, "i": item_id, "n": name, "d": json.dumps(data), "del": deleted})
            for task_id in (hexed, gone):
                conn.execute(text("INSERT INTO task_schedules (user_id, task_id, next_run_at) VALUES (:u, :t, now())"), {"u": me, "t": task_id})
                conn.execute(text("INSERT INTO user_task_runs (user_id, run_id, task_id, status) VALUES (:u, :r, :t, 'succeeded')"), {"u": me, "r": f"r-{task_id}", "t": task_id})

        command.upgrade(cfg, "0065")
        assert not present()
        with engine.connect() as conn:
            rows = {r.name: r for r in conn.execute(text("SELECT * FROM user_tasks WHERE user_id = :u"), {"u": me})}
            assert sorted(rows) == ["Daily", "Odd"]
            assert (str(rows["Daily"].task_id), rows["Daily"].config, rows["Daily"].creator) == (str(uuid.UUID(hexed)), config, "me@example.com")
            assert (rows["Odd"].config, rows["Odd"].creator) == ({}, None)
            for table in ("task_schedules", "user_task_runs"):
                assert [str(r[0]) for r in conn.execute(text(f"SELECT task_id FROM {table} WHERE user_id = :u"), {"u": me})] == [str(uuid.UUID(hexed))]
            odd = uuid.UUID(str(rows["Odd"].task_id)).hex

        command.downgrade(cfg, "0064")
        assert present()
        with engine.connect() as conn:
            items = {r.name: (r.item_id, r.data) for r in conn.execute(text("SELECT item_id, name, data FROM cloud_configs WHERE user_id = :u"), {"u": me})}
            assert (items["Daily"][0], items["Odd"][0]) == (hexed, odd)
            assert (json.loads(items["Daily"][1]["CONFIG"]), items["Daily"][1]["CREATOR"], items["Daily"][1]["TASK_NAME"]) == (config, "me@example.com", "Daily")
            for table in ("task_schedules", "user_task_runs"):
                assert [r[0] for r in conn.execute(text(f"SELECT task_id FROM {table} WHERE user_id = :u"), {"u": me})] == [hexed]
    finally:
        command.upgrade(cfg, "head")
        with engine.begin() as conn:
            for table in ("user_task_runs", "task_schedules", "user_tasks", "cloud_config_heads"):
                conn.execute(text(f"DELETE FROM {table} WHERE user_id = :u"), {"u": me})
        engine.dispose()


def test_0066_records_the_owner_as_who_made_and_changed_each_and_back(migrated_db_url):
    me = f"test-{uuid.uuid4().hex}"
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    task = str(uuid.uuid4())
    try:
        command.downgrade(cfg, "0065")
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO users (user_id, email) VALUES (:u, 'me@example.com')"), {"u": me})
            conn.execute(text("INSERT INTO user_tasks (task_id, user_id, name, creator) VALUES (:t, :u, 'Daily', 'old@example.com')"), {"t": task, "u": me})
            conn.execute(text("INSERT INTO user_agents (agent_id, user_id, name) VALUES (:a, :u, 'helper')"), {"a": str(uuid.uuid4()), "u": me})
        command.upgrade(cfg, "0066")
        with engine.connect() as conn:
            for table in ("user_tasks", "user_agents"):
                row = conn.execute(text(f"SELECT created_by, updated_by FROM {table} WHERE user_id = :u"), {"u": me}).one()
                assert tuple(row) == (me, me)
        command.downgrade(cfg, "0065")
        with engine.connect() as conn:
            # The creator's email, as the cloud knows it now.
            assert conn.execute(text("SELECT creator FROM user_tasks WHERE task_id = :t"), {"t": task}).scalar_one() == "me@example.com"
    finally:
        command.upgrade(cfg, "head")
        with engine.begin() as conn:
            for table in ("user_tasks", "user_agents", "users"):
                conn.execute(text(f"DELETE FROM {table} WHERE user_id = :u"), {"u": me})
        engine.dispose()


def test_0067_keeps_empty_skill_folders_and_lets_a_skills_file_be_the_open_page_and_back(migrated_db_url):
    me = f"test-{uuid.uuid4().hex}"
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    skill, project = str(uuid.uuid4()), str(uuid.uuid4())
    try:
        command.downgrade(cfg, "0066")
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO user_skills (skill_id, user_id, name, description, created_by, updated_by) VALUES (:s, :u, 'forecast', 'W.', :u, :u)"
            ), {"s": skill, "u": me})
            conn.execute(text(
                "INSERT INTO user_projects (project_id, user_id, name, resource_url, created_by, updated_by) VALUES (:p, :u, 'Docs', 'x', :u, :u)"
            ), {"p": project, "u": me})
        command.upgrade(cfg, "0067")
        with engine.begin() as conn:
            assert conn.execute(text("SELECT folders FROM user_skills WHERE skill_id = :s"), {"s": skill}).scalar_one() == []
            conn.execute(text(
                "INSERT INTO project_assistants (user_id, skill_id, path, content, revision, writer, opened_by) VALUES (:u, :s, 'SKILL.md', '', 1, 'ai', 'ai')"
            ), {"u": me, "s": skill})
        # Exactly one of a project and a skill.
        with pytest.raises(Exception, match="ck_project_assistants_one_place"), engine.begin() as conn:
            conn.execute(text("UPDATE project_assistants SET project_id = :p WHERE user_id = :u"), {"p": project, "u": me})
        command.downgrade(cfg, "0066")
        with engine.connect() as conn:
            # A skill's open file cannot be kept without a project: it goes.
            assert conn.execute(text("SELECT count(*) FROM project_assistants WHERE user_id = :u"), {"u": me}).scalar_one() == 0
    finally:
        command.upgrade(cfg, "head")
        with engine.begin() as conn:
            # The project tables are gone at head (0073); their rows with them.
            for table in ("user_skills",):
                conn.execute(text(f"DELETE FROM {table} WHERE user_id = :u"), {"u": me})
        engine.dispose()


def test_0068_makes_usage_events_and_its_downgrade_drops_them(migrated_db_url):
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    try:
        command.downgrade(cfg, "0067")
        with engine.connect() as conn:
            assert conn.execute(text("SELECT to_regclass('usage_events')")).scalar_one() is None
        command.upgrade(cfg, "0068")
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO usage_events (occurred_at, event, anonymous_id, insert_id, surface, properties)"
                " VALUES (now(), 'Click', 'migration-test', 'i', 'web', '{\"label\": \"Save\"}')"
            ))
            # Searchable by what is in its properties.
            found = conn.execute(text("SELECT event FROM usage_events WHERE properties @> '{\"label\": \"Save\"}' AND anonymous_id = 'migration-test'")).scalar_one()
            assert found == "Click"
        command.downgrade(cfg, "0067")
        with engine.connect() as conn:
            assert conn.execute(text("SELECT to_regclass('usage_events')")).scalar_one() is None
    finally:
        command.upgrade(cfg, "head")
        engine.dispose()


def test_0069_lets_wysebee_windows_take_program_run_and_have_run_any_program(migrated_db_url):
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)

    def rows():
        with engine.begin() as conn:
            return {r.key: (r.ops, r.tool_kinds) for r in conn.execute(text("SELECT key, ops, tool_kinds FROM agent_types WHERE key IN ('wysebee-windows', 'wysebee-osx')"))}

    try:
        now = rows()
        assert now["wysebee-windows"][0][:5] == ["ping", "local_run", "skill_run", "folder_call", "program_run"] and now["wysebee-windows"][1][:5] == ["local", "folder", "sqlite", "skill_scripts", "any_program"]
        command.downgrade(cfg, "0068")
        assert rows()["wysebee-windows"] == (["ping", "local_run", "skill_run", "folder_call"], ["local", "folder", "sqlite", "skill_scripts"])
        # Upgraded twice: each added once.
        command.upgrade(cfg, "0069")
        command.downgrade(cfg, "0068")
        command.upgrade(cfg, "head")
        assert rows() == now
    finally:
        command.upgrade(cfg, "head")


def test_0070_lets_wysebee_windows_take_the_screen_ops_and_have_screen_control(migrated_db_url):
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)

    def rows():
        with engine.begin() as conn:
            return {r.key: (r.ops, r.tool_kinds) for r in conn.execute(text("SELECT key, ops, tool_kinds FROM agent_types WHERE key IN ('wysebee-windows', 'wysebee-osx')"))}

    try:
        now = rows()
        assert now["wysebee-windows"][0][5:7] == ["screen_screenshot", "screen_action"] and now["wysebee-windows"][1][5] == "screen"
        command.downgrade(cfg, "0069")
        assert "screen_action" not in rows()["wysebee-windows"][0] and "screen" not in rows()["wysebee-windows"][1]
        command.upgrade(cfg, "0070")
        command.downgrade(cfg, "0069")
        command.upgrade(cfg, "head")
        assert rows() == now
    finally:
        command.upgrade(cfg, "head")


def test_0071_lets_wysebee_windows_work_as_a_developer_and_use_android_phones(migrated_db_url):
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    added_ops, added_kinds = ["dev_shell", "dev_job", "dev_file", "android_dev"], ["developer", "android_toolkit"]

    def rows():
        with engine.begin() as conn:
            return {r.key: (r.ops, r.tool_kinds) for r in conn.execute(text("SELECT key, ops, tool_kinds FROM agent_types WHERE key IN ('wysebee-windows', 'wysebee-osx')"))}

    try:
        command.downgrade(cfg, "0071")
        now = rows()
        assert now["wysebee-windows"][0][-4:] == added_ops and now["wysebee-windows"][1][-2:] == added_kinds
        # The Mac's type gains none of them here (migration 0072 adds them).
        assert not set(added_ops) & set(now["wysebee-osx"][0]) and not set(added_kinds) & set(now["wysebee-osx"][1])
        command.downgrade(cfg, "0070")
        assert not set(added_ops) & set(rows()["wysebee-windows"][0])
        command.upgrade(cfg, "0071")
        command.downgrade(cfg, "0070")
        command.upgrade(cfg, "0071")
        assert rows() == now
    finally:
        command.upgrade(cfg, "head")


def test_0072_lets_wysebee_osx_do_what_wysebee_windows_does_and_use_iphones(migrated_db_url):
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    added_ops = ["program_run", "screen_screenshot", "screen_action", "dev_shell", "dev_job", "dev_file", "android_dev", "ios_dev"]
    added_kinds = ["any_program", "screen", "developer", "android_toolkit", "ios_toolkit"]

    def rows():
        with engine.begin() as conn:
            return {r.key: (r.ops, r.tool_kinds) for r in conn.execute(text("SELECT key, ops, tool_kinds FROM agent_types WHERE key IN ('wysebee-windows', 'wysebee-osx')"))}

    try:
        now = rows()
        assert now["wysebee-osx"] == (["ping", "local_run", "skill_run", "folder_call", *added_ops], ["local", "folder", "sqlite", "skill_scripts", *added_kinds])
        # The Windows type: the same four, never the iPhone's (no Xcode on Windows).
        assert "ios_dev" not in now["wysebee-windows"][0] and "ios_toolkit" not in now["wysebee-windows"][1]
        assert set(added_ops) - {"ios_dev"} <= set(now["wysebee-windows"][0]) and set(added_kinds) - {"ios_toolkit"} <= set(now["wysebee-windows"][1])
        command.downgrade(cfg, "0071")
        assert rows() == {"wysebee-osx": (["ping", "local_run", "skill_run", "folder_call"], ["local", "folder", "sqlite", "skill_scripts"]), "wysebee-windows": now["wysebee-windows"]}
        # One an admin added meanwhile is kept once, not twice.
        with engine.begin() as conn:
            conn.execute(text("UPDATE agent_types SET ops = ops || '[\"ios_dev\"]'::jsonb WHERE key = 'wysebee-osx'"))
        command.upgrade(cfg, "0072")
        assert rows()["wysebee-osx"][0].count("ios_dev") == 1
        command.downgrade(cfg, "0071")
        command.upgrade(cfg, "0072")
        assert rows() == now
    finally:
        command.upgrade(cfg, "head")
        engine.dispose()


def test_0073_drops_projects_for_empty_workspaces_and_back(migrated_db_url):
    me = f"test-{uuid.uuid4().hex}"
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    skill, project = str(uuid.uuid4()), str(uuid.uuid4())

    def exists(table: str) -> bool:
        with engine.connect() as conn:
            return conn.execute(text("SELECT to_regclass(:t)"), {"t": table}).scalar_one() is not None

    try:
        command.downgrade(cfg, "0072")
        assert exists("user_projects") and exists("project_assistants") and not exists("user_workspaces")
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO user_projects (project_id, user_id, name, resource_url, created_by, updated_by) VALUES (:p, :u, 'Docs', 'x', :u, :u)"
            ), {"p": project, "u": me})
        command.upgrade(cfg, "0073")
        # Projects are not kept: the workspace tables start empty.
        assert not exists("user_projects") and not exists("project_assistants")
        with engine.begin() as conn:
            assert conn.execute(text("SELECT count(*) FROM user_workspaces WHERE user_id = :u"), {"u": me}).scalar_one() == 0
            conn.execute(text(
                "INSERT INTO user_skills (skill_id, user_id, name, description, created_by, updated_by) VALUES (:s, :u, 'forecast', 'W.', :u, :u)"
            ), {"s": skill, "u": me})
            conn.execute(text(
                "INSERT INTO user_workspaces (workspace_id, user_id, name, resource_url, created_by, updated_by) VALUES (:w, :u, 'Docs', 'x', :u, :u)"
            ), {"w": project, "u": me})
            conn.execute(text(
                "INSERT INTO workspace_assistants (user_id, workspace_id, path, content, revision, writer) VALUES (:u, :w, 'README.md', '', 1, 'person')"
            ), {"u": me, "w": project})
        # A name taken in another case, and an open page in both a workspace and a skill, are refused.
        with pytest.raises(Exception, match="ix_user_workspaces_user_name"), engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO user_workspaces (workspace_id, user_id, name, resource_url, created_by, updated_by) VALUES (:w, :u, 'DOCS', 'x', :u, :u)"
            ), {"w": str(uuid.uuid4()), "u": me})
        with pytest.raises(Exception, match="ck_workspace_assistants_one_place"), engine.begin() as conn:
            conn.execute(text("UPDATE workspace_assistants SET skill_id = :s WHERE user_id = :u"), {"s": skill, "u": me})
        # Deleting a workspace closes its open page.
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM user_workspaces WHERE user_id = :u"), {"u": me})
            assert conn.execute(text("SELECT count(*) FROM workspace_assistants WHERE user_id = :u"), {"u": me}).scalar_one() == 0
        # Down past 0064 and back: the old tables are made again as 0064-0067 left them, so their downgrades run.
        command.downgrade(cfg, "0063")
        assert not exists("user_workspaces")
        command.upgrade(cfg, "head")
        assert exists("user_workspaces") and exists("workspace_assistants")
    finally:
        command.upgrade(cfg, "head")
        with engine.begin() as conn:
            for table in ("workspace_assistants", "user_workspaces", "user_skills"):
                conn.execute(text(f"DELETE FROM {table} WHERE user_id = :u"), {"u": me})
        engine.dispose()


def test_0074_deletes_saved_skills_and_their_files_rows(migrated_db_url):
    me = f"test-{uuid.uuid4().hex}"
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    skill = str(uuid.uuid4())

    def count(table: str) -> int:
        with engine.connect() as conn:
            return conn.execute(text(f"SELECT count(*) FROM {table} WHERE user_id = :u"), {"u": me}).scalar_one()

    try:
        command.downgrade(cfg, "0073")
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO user_skills (skill_id, user_id, name, description, created_by, updated_by) VALUES (:s, :u, 'forecast', 'W.', :u, :u)"
            ), {"s": skill, "u": me})
            conn.execute(text("INSERT INTO cloud_skill_files (user_id, file_id, size) VALUES (:u, :f, 3)"), {"u": me, "f": "a" * 64})
            conn.execute(text(
                "INSERT INTO workspace_assistants (user_id, skill_id, path, content, revision, writer, opened_by) VALUES (:u, :s, 'SKILL.md', '', 1, 'ai', 'ai')"
            ), {"u": me, "s": skill})
        command.upgrade(cfg, "0074")
        # Their files are not in user-skills: the skills, their file rows and an open skill page go.
        assert (count("user_skills"), count("cloud_skill_files"), count("workspace_assistants")) == (0, 0, 0)
        # Its downgrade changes nothing.
        command.downgrade(cfg, "0073")
        assert count("user_skills") == 0
    finally:
        command.upgrade(cfg, "head")
        engine.dispose()


def test_0078_makes_the_offers_table_and_takes_it_away(migrated_db_url):
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)

    def exists():
        with engine.begin() as conn:
            return conn.execute(text("SELECT to_regclass('public.agent_link_offers')")).scalar_one() is not None

    try:
        assert exists()
        command.downgrade(cfg, "0077")
        assert not exists()
    finally:
        command.upgrade(cfg, "head")
        assert exists()
        engine.dispose()


def test_0079_registers_wysebee_linux_and_keeps_one_registered_by_hand(migrated_db_url):
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)
    linux = "6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c06"
    ops = ["ping", "local_run", "skill_run", "folder_call", "program_run", "dev_shell", "dev_job", "dev_file", "android_dev"]
    kinds = ["local", "folder", "sqlite", "skill_scripts", "any_program", "developer", "android_toolkit"]

    def row():
        with engine.begin() as conn:
            r = conn.execute(text("SELECT id::text, name, link_field, ops, tool_kinds, enabled FROM agent_types WHERE key = 'wysebee-linux'")).first()
        return tuple(r) if r is not None else None

    try:
        # The Windows type's row without the screen's; held where a Mac's link is.
        assert row() == (linux, "Wysebee Linux Agent", "mac_link", ops, kinds, True)
        # Not the Android type's id (the protocol's proposal was).
        with engine.begin() as conn:
            assert conn.execute(text("SELECT key FROM agent_types WHERE id = '6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c05'")).scalar_one() == "wysebee-android"
            # Links of it that other tests left here: gone first, as a real downgrade needs.
            conn.execute(text("DELETE FROM browser_links WHERE agent_type_id = CAST(:i AS uuid)"), {"i": linux})
        command.downgrade(cfg, "0078")
        assert row() is None
        # Registered by hand meanwhile (Admin): kept as it is, not a second one.
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO agent_types (id, key, name, link_field, ops, tool_kinds) VALUES (gen_random_uuid(), 'wysebee-linux', 'By hand', 'mac_link', '[\"ping\"]', '[]')"))
        command.upgrade(cfg, "0079")
        assert row()[1:4] == ("By hand", "mac_link", ["ping"])
    finally:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM agent_types WHERE key = 'wysebee-linux'"))
        command.downgrade(cfg, "0078")
        command.upgrade(cfg, "head")
        assert row() == (linux, "Wysebee Linux Agent", "mac_link", ops, kinds, True)
        engine.dispose()


def test_0080_adds_the_start_address_and_takes_it_away(migrated_db_url):
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)

    def has() -> bool:
        with engine.connect() as conn:
            return conn.execute(text("SELECT count(*) FROM information_schema.columns WHERE table_name = 'browser_links' AND column_name = 'start_address'")).scalar_one() == 1

    try:
        assert has()
        command.downgrade(cfg, "0079")
        assert not has()
    finally:
        command.upgrade(cfg, "head")
        assert has()
        engine.dispose()


def test_0081_lets_wysebee_browser_chrome_take_browser_mock(migrated_db_url):
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)

    def ops() -> dict:
        with engine.begin() as conn:
            return {r.key: r.ops for r in conn.execute(text("SELECT key, ops FROM agent_types"))}

    try:
        now = ops()
        assert now["wysebee-browser-chrome"].count("browser_mock") == 1
        assert not any("browser_mock" in v for k, v in now.items() if k != "wysebee-browser-chrome")
        command.downgrade(cfg, "0080")
        assert "browser_mock" not in ops()["wysebee-browser-chrome"]
        # Upgraded twice: added once.
        command.upgrade(cfg, "0081")
        command.downgrade(cfg, "0080")
        command.upgrade(cfg, "head")
        assert ops() == now
    finally:
        command.upgrade(cfg, "head")
        engine.dispose()


def test_0082_lets_wysebee_browser_chrome_take_browser_record_and_keeps_its_recordings(migrated_db_url):
    cfg = _alembic(migrated_db_url)
    engine = create_engine(migrated_db_url)

    def ops() -> dict:
        with engine.begin() as conn:
            return {r.key: r.ops for r in conn.execute(text("SELECT key, ops FROM agent_types"))}

    def table() -> bool:
        with engine.begin() as conn:
            return conn.execute(text("SELECT to_regclass('public.browser_recordings')")).scalar_one() is not None

    try:
        now = ops()
        assert now["wysebee-browser-chrome"].count("browser_record") == 1 and table()
        assert not any("browser_record" in v for k, v in now.items() if k != "wysebee-browser-chrome")
        command.downgrade(cfg, "0081")
        assert "browser_record" not in ops()["wysebee-browser-chrome"] and not table()
        # Upgraded twice: added once.
        command.upgrade(cfg, "0082")
        command.downgrade(cfg, "0081")
        command.upgrade(cfg, "head")
        assert ops() == now and table()
    finally:
        command.upgrade(cfg, "head")
        engine.dispose()
