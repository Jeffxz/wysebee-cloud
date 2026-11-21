"""A self-hosted server (``WYSEBEE_EDITION=selfhost``): one owner and no sign-in provider —
optionally a shared token — and no extensions or account deletion (apps/cloud/auth.py,
apps/cloud/main.py, apps/cloud/web.py)."""

import logging
import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, text

from apps.cloud.auth import local_owner
from apps.cloud.config import Settings
from tests.conftest import make_client, needs_db

TOKEN = "s3cret-token"
INIT = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}}


# --- settings ----------------------------------------------------------------------------


def test_the_hosted_edition_is_the_default():
    s = Settings()
    assert s.edition == "cloud" and not s.selfhost
    assert s.events_enabled is True and s.storage_quota_bytes == 1024**3


def test_self_hosting_sends_no_events_and_keeps_a_larger_quota_unless_told_otherwise():
    s = Settings(edition="selfhost")
    assert s.selfhost and s.events_enabled is False and s.storage_quota_bytes == 100 * 1024**3
    s = Settings(edition="selfhost", events_enabled=True, storage_quota_bytes=5)
    assert s.events_enabled is True and s.storage_quota_bytes == 5


def test_self_hosting_has_no_mock_sign_in():
    with pytest.raises(ValidationError, match="not WYSEBEE_EDITION=selfhost"):
        Settings(edition="selfhost", auth_mock=True)


def test_the_token_comes_from_the_environment_and_blank_is_none(monkeypatch):
    monkeypatch.setenv("WYSEBEE_EDITION", "selfhost")
    monkeypatch.setenv("WYSEBEE_SELFHOST_TOKEN", " ")
    assert Settings().selfhost_token is None
    monkeypatch.setenv("WYSEBEE_SELFHOST_TOKEN", TOKEN)
    s = Settings()
    assert s.selfhost_token == TOKEN and TOKEN not in repr(s)


def test_the_owner_is_whoever_the_settings_name():
    s = Settings(edition="selfhost", selfhost_user_id="me|1", selfhost_user_name="Ada", selfhost_user_email="ada@example.com")
    owner = local_owner(s, None)
    assert owner is not None and (owner.sub, owner.name, owner.email) == ("me|1", "Ada", "ada@example.com")
    guarded = Settings(edition="selfhost", selfhost_token=TOKEN)
    assert local_owner(guarded, TOKEN) is not None
    assert local_owner(guarded, None) is None and local_owner(guarded, "wrong") is None


# --- the app -----------------------------------------------------------------------------


def test_without_a_token_every_request_is_the_owner(ui_dist, caplog):
    with caplog.at_level(logging.WARNING, logger="wysebee.cloud"):
        client = make_client(ui_dist, edition="selfhost")
    assert "SELF-HOSTED WITHOUT A TOKEN" in caplog.text
    with client:
        me = client.get("/api/v1/me")
        assert me.status_code == 200
        assert me.json() == {"sub": "local|owner", "username": "", "email": "", "name": "Owner"}
        # Any bearer token is ignored rather than verified.
        assert client.get("/api/v1/me", headers={"Authorization": "Bearer whatever"}).status_code == 200


def test_with_a_token_only_that_token_is_the_owner(ui_dist, caplog):
    with caplog.at_level(logging.WARNING, logger="wysebee.cloud"):
        client = make_client(ui_dist, edition="selfhost", selfhost_token=TOKEN)
    assert "SELF-HOSTED WITHOUT A TOKEN" not in caplog.text
    with client:
        refused = client.get("/api/v1/me")
        assert refused.status_code == 401 and refused.headers["www-authenticate"] == "Bearer"
        assert client.get("/api/v1/me", headers={"Authorization": "Bearer nope"}).status_code == 401
        assert client.get("/api/v1/me", headers={"Authorization": f"Bearer {TOKEN}"}).json()["sub"] == "local|owner"


