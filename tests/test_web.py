from tests.conftest import make_client

ISSUER = "https://wysebee-test.us.auth0.com/"


def test_web_config_without_anything_set(ui_dist):
    with make_client(ui_dist) as client:
        r = client.get("/api/v1/web/config")
    assert r.status_code == 200
    assert r.json() == {
        "edition": "cloud",
        "auth": {"mode": "oidc", "issuer": None, "client_id": None, "audience": None, "connection": None},
        "analytics": {"enabled": True},
        # Internal feature flags: none now.
        "features": {"billing": False},
    }
    assert r.headers["cache-control"] == "public, max-age=60"


def test_web_config_announces_sign_in_and_never_the_mixpanel_project(ui_dist):
    with make_client(
        ui_dist, auth_issuer=ISSUER, auth_web_client_id="webApp", mixpanel_token="abc123", mixpanel_api_host="https://api-eu.mixpanel.com"
    ) as client:
        body = client.get("/api/v1/web/config").json()
    # The site's own client, not the desktop's.
    assert body["auth"] == {"mode": "oidc", "issuer": ISSUER, "client_id": "webApp", "audience": "https://wysebee.ai/api", "connection": None}
    # The server forwards events to Mixpanel; the page only needs to know whether to send them.
    assert body["analytics"] == {"enabled": True}


def test_web_config_says_when_usage_events_are_off(ui_dist):
    with make_client(ui_dist, events_enabled=False) as client:
        assert client.get("/api/v1/web/config").json()["analytics"] == {"enabled": False}


def test_mixpanel_token_comes_from_the_environment(monkeypatch):
    from apps.cloud.config import Settings

    monkeypatch.setenv("WYSEBEE_MIXPANEL_TOKEN", "from-azure")
    assert Settings().mixpanel_token == "from-azure"
    monkeypatch.setenv("WYSEBEE_MIXPANEL_TOKEN", "")
    assert Settings().mixpanel_token is None


def test_web_config_is_not_swallowed_by_the_spa(ui_dist):
    with make_client(ui_dist) as client:
        assert client.get("/api/v1/web/config").headers["content-type"] == "application/json"


def test_web_config_without_the_sites_application_is_no_sign_in(ui_dist):
    with make_client(ui_dist, auth_issuer=ISSUER) as client:
        assert client.get("/api/v1/web/config").json()["auth"] == {"mode": "oidc", "issuer": None, "client_id": None, "audience": None, "connection": None}


def test_a_connection_is_announced_to_the_site(ui_dist):
    with make_client(ui_dist, auth_issuer=ISSUER, auth_web_client_id="webApp", auth_connection="email") as client:
        assert client.get("/api/v1/web/config").json()["auth"]["connection"] == "email"


def test_a_blank_connection_is_none():
    from apps.cloud.config import Settings

    assert Settings(auth_connection="  ").auth_connection is None
