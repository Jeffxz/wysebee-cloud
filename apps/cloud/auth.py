"""Who is calling: verifying the bearer tokens Auth0 issues to signed-in users.

The website signs in with Auth0 (authorization code + PKCE, asking for
this API as ``audience``) and send the access token as ``Authorization: Bearer
<token>``. A token is accepted when it is signed by one of the tenant's keys (fetched
from its JWKS URL and cached), says the configured issuer, names this API in ``aud``
(``WYSEBEE_AUTH_AUDIENCE``, the Auth0 API's identifier) and has not expired. Nothing is
stored: a request is authenticated by its token alone.

Auth0 access tokens carry who (``sub``, e.g. ``auth0|…`` or ``google-oauth2|…``) and
which application (``azp``), not the person's email or name: those are in the ID token
the client keeps. ``email``/``name`` here are filled only if an Auth0 Action adds them.

Routes opt in with ``user: User = Depends(current_user)``. With no issuer configured
they answer 503 — sign-in is not set up — rather than letting anyone through.

**Self-hosted** (``WYSEBEE_EDITION=selfhost``, :func:`local_owner`): there is no provider and
no token to verify. Every caller is the one owner the settings name — after showing
``WYSEBEE_SELFHOST_TOKEN`` as their bearer token, when one is set.
"""

import hmac
import logging
from dataclasses import dataclass, field
from typing import Any

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from apps.cloud.config import Settings

logger = logging.getLogger("wysebee.cloud.auth")

# Small clock differences between the provider and this service.
LEEWAY_SECONDS = 30
ALGORITHMS = ["RS256", "ES256", "PS256"]

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class User:
    """The signed-in person, from their access token's claims."""

    sub: str
    username: str = ""
    email: str = ""
    name: str = ""
    # Which Auth0 application the token was issued to (`azp`).
    client_id: str = ""
    # When the token stops being valid (epoch seconds; 0 = unknown). A stream opened
    # with it closes by then, so a signed-out session cannot keep listening.
    expires_at: float = 0
    claims: dict[str, Any] = field(default_factory=dict, repr=False)


class TokenVerifier:
    """Checks access tokens against one issuer. One per app, so keys are cached."""

    def __init__(self, settings: Settings, key: Any = None) -> None:
        """``key``: the one public key tokens are signed with, instead of the issuer's
        JWKS — the local mock provider's (apps/cloud/mock_auth.py)."""
        self.issuer = settings.auth_issuer
        self.audience = settings.auth_audience
        self._key = key
        # PyJWKClient caches the key set and refetches it when a token names a key it
        # has not seen, so the provider can rotate keys without a restart.
        self._keys = jwt.PyJWKClient(settings.jwks_url, cache_keys=True, timeout=5) if settings.jwks_url and key is None else None

    @property
    def enabled(self) -> bool:
        return self._keys is not None or self._key is not None

    def signing_key(self, token: str) -> Any:
        if self._key is not None:
            return self._key
        assert self._keys is not None
        return self._keys.get_signing_key_from_jwt(token).key

    def verify(self, token: str, audiences: list[str] | None = None) -> User:
        """The token's user, or :class:`jwt.InvalidTokenError` / :class:`jwt.PyJWKClientError`.

        ``audiences``: what ``aud`` may name instead of the API's — any one of them. Only
        ``/mcp`` passes it (its own address; apps/cloud/relay.py), so a token issued for
        that one resource is good there and nowhere else."""
        claims = jwt.decode(
            token,
            self.signing_key(token),
            algorithms=ALGORITHMS,
            audience=audiences or self.audience,
            issuer=self.issuer,
            leeway=LEEWAY_SECONDS,
            options={"require": ["exp", "iat", "iss", "sub", "aud"]},
        )
        return User(
            sub=claims["sub"],
            username=claims.get("nickname", "") or claims.get("preferred_username", ""),
            email=claims.get("email", ""),
            name=claims.get("name", ""),
            client_id=claims.get("azp", "") or claims.get("client_id", "") or "",
            expires_at=float(claims.get("exp", 0) or 0),
            claims=claims,
        )


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=401, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def local_owner(settings: Settings, token: str | None) -> User | None:
    """A self-hosted server's owner, when ``token`` is good for this server: any token (or
    none) when no ``selfhost_token`` is set, else exactly that one, compared in constant
    time. None: refused."""
    expected = settings.selfhost_token
    if expected and not (token and hmac.compare_digest(token.encode(), expected.encode())):
        return None
    return User(sub=settings.selfhost_user_id, name=settings.selfhost_user_name, email=settings.selfhost_user_email)


async def current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> User:
    settings: Settings = request.app.state.settings
    if settings.selfhost:
        owner = local_owner(settings, credentials.credentials if credentials else None)
        if owner is None:
            raise _unauthorized("This server's access token is required.")
        return owner
    verifier: TokenVerifier = request.app.state.token_verifier
    if not verifier.enabled:
        raise HTTPException(status_code=503, detail="Sign-in is not configured on this server.")
    if credentials is None:
        raise _unauthorized("Sign in required.")
    try:
        # Fetching keys is blocking I/O (on a cache miss), so off the event loop.
        return await run_in_threadpool(verifier.verify, credentials.credentials)
    except jwt.PyJWKClientError as exc:
        # The provider could not be asked for its keys, or does not know this key id.
        logger.warning("token keys unavailable: %s", exc)
        raise _unauthorized("Token could not be verified.") from exc
    except jwt.InvalidTokenError as exc:
        raise _unauthorized(f"Invalid token: {exc}") from exc
