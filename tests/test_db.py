"""The database handle (apps/cloud/db.py) against a real database, skipped without
WYSEBEE_TEST_DATABASE_URL."""

import asyncio

from sqlalchemy.engine import make_url

from apps.cloud.config import Settings
from apps.cloud.db import Database
from apps.cloud.main import migration_head
from tests.conftest import needs_db


@needs_db
def test_the_revision_is_the_migrations_and_none_before_the_first(migrated_db_url: str) -> None:
    # A search path naming no schema sees no tables: a database before its first migration.
    empty_url = make_url(migrated_db_url).update_query_dict({"options": "-csearch_path=wysebee_test_no_such_schema"})

    async def revisions() -> tuple[str | None, str | None]:
        migrated = Database(Settings(database_url=migrated_db_url))
        empty = Database(Settings(database_url=empty_url.render_as_string(hide_password=False)))
        try:
            return await migrated.migration_revision(), await empty.migration_revision()
        finally:
            await migrated.dispose()
            await empty.dispose()

    assert asyncio.run(revisions()) == (migration_head(), None)
