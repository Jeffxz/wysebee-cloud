import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from apps.cloud.config import Settings
from apps.cloud.main import create_app

# Point at a database of the tests' own to run the database tests, e.g. on the compose db:
#   WYSEBEE_TEST_DATABASE_URL=postgresql://wysebee:wysebee@localhost:5432/wysebee_test
# Its name must end in "_test": the migration tests downgrade it to 0005 and back, which drops
# everything newer (pairings, skills, workspaces, tasks…), so it is never the app's own. It is
# made when it is not there yet.
TEST_DB_URL = os.environ.get("WYSEBEE_TEST_DATABASE_URL")
UNREACHABLE_DB_URL = "postgresql+psycopg://x:x@127.0.0.1:1/x"

needs_db = pytest.mark.skipif(not TEST_DB_URL, reason="WYSEBEE_TEST_DATABASE_URL not set")


@pytest.fixture(autouse=True)
def _no_local_settings(monkeypatch):
    """Tests see only the settings they pass: not the developer's .env (Auth0 tenant,
    audience, Mixpanel token, …) nor WYSEBEE_* app settings exported in the shell.
    WYSEBEE_TEST_* are the tests' own switches and stay."""
    monkeypatch.setitem(Settings.model_config, "env_file", None)
    for name in list(os.environ):
        if name.startswith("WYSEBEE_") and not name.startswith("WYSEBEE_TEST_"):
            monkeypatch.delenv(name)


@pytest.fixture(autouse=True)
def _fresh_agent_types():
    """Each test reads the agent types' table afresh (apps/cloud/agent_types.py caches it a
    minute), so one that changes a row does not leak into the next."""
    from apps.cloud import agent_types

    agent_types.forget()
    yield
    agent_types.forget()


@pytest.fixture
def ui_dist(tmp_path: Path) -> Path:
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log(1)")
    (tmp_path / "index.html").write_text("<div id=root></div>")
    return tmp_path


def make_client(ui_dist: Path, loaded=None, **settings) -> TestClient:
    settings.setdefault("database_url", UNREACHABLE_DB_URL)
    # Every test client is one address: the cap on the codes one address may hold is the
    # test's own to set (test_browser_links.py).
    settings.setdefault("browser_link_pending_per_address", 10_000)
    return TestClient(create_app(ui_dist=ui_dist, settings=Settings(**settings), loaded=loaded))


@pytest.fixture(scope="session")
def migrated_db_url() -> str:
    """The test database URL, with migrations applied."""
    from alembic import command
    from alembic.config import Config

    url = Settings(database_url=TEST_DB_URL).database_url
    _own_database(url)
    cfg = Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))
    cfg.attributes["url"] = url
    command.upgrade(cfg, "head")
    return url


def _own_database(url: str) -> None:
    """Refuse a database that is not the tests' own (its name not ending in ``_test``), and make
    it when it is not there yet."""
    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import make_url

    target = make_url(url)
    name = target.database or ""
    if not name.endswith("_test"):
        pytest.exit(
            f"WYSEBEE_TEST_DATABASE_URL names the database {name!r}: the tests' must end in '_test' "
            "(e.g. .../wysebee_test). They downgrade it and drop what is in it, so it is never the app's own.",
            returncode=2,
        )
    admin = create_engine(target.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as conn:
            if conn.execute(text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": name}).first() is None:
                conn.execute(text(f'CREATE DATABASE "{name}"'))
    finally:
        admin.dispose()


@pytest.fixture
def db_client(ui_dist: Path, migrated_db_url: str) -> Iterator[TestClient]:
    with make_client(ui_dist, database_url=migrated_db_url) as client:
        yield client
