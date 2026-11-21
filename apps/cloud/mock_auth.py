"""A stand-in sign-in provider for local development (``WYSEBEE_AUTH_MOCK=true``).

This site's web app signs in with OpenID Connect against whatever
issuer ``GET /api/v1/web/config`` announces. With the mock
on, that issuer is this app at ``/mock-auth/``: discovery, an authorize page that signs
in as whoever is typed into it (no password, no Auth0 account), a token endpoint
(authorization code + PKCE, and refresh), JWKS, userinfo, revocation and logout. The
clients run their real flow unchanged; only the provider is fake.

Everything is stateless: the authorization code and the refresh token are JWTs signed
with the same key as the access token, each with its own ``aud`` so neither passes for
another. The key is an RSA key kept in ``WYSEBEE_AUTH_MOCK_KEY_FILE`` (made on first
start), so a page stays signed in across container restarts.

Only for localhost: settings refuse a mock issuer anywhere else (config.py), and
redirects go to loopback addresses or this issuer's own origin only.
"""

import base64
import hashlib
import html
import logging
import time
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from apps.cloud.config import Settings

logger = logging.getLogger("wysebee.cloud.mock_auth")

PREFIX = "/mock-auth"
ACCESS_SECONDS = 3600
ID_SECONDS = 3600
CODE_SECONDS = 300
REFRESH_SECONDS = 90 * 86400
DEFAULT_NAME = "Local Developer"
DEFAULT_EMAIL = "dev@wysebee.local"


def _b64(n: int) -> str:
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _load_key(path: Path) -> rsa.RSAPrivateKey:
    if path.exists():
        key = serialization.load_pem_private_key(path.read_bytes(), password=None)
        assert isinstance(key, rsa.RSAPrivateKey)
        return key
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption(),
    ))
    path.chmod(0o600)
    logger.info("mock sign-in: new signing key at %s", path)
    return key


class MockAuth:
    """The mock issuer: its key and the tokens it signs."""

    def __init__(self, settings: Settings) -> None:
        assert settings.auth_issuer
        self.issuer = settings.auth_issuer
        self.audience = settings.auth_audience
        self.clients = {c for c in (settings.auth_web_client_id,) if c}
        self.key = _load_key(settings.auth_mock_key_file)
        numbers = self.key.public_key().public_numbers()
        self.kid = hashlib.sha256(_b64(numbers.n).encode()).hexdigest()[:16]
        self.jwk = {"kty": "RSA", "use": "sig", "alg": "RS256", "kid": self.kid, "n": _b64(numbers.n), "e": _b64(numbers.e)}

    @property
    def public_key(self) -> rsa.RSAPublicKey:
        return self.key.public_key()

    def endpoint(self, name: str) -> str:
        return self.issuer + name

    def sign(self, claims: dict[str, Any], seconds: int) -> str:
        now = int(time.time())
        return jwt.encode(
            {"iss": self.issuer, "iat": now, "exp": now + seconds, **claims},
            self.key, algorithm="RS256", headers={"kid": self.kid},
        )

    def read(self, token: str, audience: str) -> dict[str, Any]:
        """A code or refresh token's claims; :class:`jwt.InvalidTokenError` if it is not one."""
        return jwt.decode(token, self.public_key, algorithms=["RS256"], audience=audience, issuer=self.issuer)

    def tokens(self, person: dict[str, str], client_id: str, nonce: str | None, scope: str) -> dict[str, Any]:
        profile = {"sub": person["sub"], "name": person["name"], "email": person["email"], "nickname": person["nickname"]}
        id_claims = {**profile, "aud": client_id, "email_verified": True}
        if nonce:
            id_claims["nonce"] = nonce
        refresh = self.sign({**profile, "aud": self.endpoint("refresh"), "azp": client_id, "scope": scope}, REFRESH_SECONDS)
        return {
            "access_token": self.sign(
                {**profile, "aud": [self.audience, self.endpoint("userinfo")], "azp": client_id, "scope": scope},
                ACCESS_SECONDS,
            ),
            "id_token": self.sign(id_claims, ID_SECONDS),
            "refresh_token": refresh,
            "token_type": "Bearer",
            "expires_in": ACCESS_SECONDS,
            "scope": scope,
        }


