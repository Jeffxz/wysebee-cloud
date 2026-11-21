"""The test extension's migrations: its own version table, beside the server's."""

from alembic import context
from sqlalchemy import create_engine

engine = create_engine(context.config.attributes["url"])
with engine.connect() as connection:
    context.configure(connection=connection, version_table="alembic_version_fake_extension")
    with context.begin_transaction():
        context.run_migrations()
engine.dispose()
