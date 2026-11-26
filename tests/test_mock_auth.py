"""The local mock sign-in provider (WYSEBEE_AUTH_MOCK): the web app's flow, end to end."""

import base64
import hashlib
from urllib.parse import parse_qs, urlsplit

import jwt
import pytest
from pydantic import ValidationError

from apps.cloud.config import Settings
from tests.conftest import make_client

WEB = "wysebee-web-local"
REDIRECT = "http://127.0.0.1:47820/callback"
VERIFIER = "v" * 64
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()


@pytest.fixture
def client(ui_dist, tmp_path):
    with make_client(ui_dist, auth_mock=True, auth_mock_key_file=tmp_path / "key.pem") as c:
        yield c


def sign_in(client, email="ada@example.com", verifier=VERIFIER, redirect=REDIRECT):
    page = client.get("/mock-auth/authorize", params={"client_id": WEB, "redirect_uri": redirect, "state": "s1"})
    assert page.status_code == 200 and "Wysebee local sign-in" in page.text
    r = client.post("/mock-auth/authorize", data={
        "client_id": WEB, "redirect_uri": redirect, "name": "Ada", "email": email,
        "code_challenge": CHALLENGE, "code_challenge_method": "S256", "state": "s1", "nonce": "n1",
        "scope": "openid profile email offline_access",
    }, follow_redirects=False)
    assert r.status_code == 302
    back = urlsplit(r.headers["location"])
    query = parse_qs(back.query)
    assert f"{back.scheme}://{back.netloc}{back.path}" == redirect and query["state"] == ["s1"]
    return client.post("/mock-auth/oauth/token", data={
        "grant_type": "authorization_code", "code": query["code"][0], "redirect_uri": redirect,
        "client_id": WEB, "code_verifier": verifier,
    })


def test_the_site_is_told_the_local_issuer(client):
    auth = client.get("/api/v1/web/config").json()["auth"]
    assert auth["issuer"] == "http://localhost:8000/mock-auth/" and auth["client_id"] == WEB
    discovery = client.get("/mock-auth/.well-known/openid-configuration").json()
    assert discovery["issuer"] == auth["issuer"]
    assert discovery["token_endpoint"] == "http://localhost:8000/mock-auth/oauth/token"


