"""Bearer tokens: GET /api/v1/me.

Tokens are signed here with a throwaway RSA key and the verifier is pointed at its
public half, so nothing reaches a real Auth0 tenant.
"""

import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from apps.cloud.auth import TokenVerifier
from tests.conftest import make_client

ISSUER = "https://wysebee-test.us.auth0.com/"
AUDIENCE = "https://wysebee.ai/api"
DESKTOP = "appClientId123"
_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
# The verifier's own, before the fixture below swaps it for the local key.
_ISSUERS_KEY = TokenVerifier.signing_key


@pytest.fixture(autouse=True)
def _local_keys(monkeypatch):
    monkeypatch.setattr(TokenVerifier, "signing_key", lambda self, token: _KEY.public_key())


def token(key=_KEY, **overrides) -> str:
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        # As Auth0 issues them: the API, plus /userinfo when `openid` was asked for.
        "aud": [AUDIENCE, ISSUER + "userinfo"],
        "sub": "auth0|user-123",
        "azp": DESKTOP,
        "scope": "openid profile email offline_access",
        # Not in Auth0 access tokens by default; an Action may add them.
        "nickname": "dev",
        "email": "dev@wysebee.local",
        "name": "Dev User",
        "iat": now,
        "exp": now + 300,
        **overrides,
    }
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "test"})


def me(ui_dist, bearer: str | None, **settings):
    settings.setdefault("auth_issuer", ISSUER)
    headers = {"Authorization": f"Bearer {bearer}"} if bearer else {}
    with make_client(ui_dist, **settings) as client:
        return client.get("/api/v1/me", headers=headers)


def test_a_valid_token_is_the_user(ui_dist):
    r = me(ui_dist, token())
    assert r.status_code == 200
    assert r.json() == {"sub": "auth0|user-123", "username": "dev", "email": "dev@wysebee.local", "name": "Dev User"}


def test_a_plain_auth0_token_is_just_the_subject(ui_dist):
    r = me(ui_dist, token(nickname=None, email=None, name=None))
    assert r.json() == {"sub": "auth0|user-123", "username": "", "email": "", "name": ""}


@pytest.mark.parametrize("claims, client", [
    ({}, DESKTOP),
    ({"azp": None, "client_id": "fromClientIdClaim"}, "fromClientIdClaim"),
    ({"azp": None}, ""),
])
def test_the_application_is_azp_or_client_id(claims, client):
    from apps.cloud.config import Settings

    verifier = TokenVerifier(Settings(auth_issuer=ISSUER))
    assert verifier.verify(token(**claims)).client_id == client


def test_no_token_is_401(ui_dist):
    r = me(ui_dist, None)
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize(
    "bad",
    [
        pytest.param(token(key=_OTHER_KEY), id="wrong-signature"),
        pytest.param(token(iss="https://evil.us.auth0.com/"), id="wrong-issuer"),
        pytest.param(token(iss=ISSUER.rstrip("/")), id="issuer-without-its-slash"),
        pytest.param(token(aud=ISSUER + "userinfo"), id="not-for-this-api"),
        pytest.param(token(exp=int(time.time()) - 120), id="expired"),
        pytest.param(token(sub=None), id="no-subject"),
        pytest.param("not-a-jwt", id="garbage"),
    ],
)
def test_bad_tokens_are_401(ui_dist, bad):
    assert me(ui_dist, bad).status_code == 401


def test_without_sign_in_configured_it_is_503_not_open(ui_dist):
    r = me(ui_dist, token(), auth_issuer=None)
    assert r.status_code == 503


@pytest.mark.parametrize("configured", [ISSUER, ISSUER.rstrip("/"), ISSUER + "/", f"  {ISSUER} "])
def test_the_issuer_gets_exactly_auth0s_trailing_slash(ui_dist, configured):
    assert me(ui_dist, token(), auth_issuer=configured).status_code == 200


def test_keys_default_to_auth0s_path():
    from apps.cloud.config import Settings

    assert Settings(auth_issuer=ISSUER).jwks_url == ISSUER + ".well-known/jwks.json"
    assert Settings(auth_issuer=ISSUER, auth_jwks_url="https://keys.example/x").jwks_url == "https://keys.example/x"
    assert Settings().jwks_url is None


def test_an_extra_audience_is_accepted_only_where_asked():
    from apps.cloud.config import Settings

    mcp = "https://wysebee.ai/mcp"
    verifier = TokenVerifier(Settings(auth_issuer=ISSUER))
    for_mcp = token(aud=mcp)
    assert verifier.verify(for_mcp, [AUDIENCE, mcp]).sub == "auth0|user-123"
    assert verifier.verify(token(), [AUDIENCE, mcp]).sub == "auth0|user-123"
    with pytest.raises(jwt.InvalidAudienceError):
        verifier.verify(for_mcp)  # every other route
    with pytest.raises(jwt.InvalidAudienceError):
        verifier.verify(token(aud="https://elsewhere.example/mcp"), [AUDIENCE, mcp])


def test_a_token_for_mcp_is_refused_by_the_rest_of_the_api(ui_dist):
    assert me(ui_dist, token(aud="https://wysebee.ai/mcp")).status_code == 401


def test_the_issuers_key_set_names_the_signing_key(monkeypatch):
    from types import SimpleNamespace

    from apps.cloud.config import Settings

    monkeypatch.setattr(TokenVerifier, "signing_key", _ISSUERS_KEY)
    verifier = TokenVerifier(Settings(auth_issuer=ISSUER))
    asked: list[str] = []

    def from_jwt(t: str):  # in place of fetching the issuer's JWKS
        asked.append(jwt.get_unverified_header(t)["kid"])
        return SimpleNamespace(key=_KEY.public_key())

    monkeypatch.setattr(verifier._keys, "get_signing_key_from_jwt", from_jwt)
    assert verifier.verify(token()).sub == "auth0|user-123"
    assert asked == ["test"]


def test_keys_that_cannot_be_fetched_are_401_not_500(ui_dist, monkeypatch):
    def unavailable(self, t):
        raise jwt.PyJWKClientError("Fail to fetch data from the url")

    monkeypatch.setattr(TokenVerifier, "signing_key", unavailable)
    r = me(ui_dist, token())
    assert r.status_code == 401
    assert r.json()["detail"] == "Token could not be verified." and r.headers["www-authenticate"] == "Bearer"