def _redirect_allowed(url: str, issuer: str) -> bool:
    """Loopback (the web app's dev server, Vite) or this issuer's own origin (the web app)."""
    parts, own = urlsplit(url), urlsplit(issuer)
    if parts.scheme not in ("http", "https"):
        return False
    return parts.hostname in ("127.0.0.1", "localhost", "::1") or parts.netloc == own.netloc


def _mock(request: Request) -> MockAuth:
    return request.app.state.mock_auth


async def _form(request: Request) -> dict[str, str]:
    """An application/x-www-form-urlencoded body (no python-multipart needed for it)."""
    return dict(parse_qsl((await request.body()).decode("utf-8", "replace"), keep_blank_values=True))


def _error(error: str, description: str, status: int = 400) -> JSONResponse:
    return JSONResponse({"error": error, "error_description": description}, status_code=status)


async def localhost_cors(request: Request, call_next: Any) -> Any:
    """Let the Vite dev servers (http://localhost:5173, :5174) read discovery and the
    token endpoint across origins, as they do Auth0's. Localhost origins only."""
    response = await call_next(request)
    origin = request.headers.get("origin", "")
    if request.url.path.startswith(PREFIX + "/") and urlsplit(origin).hostname in ("localhost", "127.0.0.1"):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
    return response


router = APIRouter(prefix=PREFIX, tags=["Mock sign-in (local only)"], include_in_schema=False)


@router.get("/.well-known/openid-configuration")
async def discovery(request: Request) -> dict[str, Any]:
    m = _mock(request)
    return {
        "issuer": m.issuer,
        "authorization_endpoint": m.endpoint("authorize"),
        "token_endpoint": m.endpoint("oauth/token"),
        "userinfo_endpoint": m.endpoint("userinfo"),
        "jwks_uri": m.endpoint(".well-known/jwks.json"),
        "revocation_endpoint": m.endpoint("oauth/revoke"),
        "end_session_endpoint": m.endpoint("logout"),
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": ["openid", "profile", "email", "offline_access"],
    }


@router.get("/.well-known/jwks.json")
async def jwks(request: Request) -> dict[str, Any]:
    return {"keys": [_mock(request).jwk]}


_PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>Mock sign-in</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{{font:15px system-ui,sans-serif;max-width:380px;margin:12vh auto;padding:0 16px;color:#222}}
h1{{font-size:20px}}p{{color:#666}}label{{display:block;margin:12px 0 4px}}
input[type=text],input[type=email]{{width:100%;box-sizing:border-box;padding:8px;font:inherit}}
button{{margin-top:18px;padding:9px 16px;font:inherit;cursor:pointer}}</style></head><body>
<h1>Wysebee local sign-in</h1>
<p>Mock provider for local development: no password, you are signed in as whoever you type.</p>
<form method="post">{hidden}
<label>Name</label><input type="text" name="name" value="{name}" required>
<label>Email</label><input type="email" name="email" value="{email}" required>
<button type="submit">Sign in</button></form></body></html>"""


@router.get("/authorize")
async def authorize_page(request: Request) -> HTMLResponse:
    m, q = _mock(request), request.query_params
    redirect_uri = q.get("redirect_uri", "")
    if q.get("client_id") not in m.clients or not _redirect_allowed(redirect_uri, m.issuer):
        raise HTTPException(status_code=400, detail="Unknown client_id or redirect_uri.")
    if q.get("prompt") == "none":
        # A silent check (an iframe): nobody is "already signed in" here.
        back = {"error": "login_required", **({"state": q["state"]} if "state" in q else {})}
        return RedirectResponse(f"{redirect_uri}?{urlencode(back)}", status_code=302)  # type: ignore[return-value]
    hidden = "".join(
        f'<input type="hidden" name="{html.escape(k)}" value="{html.escape(v)}">'
        for k, v in q.items() if k in ("client_id", "redirect_uri", "state", "nonce", "scope", "code_challenge", "code_challenge_method")
    )
    return HTMLResponse(_PAGE.format(hidden=hidden, name=html.escape(DEFAULT_NAME), email=html.escape(DEFAULT_EMAIL)))


@router.post("/authorize")
async def authorize(request: Request) -> RedirectResponse:
    form = await _form(request)
    client_id, redirect_uri = form.get("client_id", ""), form.get("redirect_uri", "")
    name, email, state, nonce = form.get("name", ""), form.get("email", ""), form.get("state", ""), form.get("nonce", "")
    code_challenge, code_challenge_method = form.get("code_challenge", ""), form.get("code_challenge_method", "S256")
    scope = form.get("scope", "openid")
    m = _mock(request)
    if client_id not in m.clients or not _redirect_allowed(redirect_uri, m.issuer):
        raise HTTPException(status_code=400, detail="Unknown client_id or redirect_uri.")
    if code_challenge_method != "S256" or not code_challenge or "@" not in email:
        raise HTTPException(status_code=400, detail="An email, and PKCE with S256, are required.")
    email = email.strip().lower()
    code = m.sign({
        "aud": m.endpoint("code"),
        "sub": f"mock|{email}",
        "name": name.strip(),
        "email": email,
        "nickname": email.split("@")[0],
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "code_challenge": code_challenge,
        "nonce": nonce,
        "scope": scope,
    }, CODE_SECONDS)
    back = {"code": code, **({"state": state} if state else {})}
    logger.info("mock sign-in as %s for %s", email, client_id)
    return RedirectResponse(f"{redirect_uri}?{urlencode(back)}", status_code=302)


@router.post("/oauth/token")
async def token(request: Request) -> JSONResponse:
    m = _mock(request)
    form = await _form(request)
    grant, client_id = form.get("grant_type"), str(form.get("client_id", ""))
    if client_id not in m.clients:
        return _error("invalid_client", "Unknown client_id.", 401)
    try:
        if grant == "authorization_code":
            claims = m.read(str(form.get("code", "")), m.endpoint("code"))
            verifier = str(form.get("code_verifier", ""))
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
            if claims["client_id"] != client_id or claims["redirect_uri"] != form.get("redirect_uri") or challenge != claims["code_challenge"]:
                return _error("invalid_grant", "The code was not issued for this request.")
            nonce = claims.get("nonce") or None
        elif grant == "refresh_token":
            claims = m.read(str(form.get("refresh_token", "")), m.endpoint("refresh"))
            if claims.get("azp") != client_id:
                return _error("invalid_grant", "The refresh token was not issued to this client.")
            nonce = None
        else:
            return _error("unsupported_grant_type", "authorization_code or refresh_token.")
    except jwt.InvalidTokenError as exc:
        return _error("invalid_grant", str(exc))
    tokens = m.tokens(claims, client_id, nonce, claims.get("scope", "openid"))
    return JSONResponse(tokens, headers={"Cache-Control": "no-store"})


@router.get("/userinfo")
async def userinfo(request: Request) -> dict[str, Any]:
    m = _mock(request)
    auth = request.headers.get("authorization", "")
    try:
        claims = m.read(auth.removeprefix("Bearer ").strip(), m.endpoint("userinfo"))
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid token.") from exc
    return {k: claims[k] for k in ("sub", "name", "email", "nickname") if k in claims}


@router.post("/oauth/revoke")
async def revoke() -> dict[str, str]:
    """Nothing is stored, so nothing to revoke: the client forgets its tokens."""
    return {}


@router.get("/logout")
async def logout(request: Request) -> HTMLResponse:
    target = request.query_params.get("post_logout_redirect_uri", "")
    if target and _redirect_allowed(target, _mock(request).issuer):
        return RedirectResponse(target, status_code=302)  # type: ignore[return-value]
    return HTMLResponse("<!doctype html><title>Signed out</title><p>Signed out of the local mock provider.</p>")