def test_the_pages_are_told_how_to_sign_in(ui_dist):
    with make_client(ui_dist, edition="selfhost") as client:
        body = client.get("/api/v1/web/config").json()
    assert body["edition"] == "selfhost"
    assert body["auth"] == {"mode": "none", "issuer": None, "client_id": None, "audience": None, "connection": None}
    assert body["analytics"] == {"enabled": False}
    # The hosted edition's Auth0 settings are never announced by a self-hosted server.
    with make_client(ui_dist, edition="selfhost", selfhost_token=TOKEN, auth_issuer="https://t.auth0.com/", auth_web_client_id="web") as client:
        assert client.get("/api/v1/web/config").json()["auth"]["mode"] == "token"
        assert client.get("/api/v1/web/config").json()["auth"]["issuer"] is None


def test_account_deletion_is_not_served(ui_dist):
    with make_client(ui_dist, edition="selfhost") as client:
        # No route takes it: only the SPA's GET catch-all matches the path.
        assert client.delete("/api/v1/account").status_code in (404, 405)
        assert client.get("/api/v1/plan").status_code == 404


def test_the_site_is_the_web_app(ui_dist):
    with make_client(ui_dist, edition="selfhost") as client:
        r = client.get("/", follow_redirects=False)
        assert r.status_code == 307 and r.headers["location"] == "/app/"
    with make_client(ui_dist) as client:
        assert client.get("/", follow_redirects=False).status_code == 200


def test_no_oauth_is_announced_for_wysebee_assistant(ui_dist):
    meta = "/.well-known/oauth-protected-resource/assistant/mcp"
    # Not even with an Auth0 issuer left in the settings (a reused .env): an AI app that looked
    # would be sent to a tenant that cannot sign it in.
    with make_client(ui_dist, edition="selfhost", selfhost_token=TOKEN, auth_issuer="https://t.us.auth0.com/") as client:
        assert client.get(meta).status_code == 404
    with make_client(ui_dist, auth_issuer="https://t.us.auth0.com/") as client:
        assert client.get(meta).json()["authorization_servers"] == ["https://t.us.auth0.com/"]


def test_wysebee_assistant_wants_the_token_without_oauth(ui_dist):
    with make_client(ui_dist, edition="selfhost", selfhost_token=TOKEN) as client:
        r = client.post("/assistant/mcp", json=INIT)
        assert r.status_code == 401 and r.headers["www-authenticate"] == "Bearer"
        assert client.post("/assistant/mcp", json=INIT, headers={"Authorization": "Basic x"}).status_code == 401


# --- against a database ------------------------------------------------------------------


@pytest.fixture
def owner(migrated_db_url: str) -> Iterator[str]:
    sub = f"test-{uuid.uuid4().hex}"
    yield sub
    with create_engine(migrated_db_url).begin() as conn:
        for table in ("ai_turn_counts", "users", "workspace_assistants"):
            conn.execute(text(f"DELETE FROM {table} WHERE user_id = :u"), {"u": sub})


@needs_db
def test_the_owners_data_needs_no_billing(ui_dist, migrated_db_url: str, owner: str):
    with make_client(ui_dist, database_url=migrated_db_url, edition="selfhost", selfhost_user_id=owner) as client:
        assert client.get("/api/v1/tool-calls").json()["billing_url"] is None
        assert client.get("/api/v1/agents").status_code == 200
        assert client.get("/api/v1/storage").json()["limit"] == 100 * 1024**3


@needs_db
def test_wysebee_assistant_answers_the_owner_with_the_token(ui_dist, migrated_db_url: str, owner: str):
    with make_client(ui_dist, database_url=migrated_db_url, edition="selfhost", selfhost_token=TOKEN, selfhost_user_id=owner) as client:
        r = client.post("/assistant/mcp", json=INIT, headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/json, text/event-stream"})
        assert r.status_code == 200, r.text
        assert "wysebee-assistant" in r.text
