"""Runtime settings, read from the environment (prefix ``WYSEBEE_``)."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The SPA is built by `cd ui && yarn build` straight into this folder.
DEFAULT_UI_DIST = Path(__file__).resolve().parent / "dist"

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="WYSEBEE_", env_file=".env", extra="ignore", populate_by_name=True)

    # Which Wysebee Cloud this is. "cloud": the hosted service — Auth0 sign-in, usage
    # analytics, and whatever its extensions add. "selfhost": one person's own server (README,
    # "Self-hosting") — no sign-in provider: every request is the one owner below, and account
    # deletion is not served. Usage events and the storage
    # quota get self-host defaults unless set (see :meth:`_selfhost_defaults`).
    edition: Literal["cloud", "selfhost"] = "cloud"
    # Self-host: a shared secret every request must carry (``Authorization: Bearer <it>``) —
    # the web app asks for it once. Unset: no check at all, so keep the server on this machine
    # (compose publishes it on 127.0.0.1) or set one before other devices can reach it.
    # Paired agents never send it: they use their own pairing secrets. Never logged or returned.
    selfhost_token: str | None = Field(default=None, repr=False)
    # Self-host: who the owner is — the user id their data is kept under, and their name and
    # email as the pages show them.
    selfhost_user_id: str = "local|owner"
    selfhost_user_name: str = "Owner"
    selfhost_user_email: str = ""

    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "info"
    ui_dist: Path = DEFAULT_UI_DIST

    # SQLAlchemy URL. Local dev (docker compose) points at the `db` container;
    # Azure Database for PostgreSQL needs `?sslmode=require` on the end.
    # A plain `postgresql://` / `postgres://` URL is accepted and given the psycopg driver.
    database_url: str = "postgresql+psycopg://wysebee:wysebee@localhost:5432/wysebee"
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_echo: bool = False

    # Sign-in, with Auth0. The issuer is the tenant's URL as tokens carry it in `iss`
    # — https://<tenant>.<region>.auth0.com/ or the custom domain, always ending in "/"
    # (added if left out) — and is told to the website (GET /api/v1/web/config). Unset: no
    # sign-in.
    auth_issuer: str | None = None
    # The Auth0 API's identifier. Clients ask for it as `audience` when signing in —
    # without it Auth0 issues an opaque access token this API cannot verify — and a
    # token must name it in `aud` to be accepted.
    auth_audience: str = "https://wysebee.ai/api"
    # Where the signing keys are. Default: <issuer>.well-known/jwks.json, Auth0's.
    auth_jwks_url: str | None = None
    # The Auth0 application this site's own pages sign in as (a Single Page
    # Application; GET /api/v1/web/config).
    auth_web_client_id: str | None = None
    # An Auth0 connection every sign-in is sent to (`connection` on /authorize), e.g.
    # "email" for the passwordless email code alone. Unset: Auth0's Universal Login
    # offers every connection enabled for the application (with Identifier First, the
    # email code among them).
    auth_connection: str | None = None

    # Local development only: this app is its own sign-in provider (apps/cloud/mock_auth.py),
    # a small OpenID Connect issuer at /mock-auth/ whose page signs anyone in as whoever
    # they type — no Auth0 account. The issuer must be on localhost; the client ids
    # default to local ones. Never on in a deployment.
    auth_mock: bool = False
    # Its RSA signing key, made on first start and kept, so tokens outlive a restart.
    auth_mock_key_file: Path = Path("./data/mock-auth/key.pem")
    # Local development only, and only with auth_mock: Wysebee Assistant, /assistant/mcp
    # (apps/cloud/agent_mcp.py), answers **without sign-in**, as this person (e.g.
    # "mock|dev@wysebee.local"), so Claude or ChatGPT can reach a local container through a
    # tunnel such as ngrok (set public_url to the tunnel's address). Refused without auth_mock.
    assistant_mcp_local_user: str | None = None

    # Usage events from this site's pages, the landing page (ui/cloud analytics.ts) and the web
    # app at /app/ (ui/app telemetry.ts), since 2026-11-15 all posted to POST /api/v1/events
    # (apps/cloud/usage_events.py): kept in ``usage_events`` and, when a Mixpanel project is
    # named, forwarded there. Off: the pages send nothing and the route answers 404.
    events_enabled: bool = True
    # How long a stored event is kept, by when it happened; 0 keeps them for good. 395 days
    # (13 months) allows comparing a month with the same month a year before.
    events_retention_days: int = 395
    # How often the old ones are deleted.
    events_purge_seconds: float = 24 * 3600
    # Batches each person (or, before sign-in, each address) may post a minute, on each
    # replica. The web app posts one every 5 seconds at most, plus one as a page closes.
    events_batches_per_minute: int = 30
    # The Mixpanel project stored events are forwarded to, from the server (2026-11-15; until
    # then the pages posted to Mixpanel themselves). Unset, nothing goes to Mixpanel.
    mixpanel_token: str | None = None
    # "https://api-eu.mixpanel.com" for an EU-resident project; unset, Mixpanel's default.
    mixpanel_api_host: str | None = None

    # The Azure Blob Storage account every file store uses unless its own is set: its blob
    # endpoint (https://<account>.blob.core.windows.net). The app signs in with its managed
    # identity, which needs "Storage Blob Data Contributor" on each container; no account key
    # is configured. Read from WYSEBEE_STORAGE_AZURE_ACCOUNT_URL, or — the name deployments
    # set while desktop backups were kept here (until migration 0062) —
    # WYSEBEE_BACKUP_AZURE_ACCOUNT_URL.
    storage_azure_account_url: str | None = Field(
        default=None, validation_alias=AliasChoices("storage_azure_account_url", "WYSEBEE_STORAGE_AZURE_ACCOUNT_URL", "WYSEBEE_BACKUP_AZURE_ACCOUNT_URL")
    )

    # Assets (apps/cloud/assets.py): small images a person stores here, each named by
    # the SHA-256 of its bytes — agents' pictures. Where they are written: "file" (under
    # asset_dir — local dev and compose) or "azure" (one blob each — production; a
    # container's own disk does not survive a revision).
    asset_store: Literal["file", "azure"] = "file"
    asset_dir: Path = Path("./data/assets")
    # For "azure": the account's blob endpoint — unset, storage_azure_account_url's (one
    # storage account for every store) — and the container.
    asset_azure_account_url: str | None = None
    asset_azure_container: str = "user-assets"
    # The largest asset one upload may be, and how many one person may keep.
    asset_max_bytes: int = 1024**2
    asset_max_count: int = 100

    # Skill files (apps/cloud/skill_files.py): the files of the person's skills, any bytes, named by their SHA-256 — kept like assets (asset_store's kind and
    # account) in a container, or folder, of their own.
    skill_file_dir: Path = Path("./data/user-skills")
    skill_file_azure_container: str = "user-skills"
    skill_file_max_bytes: int = 5 * 1024**2
    skill_file_max_count: int = 5000

    # Workspaces (apps/cloud/workspaces.py): each a folder of the person's documentation files,
    # named by their paths — kept like assets (asset_store's kind and account) in a container,
    # or folder, of their own: "<user id>/<workspace name>/<path>". The largest file, how many
    # files one workspace may hold, and how many workspaces one person may have.
    workspace_dir: Path = Path("./data/user-workspaces")
    workspace_azure_container: str = "user-workspaces"
    workspace_file_max_bytes: int = 1024**2
    workspace_max_files: int = 1000
    workspace_max_count: int = 50
    # Browser recordings (apps/cloud/browser_recordings.py): the scenario videos the Wysebee
    # Agent extension films (browser_record) and uploads, kept like assets (asset_store's kind
    # and account) in a container, or folder, of their own: "<user id>/<recording id>.webm".
    # The largest one upload may be, and how many one person may keep.
    recording_dir: Path = Path("./data/browser-recordings")
    recording_azure_container: str = "browser-recordings"
    recording_max_bytes: int = 500 * 1024**2
    recording_max_count: int = 500
    # Wysebee Assistant (apps/cloud/workspace_assistant.py): the person's AI app writing the
    # page open in their editor. The editor's long poll waits at most this long...
    workspace_assistant_wait_seconds: float = 20
    # ...and an editor not heard from for this long is taken as closed: the AI app is told so.
    workspace_assistant_idle_seconds: float = 60

    # Storage (apps/cloud/storage.py): how many bytes of files — assets, skill files and
    # recordings together — one person may keep, unless an extension's policy gives them more
    # (apps/cloud/extensions.py).
    storage_quota_bytes: int = 1024**3

    # The most an agent's settings may hold (apps/cloud/agents.py).
    config_item_max_bytes: int = 256 * 1024
    # The change feed (GET /api/v1/configs/events).
    config_events_heartbeat_seconds: float = 20
    # A stream ends after this long (or at its token's expiry, whichever is first) and the
    # client reconnects — under Azure Container Apps' ingress limits.
    config_events_max_seconds: float = 230
    # LISTEN on Postgres for changes made by other replicas. Needs a direct connection
    # (not PgBouncer in transaction mode). Off: each stream still polls every heartbeat.
    config_events_listen: bool = True

    # Connect AI app (apps/cloud/agent_mcp.py, 2026-11-14): the person's own AI app (Claude,
    # ChatGPT) uses every agent's tools through Wysebee Assistant, at /assistant/mcp.
    # Off: /assistant/mcp, its OAuth metadata and /api/v1/mcp/* are 404.
    mcp_enabled: bool = True
    # This site's public address, e.g. https://app.wysebee.com: Wysebee Assistant's address is
    # <it>/assistant/mcp, the resource an AI app asks Auth0 for a token for, and an `aud`
    # it accepts (as well as auth_audience). Unset: taken from each request's Host /
    # X-Forwarded-Host (X-Forwarded-Proto honoured).
    public_url: str | None = None
    # Where pages shared publicly are served (apps/cloud/workspace_pages.py, 2026-11-25), e.g.
    # https://wysebee.io: a domain of their own, apart from this site's, so what people make is
    # never served as Wysebee — a page that slipped its sandbox would find no sign-in there, and
    # a page reported as phishing would get that domain flagged, not this one. Set, the server
    # answers on it with shared pages only (and none here); unset, they are served from this
    # site (local development, self-hosted).
    share_url: str | None = None
    # How long one tool call may run before it is stopped and answered as timed out — under
    # Azure Container Apps' 240 s request limit.
    mcp_call_wait_seconds: float = 200
    # Scheduled tasks (apps/cloud/task_runner.py): how often the scheduler looks for due ones,
    # and after how long a run that never finished (its replica gone) may be claimed again.
    task_tick_seconds: float = 20
    task_run_stale_seconds: float = 900
    # Keepalive comments on the waiting response, so no proxy closes it as idle.
    mcp_keepalive_seconds: float = 15
    # A call's arguments, as JSON.
    mcp_arguments_max_chars: int = 100_000
    # A result's whole JSON, pictures included.
    mcp_result_max_bytes: int = 8_000_000

    # The browser link (apps/cloud/browser_links.py): the Wysebee Agent browser extension,
    # paired with this cloud and driven through it. A pairing code is good this long...
    browser_link_code_seconds: float = 600
    # ...and at most this many links may wait for their code to be typed at once (the
    # unauthenticated /start cannot fill the table); one address may start this many a
    # minute, on each replica, and hold at most this many waiting codes at once, across
    # replicas (so a few addresses cannot fill the table for everyone, 2026-11-18).
    browser_link_pending_max: int = 2000
    browser_link_starts_per_minute: int = 10
    browser_link_pending_per_address: int = 10
    # Wrong codes one account may type in browser_link_try_window_seconds, on each replica.
    browser_link_tries: int = 10
    browser_link_try_window_seconds: float = 600
    # An extension that polled within this long is connected; a call for one that has not
    # is refused at once.
    browser_link_online_seconds: float = 45
    # The longest the extension's poll waits (an MV3 worker is killed when a fetch takes
    # 30 s), and the longest a driver's wait for a call's result does.
    browser_link_poll_seconds: float = 25
    browser_link_wait_seconds: float = 25
    # A call the extension has not taken after this long fails ("could not be reached").
    browser_link_claim_seconds: float = 20
    # A call's own time limit (its timeout_seconds): the default and the bounds.
    browser_link_call_seconds: float = 60
    browser_link_call_min_seconds: float = 5
    browser_link_call_max_seconds: float = 240
    # A call's arguments as JSON, and a result's body (screenshots count).
    browser_link_args_max_bytes: int = 100_000
    browser_link_result_max_bytes: int = 16_000_000
    # Calls not read by then are deleted: an hour.
    browser_link_keep_seconds: float = 3600

    # How often browser calls past browser_link_keep_seconds are purged (apps/cloud/main.py;
    # named for the remote turns it purged too, until chat went on 2026-11-14).
    turn_purge_seconds: float = 300

    # Extensions (apps/cloud/extensions.py): the modules to load, comma-separated — what a
    # deployment adds that is not in this repository, e.g. the hosted service's plans.
    extensions: str = ""
    # Auth0's Management API, to delete a person's identity with their account
    # (apps/cloud/account_deletion.py): the tenant's own *.auth0.com domain, not a custom one, and
    # a machine-to-machine application allowed delete:users alone. Unset: accounts cannot be deleted.
    auth0_mgmt_domain: str | None = None
    auth0_mgmt_client_id: str | None = None
    auth0_mgmt_client_secret: str | None = Field(default=None, repr=False)


    # The key-encryption key the passwords of cloud agents' PostgreSQL connections are
    # stored under (apps/cloud/envelope.py, apps/cloud/user_tools.py) — named for the AI
    # keys it first sealed. Production: an Azure Key Vault RSA key's URL
    # (https://<vault>.vault.azure.net/keys/<name>), used as the app's identity
    # (DefaultAzureCredential). Local development: a base64 32-byte key (``ai_kek``).
    # Neither set: those connections cannot keep a password (503).
    ai_kek_vault_key_url: str | None = Field(default=None, repr=False)
    ai_kek: str | None = Field(default=None, repr=False)

    @property
    def selfhost(self) -> bool:
        return self.edition == "selfhost"

    @property
    def asset_account_url(self) -> str | None:
        """The asset store's Azure account (and the skill file and workspace stores'): its own
        setting, else the shared one."""
        return self.asset_azure_account_url or self.storage_azure_account_url

    @property
    def jwks_url(self) -> str | None:
        if self.auth_jwks_url:
            return self.auth_jwks_url
        return f"{self.auth_issuer}.well-known/jwks.json" if self.auth_issuer else None

    @field_validator(
        "auth_issuer", "auth_jwks_url", "auth_web_client_id", "auth_connection", "storage_azure_account_url",
        "asset_azure_account_url", "ai_kek_vault_key_url", "ai_kek",
        "mixpanel_token", "mixpanel_api_host", "public_url", "share_url", "auth0_mgmt_domain", "auth0_mgmt_client_id", "auth0_mgmt_client_secret",
        "selfhost_token", mode="before",
    )
    @classmethod
    def _blank_is_unset(cls, v: object) -> object:
        return None if isinstance(v, str) and not v.strip() else v

    @field_validator("auth_issuer")
    @classmethod
    def _trailing_slash(cls, v: str | None) -> str | None:
        """Auth0's `iss` ends in "/", and the check is exact: one slash, whatever was set."""
        return v.strip().rstrip("/") + "/" if v else v

    @model_validator(mode="after")
    def _selfhost_defaults(self) -> "Settings":
        """A self-hosted server has no sign-in provider to mock, sends no usage events unless
        asked to, and keeps a quota sized for one person's own disk (100 GiB) — each only
        where the setting was left out."""
        if not self.selfhost:
            return self
        if self.auth_mock:
            raise ValueError("WYSEBEE_AUTH_MOCK is for the hosted edition's local development, not WYSEBEE_EDITION=selfhost.")
        if "events_enabled" not in self.model_fields_set:
            self.events_enabled = False
        if "storage_quota_bytes" not in self.model_fields_set:
            self.storage_quota_bytes = 100 * 1024**3
        return self

    @field_validator("share_url")
    @classmethod
    def _share_url_is_an_origin(cls, v: str | None) -> str | None:
        """Only a scheme and a host (and port): ``https://wysebee.io``."""
        from urllib.parse import urlsplit

        if v is None:
            return v
        parts = urlsplit(v.strip())
        if parts.scheme not in ("http", "https") or not parts.hostname or parts.path.strip("/") or parts.query or parts.fragment:
            raise ValueError("WYSEBEE_SHARE_URL is an origin only, such as https://wysebee.io.")
        return f"{parts.scheme}://{parts.netloc}".lower()

    @model_validator(mode="after")
    def _share_url_is_apart(self) -> "Settings":
        """Shared pages on this site's own host would not be apart at all."""
        from urllib.parse import urlsplit

        if self.share_url and self.public_url and urlsplit(self.share_url).netloc == urlsplit(self.public_url).netloc.lower():
            raise ValueError("WYSEBEE_SHARE_URL must be a host of its own, not WYSEBEE_PUBLIC_URL's.")
        return self

    @model_validator(mode="after")
    def _mock_sign_in_is_local(self) -> "Settings":
        """The mock issuer defaults to this app on localhost, and refuses anywhere else:
        it signs in anyone, so it must never answer for a deployment."""
        if not self.auth_mock:
            if self.assistant_mcp_local_user:
                raise ValueError("WYSEBEE_ASSISTANT_MCP_LOCAL_USER is for local development: it needs WYSEBEE_AUTH_MOCK.")
            return self
        from urllib.parse import urlsplit

        self.auth_issuer = self.auth_issuer or f"http://localhost:{self.port}/mock-auth/"
        if urlsplit(self.auth_issuer).hostname not in ("localhost", "127.0.0.1"):
            raise ValueError(f"WYSEBEE_AUTH_MOCK needs a localhost WYSEBEE_AUTH_ISSUER, not {self.auth_issuer!r}")
        self.auth_web_client_id = self.auth_web_client_id or "wysebee-web-local"
        self.auth_jwks_url = None
        return self

    @field_validator("database_url")
    @classmethod
    def _use_psycopg(cls, v: str) -> str:
        for prefix in ("postgres://", "postgresql://"):
            if v.startswith(prefix):
                return "postgresql+psycopg://" + v[len(prefix):]
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()
