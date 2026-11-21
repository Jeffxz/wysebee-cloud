"""``GET /api/v1/web/config``: what this site's own pages need at runtime.

The React app is built once and served everywhere, so anything that differs per
deployment — where to sign in, whether to send usage events — is read from here when the page
loads instead of being baked into the bundle.

Since 2026-11-15 the pages post their usage events to this server (``POST /api/v1/events``,
apps/cloud/usage_events.py), which keeps them and forwards them to Mixpanel; the Mixpanel project
is no longer told to the page.

Public: nothing here is a secret (the Auth0 tenant, public client id and API audience).
"""

from typing import Literal

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from apps.cloud import extensions
from apps.cloud.config import Settings

router = APIRouter(prefix="/v1/web", tags=["Web"])

# Short: a changed setting should reach open tabs on their next load.
CACHE_SECONDS = 60


class WebAuth(BaseModel):
    mode: Literal["oidc", "none", "token"] = Field(
        default="oidc",
        description="\"oidc\": sign in with the issuer below; \"none\": a self-hosted server, no sign-in; "
        "\"token\": a self-hosted server that wants its access token as the bearer token",
    )
    issuer: str | None = Field(description="OIDC issuer; null when sign-in is not set up")
    client_id: str | None = Field(description="The site's public client; null when sign-in is not set up")
    audience: str | None = Field(description="API audience to request; null when sign-in is not set up")
    connection: str | None = Field(default=None, description="Auth0 connection to sign in with; null = any")


class WebAnalytics(BaseModel):
    enabled: bool = Field(description="Whether the pages send usage events (POST /api/v1/events); false = track nothing")


class WebFeatures(BaseModel):
    """Feature flags the pages follow, given by the server's extensions (apps/cloud/extensions.py)."""

    billing: bool = Field(
        default=False,
        description="An extension serves GET /api/v1/plan and /api/v1/billing: the pages show Account → Billing, "
        "and show only it while the plan says the person may not use the rest",
    )


class WebConfig(BaseModel):
    edition: Literal["cloud", "selfhost"] = Field(default="cloud", description="The hosted service, or a self-hosted server (no account deletion)")
    auth: WebAuth
    analytics: WebAnalytics
    features: WebFeatures


@router.get("/config", response_model=WebConfig)
async def web_config(request: Request, response: Response) -> WebConfig:
    settings: Settings = request.app.state.settings
    response.headers["Cache-Control"] = f"public, max-age={CACHE_SECONDS}"
    if settings.selfhost:
        auth = WebAuth(mode="token" if settings.selfhost_token else "none", issuer=None, client_id=None, audience=None)
    else:
        auth = (
            WebAuth(
                issuer=settings.auth_issuer, client_id=settings.auth_web_client_id,
                audience=settings.auth_audience, connection=settings.auth_connection,
            )
            if settings.auth_issuer and settings.auth_web_client_id
            else WebAuth(issuer=None, client_id=None, audience=None)
        )
    return WebConfig(
        edition=settings.edition,
        auth=auth,
        analytics=WebAnalytics(enabled=settings.events_enabled),
        features=WebFeatures(billing=extensions.web_features(request.app.state.extensions).get("billing", False)),
    )