def test_the_code_flow_signs_in_and_the_api_accepts_the_token(client):
    r = sign_in(client)
    assert r.status_code == 200
    tokens = r.json()
    claims = jwt.decode(tokens["id_token"], options={"verify_signature": False})
    assert claims["nonce"] == "n1" and claims["aud"] == WEB and claims["sub"] == "mock|ada@example.com"
    me = client.get("/api/v1/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert me.json() == {"sub": "mock|ada@example.com", "username": "ada", "email": "ada@example.com", "name": "Ada"}

    refreshed = client.post("/mock-auth/oauth/token", data={
        "grant_type": "refresh_token", "refresh_token": tokens["refresh_token"], "client_id": WEB,
    })
    assert refreshed.status_code == 200
    me = client.get("/api/v1/me", headers={"Authorization": f"Bearer {refreshed.json()['access_token']}"})
    assert me.status_code == 200


def test_only_tokens_of_the_right_kind_pass(client):
    tokens = sign_in(client).json()
    # A refresh token is not an access token, nor the other way round.
    assert client.get("/api/v1/me", headers={"Authorization": f"Bearer {tokens['refresh_token']}"}).status_code == 401
    r = client.post("/mock-auth/oauth/token", data={
        "grant_type": "refresh_token", "refresh_token": tokens["access_token"], "client_id": WEB,
    })
    assert r.status_code == 400 and r.json()["error"] == "invalid_grant"


def test_a_wrong_verifier_or_redirect_is_refused(client):
    r = sign_in(client, verifier="w" * 64)
    assert r.status_code == 400 and r.json()["error"] == "invalid_grant"
    r = client.get("/mock-auth/authorize", params={"client_id": WEB, "redirect_uri": "https://evil.example/cb"})
    assert r.status_code == 400


def test_the_key_survives_a_restart(ui_dist, tmp_path):
    key = tmp_path / "key.pem"
    with make_client(ui_dist, auth_mock=True, auth_mock_key_file=key) as first:
        tokens = sign_in(first).json()
    with make_client(ui_dist, auth_mock=True, auth_mock_key_file=key) as second:
        me = second.get("/api/v1/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
        assert me.status_code == 200


def test_off_by_default_and_never_off_localhost(ui_dist):
    with make_client(ui_dist) as c:
        # Only the SPA's shell answers there.
        assert "issuer" not in c.get("/mock-auth/.well-known/openid-configuration").text
        assert c.get("/api/v1/web/config").json()["auth"]["issuer"] is None
    with pytest.raises(ValidationError):
        Settings(auth_mock=True, auth_issuer="https://app.wysebee.com/mock-auth/")


def test_the_vite_dev_servers_may_read_it(client):
    r = client.get("/mock-auth/.well-known/openid-configuration", headers={"Origin": "http://localhost:5174"})
    assert r.headers["access-control-allow-origin"] == "http://localhost:5174"
    r = client.get("/mock-auth/.well-known/openid-configuration", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in r.headers


def test_jwks_publishes_the_key_that_signs_the_tokens(client):
    tokens = sign_in(client).json()
    keys = client.get("/mock-auth/.well-known/jwks.json").json()["keys"]
    assert len(keys) == 1 and keys[0]["kty"] == "RSA"
    assert jwt.get_unverified_header(tokens["access_token"])["kid"] == keys[0]["kid"]
    key = jwt.PyJWK(keys[0]).key
    assert jwt.decode(tokens["id_token"], key, algorithms=["RS256"], audience=WEB)["email"] == "ada@example.com"


def test_a_silent_check_is_never_signed_in(client):
    r = client.get("/mock-auth/authorize", params={"client_id": WEB, "redirect_uri": REDIRECT, "prompt": "none", "state": "s2"}, follow_redirects=False)
    assert r.status_code == 302
    assert parse_qs(urlsplit(r.headers["location"]).query) == {"error": ["login_required"], "state": ["s2"]}
    r = client.get("/mock-auth/authorize", params={"client_id": WEB, "redirect_uri": REDIRECT, "prompt": "none"}, follow_redirects=False)
    assert parse_qs(urlsplit(r.headers["location"]).query) == {"error": ["login_required"]}


def test_signing_in_needs_a_known_client_an_email_and_pkce(client):
    form = {"client_id": WEB, "redirect_uri": REDIRECT, "name": "Ada", "email": "ada@example.com", "code_challenge": CHALLENGE}
    post = lambda **change: client.post("/mock-auth/authorize", data={**form, **change}, follow_redirects=False)
    assert post().status_code == 302
    assert post(client_id="someone-else").status_code == 400
    # Only http(s) redirects, to loopback or the issuer's own origin.
    assert post(redirect_uri="wysebee://callback").status_code == 400
    assert post(redirect_uri="http://localhost:8000/app/").status_code == 302
    assert post(email="ada").status_code == 400
    assert post(code_challenge="").status_code == 400
    assert post(code_challenge_method="plain").status_code == 400


def test_the_token_endpoint_refuses_what_it_did_not_issue(client):
    tokens = sign_in(client).json()
    r = client.post("/mock-auth/oauth/token", data={"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"], "client_id": "unknown"})
    assert r.status_code == 401 and r.json()["error"] == "invalid_client"
    # A refresh token issued to one client is not another's.
    client.app.state.mock_auth.clients.add("another-app")
    r = client.post("/mock-auth/oauth/token", data={"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"], "client_id": "another-app"})
    assert r.status_code == 400 and r.json() == {"error": "invalid_grant", "error_description": "The refresh token was not issued to this client."}
    r = client.post("/mock-auth/oauth/token", data={"grant_type": "password", "client_id": WEB})
    assert r.status_code == 400 and r.json()["error"] == "unsupported_grant_type"


def test_userinfo_reads_the_access_token_only(client):
    tokens = sign_in(client).json()
    r = client.get("/mock-auth/userinfo", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert r.json() == {"sub": "mock|ada@example.com", "name": "Ada", "email": "ada@example.com", "nickname": "ada"}
    assert client.get("/mock-auth/userinfo", headers={"Authorization": f"Bearer {tokens['refresh_token']}"}).status_code == 401
    assert client.get("/mock-auth/userinfo").status_code == 401


def test_revoke_and_logout(client):
    assert client.post("/mock-auth/oauth/revoke", data={"token": "anything"}).json() == {}
    r = client.get("/mock-auth/logout", params={"post_logout_redirect_uri": "http://localhost:5173/"}, follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == "http://localhost:5173/"
    # Anywhere else: no redirect, just a page.
    for params in ({"post_logout_redirect_uri": "https://evil.example/"}, {}):
        r = client.get("/mock-auth/logout", params=params, follow_redirects=False)
        assert r.status_code == 200 and "Signed out" in r.text
