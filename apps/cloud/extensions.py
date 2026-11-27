"""**Extensions**: what a deployment adds to Wysebee Cloud without it being in this repository —
the hosted service's plans and payments are one (a private package). An extension is a Python
module named in ``WYSEBEE_EXTENSIONS`` (comma-separated) whose ``register(settings)`` returns an
:class:`Extension`; :func:`load` imports them when the app is made (apps/cloud/main.py). None
named, the server is as this repository has it: everything allowed, no limits.

What an extension may give:

- **a policy** (:class:`Policy`) — what a person may do, asked where it matters: every route of
  theirs but their account (:func:`require_access`, on the routers in apps/cloud/main.py),
  Wysebee Assistant's tools (apps/cloud/agent_mcp.py), a scheduled task's run
  (apps/cloud/task_runner.py), pairing a device and each call to one
  (apps/cloud/browser_links.py), sharing a page publicly (apps/cloud/workspace_pages.py) and
  their storage quota (apps/cloud/storage.py). A refusal is
  a :class:`Refusal` — status, code and sentence — that the person or their AI app is told as
  it is. The last extension with a policy decides; the default (:class:`Policy` itself)
  refuses nothing.
- **routes** (``routers``), served under ``/api``;
- **migrations** (``migrations``): its own Alembic folder, whose ``env.py`` keeps its own
  version table, run after this repository's (:func:`migrate`, scripts/start.sh);
- **account deletion hooks**: ``before_account_delete`` (may refuse; e.g. stop a payment
  provider's billing first) and ``on_account_erase`` (in the erasing transaction; e.g. keep
  records without the person) — apps/cloud/account_deletion.py;
- **agent type packs** (``agent_types``): kinds of device it serves (apps/cloud/agent_packs.py,
  docs/agent-type-packs.md), checked against the built-in kinds and each other when the app is
  made;
- **web features** (``web_features``) the pages follow, through ``GET /api/v1/web/config``
  (apps/cloud/web.py): ``billing`` shows Account → Billing, read from the extension's own
  ``/api/v1/plan`` and ``/api/v1/billing``.

What the policy may read is this server's own: its models, the usage it counts — devices
(``browser_links.device_counts``), relay traffic (apps/cloud/traffic.py), tool calls
(apps/cloud/tool_calls.py) — and its settings.

**The interface is versioned** (:data:`API`): an extension says which it was built for, and one
built for another is refused when the app is made, rather than failing on a request.
"""

import importlib
import sys
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud.auth import User, current_user
from apps.cloud.deps import get_session

# The version of this interface. Bump it when a Policy method or an Extension field changes.
# 2 (2026-11-21): Extension.agent_types, the agent type packs (apps/cloud/agent_packs.py).
# 3 (2026-11-27): Policy.may_share, sharing a page publicly (apps/cloud/workspace_pages.py).
API = 3


@dataclass(frozen=True)
class Refusal:
    """Why a person may not do something: the HTTP status, a code clients may act on, the
    sentence they are told, and anything else the answer carries."""

    status: int
    code: str
    detail: str
    more: dict[str, Any] = field(default_factory=dict)


class Denied(Exception):
    """A :class:`Refusal`, raised: answered ``{"detail", "code", ...more}`` with its status."""

    def __init__(self, refusal: Refusal) -> None:
        super().__init__(refusal.detail)
        self.refusal = refusal


async def denied_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, Denied)
    r = exc.refusal
    return JSONResponse({"detail": r.detail, "code": r.code, **r.more}, status_code=r.status)


class Policy:
    """What a person may do. This one, the default, allows everything and sets no quota; an
    extension's overrides what it decides. Each is asked inside the caller's session, and need
    not touch the database when it has nothing to decide."""

    async def may_use(self, session: AsyncSession, user_id: str) -> Refusal | None:
        """Anything of theirs beyond their account: routes, Wysebee Assistant's tools, tasks."""
        return None

    async def may_pair(self, session: AsyncSession, user_id: str) -> Refusal | None:
        """Pair one more device (asked with the pairing code; the code stays good after a refusal)."""
        return None

    async def may_call(self, session: AsyncSession, user_id: str, link_id: str, now: datetime) -> Refusal | None:
        """Send one call to that device (paired, online and switched on: already checked)."""
        return None

    async def may_share(self, session: AsyncSession, user_id: str) -> Refusal | None:
        """Share a page publicly — asked when they share one, and each time a shared one of
        theirs is opened, so one shared before stops showing once they may no longer."""
        return None

    async def storage_quota(self, session: AsyncSession, user_id: str) -> int | None:
        """Their file storage quota in bytes, or None for the server's own
        (``storage_quota_bytes``, which is also the least any quota is)."""
        return None


@dataclass
class Extension:
    """What :func:`register` of an extension module returns."""

    name: str
    api: int
    policy: Policy | None = None
    routers: Sequence[APIRouter] = ()
    migrations: Path | None = None
    before_account_delete: Callable[[Any, AsyncSession, str], Awaitable[Refusal | None]] | None = None
    on_account_erase: Callable[[AsyncSession, str], Awaitable[None]] | None = None
    web_features: dict[str, bool] = field(default_factory=dict)
    agent_types: Sequence[Any] = ()


def names(settings: Any) -> list[str]:
    """The extension modules ``WYSEBEE_EXTENSIONS`` names, in order."""
    return [n.strip() for n in (settings.extensions or "").split(",") if n.strip()]


def load(settings: Any) -> list[Extension]:
    """Import and register the extensions the settings name; refuse one built for another
    version of this interface."""
    found = []
    for name in names(settings):
        ext = importlib.import_module(name).register(settings)
        if not isinstance(ext, Extension) or ext.api != API:
            raise RuntimeError(f"Extension {name!r} is not one for this server's extension API {API}: update one of them.")
        found.append(ext)
    return found


def policy_of(extensions: Sequence[Extension]) -> Policy:
    """The policy that decides: the last extension's that has one, else the default."""
    return next((e.policy for e in reversed(extensions) if e.policy is not None), Policy())


def web_features(extensions: Sequence[Extension]) -> dict[str, bool]:
    out: dict[str, bool] = {}
    for e in extensions:
        out.update(e.web_features)
    return out


async def require_access(request: Request, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> None:
    """A route's dependency: refused as the policy says (``may_use``)."""
    refusal = await request.app.state.policy.may_use(session, user.sub)
    if refusal is not None:
        raise Denied(refusal)


def migrate(settings: Any, extensions: Sequence[Extension] | None = None) -> list[str]:
    """Bring each extension's own tables up to date (after this repository's); the names of
    those that have migrations."""
    from alembic import command
    from alembic.config import Config

    done = []
    for ext in load(settings) if extensions is None else extensions:
        if ext.migrations is None:
            continue
        cfg = Config()
        cfg.set_main_option("script_location", str(ext.migrations))
        cfg.attributes["url"] = settings.database_url
        command.upgrade(cfg, "head")
        done.append(ext.name)
    return done


if __name__ == "__main__":  # pragma: no cover - the container's start (scripts/start.sh)
    # Run as a script this file is ``__main__``: its classes are not the ones extensions import
    # from apps.cloud.extensions, so the work is that module's.
    from apps.cloud import extensions as this
    from apps.cloud.config import Settings

    if sys.argv[1:] != ["migrate"]:
        print("usage: python -m apps.cloud.extensions migrate", file=sys.stderr)
        sys.exit(2)
    for name in this.migrate(Settings()):
        print(f"migrated {name}")
