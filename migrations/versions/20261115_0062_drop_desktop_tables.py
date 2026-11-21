"""drop what only Wysebee Desktop used

Wysebee Desktop, and the Wysebee apps for iOS and Android, are no longer served (2026-11-15,
the person's call): Wysebee Cloud is the website and the Wysebee Agent apps (browser, Mac,
Windows, Android). This drops what only they wrote or read:

- ``usage`` — the desktop's usage analytics (``POST /usage``);
- ``backup_keys`` and ``backups`` — its encrypted cloud backup (``/backup*``). The backups'
  files in the ``backups`` blob container are not deleted here;
- ``user_desktops`` — the desktops that reported themselves (``/desktops``);
- ``user_credentials`` — the passwords of its database connections (``/credentials``);
- ``relay_desktops``, ``relay_calls`` and ``remote_turns`` — the relay and remote turns, unwritten
  since 2026-11-13;

and from the cloud items: ``profile`` items (its "Sync to cloud" copy of Wysebee's settings),
each agent's ``DEVICES`` (what it had on each computer) and, from its settings, where it
lived (``home``, ``home_name``), its connections, local database and programs on a computer
(``postgres_databases``, ``snowflake_databases``, ``sqlite_database``, ``local_programs`` — a
Mac agent's are ``program`` tools since 0061), ``browser`` and the retired ``folders``.

``server_metadata`` stays: Wysebee Admin writes it.

The downgrade makes the tables again, empty; what was taken out of the cloud items is not put
back.

Revision ID: 0062
Revises: 0061
Create Date: 2026-11-15 23:00:00.000000
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0062'
down_revision: str | None = '0061'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("usage", "backup_keys", "backups", "user_desktops", "user_credentials", "relay_desktops", "relay_calls", "remote_turns")
GONE = ("home", "home_name", "postgres_databases", "snowflake_databases", "sqlite_database", "local_programs", "browser", "folders")

# As they were at 0061 (pg_dump --schema-only).
DDL = """
CREATE TABLE backup_keys (
    user_id character varying(255) NOT NULL,
    key_id character varying(32) NOT NULL,
    envelope jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE backups (
    id character varying(32) NOT NULL,
    user_id character varying(255) NOT NULL,
    key_id character varying(32) NOT NULL,
    app_version character varying(64) NOT NULL,
    meta jsonb,
    objects jsonb NOT NULL,
    size_bytes bigint NOT NULL,
    status character varying(16) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);
CREATE TABLE relay_calls (
    id character varying(32) NOT NULL,
    user_id character varying(255) NOT NULL,
    status character varying(16) NOT NULL,
    message text NOT NULL,
    result text,
    is_error boolean DEFAULT false NOT NULL,
    claimed_by character varying(64),
    client_id character varying(128),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE relay_desktops (
    user_id character varying(255) NOT NULL,
    instance_id character varying(64) NOT NULL,
    app_version character varying(32),
    last_seen timestamp with time zone DEFAULT now() NOT NULL,
    catalog jsonb
);
CREATE TABLE remote_turns (
    user_id character varying(255) NOT NULL,
    id character varying(32) NOT NULL,
    agent character varying(64) NOT NULL,
    home character varying(64) NOT NULL,
    request jsonb NOT NULL,
    status character varying(16) NOT NULL,
    result jsonb,
    error text,
    error_status integer,
    cancel_seen boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    kind character varying(16) DEFAULT 'turn'::character varying NOT NULL,
    error_code character varying(32),
    chat_turn character varying(64)
);
CREATE TABLE usage (
    id bigint NOT NULL,
    insert_id character varying(64) NOT NULL,
    event character varying(100) NOT NULL,
    distinct_id character varying(255) NOT NULL,
    session_id character varying(64),
    app_version character varying(32),
    os character varying(32),
    lib character varying(64),
    event_time timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    properties jsonb DEFAULT '{}'::jsonb NOT NULL,
    user_id character varying(64)
);
CREATE SEQUENCE usage_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE usage_id_seq OWNED BY usage.id;
CREATE TABLE user_credentials (
    user_id character varying(255) NOT NULL,
    credential_id character varying(64) NOT NULL,
    vendor character varying(64) NOT NULL,
    name character varying(255) DEFAULT ''::character varying NOT NULL,
    ciphertext bytea NOT NULL,
    nonce bytea NOT NULL,
    wrapped_key bytea NOT NULL,
    kek_id character varying(512) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE user_desktops (
    user_id character varying(255) NOT NULL,
    install_id character varying(64) NOT NULL,
    name character varying(255) NOT NULL,
    os character varying(64) NOT NULL,
    app_version character varying(32) NOT NULL,
    first_seen timestamp with time zone DEFAULT now() NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    disconnected_at timestamp with time zone,
    ai jsonb DEFAULT '[]'::jsonb NOT NULL,
    camera boolean DEFAULT false NOT NULL
);
ALTER TABLE ONLY usage ALTER COLUMN id SET DEFAULT nextval('usage_id_seq'::regclass);
ALTER TABLE ONLY backup_keys
    ADD CONSTRAINT backup_keys_pkey PRIMARY KEY (user_id);
ALTER TABLE ONLY backups
    ADD CONSTRAINT backups_pkey PRIMARY KEY (id);
ALTER TABLE ONLY relay_calls
    ADD CONSTRAINT relay_calls_pkey PRIMARY KEY (id);
ALTER TABLE ONLY relay_desktops
    ADD CONSTRAINT relay_desktops_pkey PRIMARY KEY (user_id, instance_id);
ALTER TABLE ONLY remote_turns
    ADD CONSTRAINT remote_turns_pkey PRIMARY KEY (user_id, id);
ALTER TABLE ONLY usage
    ADD CONSTRAINT usage_insert_id_key UNIQUE (insert_id);
ALTER TABLE ONLY usage
    ADD CONSTRAINT usage_pkey PRIMARY KEY (id);
ALTER TABLE ONLY user_credentials
    ADD CONSTRAINT user_credentials_pkey PRIMARY KEY (user_id, credential_id);
ALTER TABLE ONLY user_desktops
    ADD CONSTRAINT user_desktops_pkey PRIMARY KEY (user_id, install_id);
CREATE INDEX ix_backups_user_id ON backups USING btree (user_id);
CREATE INDEX ix_relay_calls_user_status ON relay_calls USING btree (user_id, status, created_at);
CREATE INDEX ix_remote_turns_home ON remote_turns USING btree (user_id, home, status);
CREATE INDEX ix_usage_distinct_id_event_time ON usage USING btree (distinct_id, event_time);
CREATE INDEX ix_usage_event_event_time ON usage USING btree (event, event_time);
CREATE INDEX ix_usage_event_time ON usage USING btree (event_time);
CREATE INDEX ix_usage_properties ON usage USING gin (properties jsonb_path_ops);
CREATE INDEX ix_usage_user_id_event_time ON usage USING btree (user_id, event_time) WHERE (user_id IS NOT NULL);
"""


def upgrade() -> None:
    for table in TABLES:
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
    bind = op.get_bind()
    bind.execute(sa.text("DELETE FROM cloud_configs WHERE kind = 'profile'"))
    for row in bind.execute(sa.text("SELECT user_id, item_id, data FROM cloud_configs WHERE kind = 'agent' AND deleted_at IS NULL")).mappings():
        data = dict(row["data"] or {})
        try:
            config = json.loads(data.get("CONFIG") or "{}")
        except (TypeError, ValueError):
            config = None
        changed = data.pop("DEVICES", None) is not None
        if isinstance(config, dict) and any(f in config for f in GONE):
            data["CONFIG"] = json.dumps({k: v for k, v in config.items() if k not in GONE}, separators=(",", ":"), ensure_ascii=False)
            changed = True
        if changed:
            bind.execute(
                sa.text("UPDATE cloud_configs SET data = CAST(:d AS jsonb) WHERE user_id = :u AND kind = 'agent' AND item_id = :a"),
                {"d": json.dumps(data), "u": row["user_id"], "a": row["item_id"]},
            )


def downgrade() -> None:
    for statement in DDL.split(";"):
        if statement.strip():
            op.execute(statement)
