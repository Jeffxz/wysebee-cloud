"""Deleting a person's account for good, as Google Play asks of apps with accounts.

``DELETE /v1/account`` is the person's own, from inside an app; for someone who asked by email,
``python -m apps.cloud.account_deletion <sub>`` does the same (``python -m apps.cloud.users list``
finds the ``sub``). In order, so that a failure can simply be tried again:

1. **Refused** while it could not finish (503): without Auth0 Management API credentials.
2. **What each extension holds** (apps/cloud/extensions.py, ``before_account_delete``) — for
   the hosted service, their billing stopped, so that nobody is charged for an account that is
   gone. An extension may refuse (its status, code and sentence), and nothing is deleted.
3. **Their files** in the asset, skill file, workspace and recording stores, while the rows still name them.
4. **Every row with their ``user_id``** in one transaction: any table of this server's with that
   column goes, a new one included. Their usage events go with it, and the ones sent before they
   signed in from a browser they later signed in on (the same ``anonymous_id``, 2026-11-15).
   Each extension's ``on_account_erase`` runs in the same transaction, for its own tables.
5. **Their Auth0 identity** last, since nobody can sign in to try again after it. Deleting one
   already gone counts as done.

Not reached from here: the copy of their usage events in Mixpanel, and what a paired device keeps locally.
"""

import asyncio
import logging
import sys
from collections.abc import Sequence
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud.auth import User, current_user
from apps.cloud.config import Settings
from apps.cloud.db import Base
from apps.cloud.deps import get_session
from apps.cloud.extensions import Extension, Refusal
from apps.cloud.models import BrowserRecording, CloudAsset, CloudSkillFile, UsageEvent, UserWorkspace

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Account"])

def tables_to_erase() -> list[Any]:
    return [t for t in reversed(Base.metadata.sorted_tables) if "user_id" in t.c]


def can_delete_identities(settings: Settings) -> bool:
    """Whether an account's Auth0 identity can be deleted too. The mock provider has none to delete."""
    return settings.auth_mock or bool(settings.auth0_mgmt_domain and settings.auth0_mgmt_client_id and settings.auth0_mgmt_client_secret)


async def erase(session: AsyncSession, sub: str, assets: Any, skill_files: Any, workspaces: Any, recordings: Any = None, extensions: Sequence[Extension] = ()) -> None:
    """Their files, then their rows. Run again after a failure, it finishes the job."""
    if recordings is not None:
        for recording_id in (await session.scalars(select(BrowserRecording.id).where(BrowserRecording.user_id == sub))).all():
            await recordings.delete(sub, recording_id)
    for asset_id in (await session.scalars(select(CloudAsset.asset_id).where(CloudAsset.user_id == sub))).all():
        await assets.delete(sub, asset_id)
    for file_id in (await session.scalars(select(CloudSkillFile.file_id).where(CloudSkillFile.user_id == sub))).all():
        await skill_files.delete(sub, file_id)
    for workspace in (await session.scalars(select(UserWorkspace).where(UserWorkspace.user_id == sub))).all():
        await workspaces.delete_prefix(sub, workspace.workspace_id)
    # Their usage events from before they signed in, by the browser ids they later signed in with.
    theirs = select(UsageEvent.anonymous_id).where(UsageEvent.user_id == sub, UsageEvent.anonymous_id.is_not(None)).distinct()
    await session.execute(delete(UsageEvent).where(UsageEvent.user_id.is_(None), UsageEvent.anonymous_id.in_(theirs)))
    for table in tables_to_erase():
        await session.execute(delete(table).where(table.c.user_id == sub))
    for ext in extensions:
        if ext.on_account_erase is not None:
            await ext.on_account_erase(session, sub)
    await session.commit()


async def before_delete(state: Any, session: AsyncSession, sub: str, extensions: Sequence[Extension]) -> Refusal | None:
    """Each extension's own first step; the first refusal stops the deletion."""
    for ext in extensions:
        if ext.before_account_delete is not None:
            refusal = await ext.before_account_delete(state, session, sub)
            if refusal is not None:
                return refusal
    return None


async def delete_identity(settings: Settings, sub: str, client: httpx.AsyncClient | None = None) -> None:
    """Delete the Auth0 user. ``auth0_mgmt_domain`` is the tenant's own domain, as the Management
    API names its audience by it even when sign-in uses a custom domain."""
    if settings.auth_mock:
        return
    domain = settings.auth0_mgmt_domain
    http = client or httpx.AsyncClient(timeout=20)
    try:
        token = await http.post(
            f"https://{domain}/oauth/token",
            json={
                "grant_type": "client_credentials",
                "client_id": settings.auth0_mgmt_client_id,
                "client_secret": settings.auth0_mgmt_client_secret,
                "audience": f"https://{domain}/api/v2/",
            },
        )
        token.raise_for_status()
        gone = await http.delete(
            f"https://{domain}/api/v2/users/{quote(sub, safe='')}",
            headers={"Authorization": f"Bearer {token.json()['access_token']}"},
        )
        if gone.status_code != 404:
            gone.raise_for_status()
    finally:
        if client is None:
            await http.aclose()


def _refused(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


@router.delete("/account")
async def delete_account(
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, bool]:
    state = request.app.state
    settings: Settings = state.settings
    unavailable = _refused(503, "account_deletion_unavailable", "Your account cannot be deleted from here right now. Email privacy@wysebee.com and we will delete it.")
    if not can_delete_identities(settings):
        raise unavailable
    refusal = await before_delete(state, session, user.sub, state.extensions)
    if refusal is not None:
        raise _refused(refusal.status, refusal.code, refusal.detail)
    try:
        await erase(session, user.sub, state.asset_store, state.skill_file_store, state.workspace_store, state.recording_store, state.extensions)
    except Exception:
        await session.rollback()
        logger.exception("could not erase an account")
        raise _refused(502, "account_not_deleted", "Your account could not be deleted. Try again.") from None
    try:
        await delete_identity(settings, user.sub)
    except (httpx.HTTPError, KeyError, ValueError):
        # Never the exception's own words: they could carry the request.
        logger.error("an account's data was erased but its Auth0 identity was not")
        raise _refused(502, "identity_not_deleted", "Your data was deleted, but your sign-in could not be. Try again.") from None
    return {"deleted": True}


USAGE = "usage: python -m apps.cloud.account_deletion <sub>"


async def _main(argv: list[str]) -> int:  # pragma: no cover - the database and stores from the environment
    from apps.cloud.assets import make_asset_store
    from apps.cloud.browser_recordings import make_recording_store
    from apps.cloud.db import Database
    from apps.cloud.workspaces import make_workspace_store
    from apps.cloud.skill_files import make_skill_file_store

    if len(argv) != 1:
        print(USAGE, file=sys.stderr)
        return 2
    sub = argv[0]
    settings = Settings()
    if not can_delete_identities(settings):
        print("Set WYSEBEE_AUTH0_MGMT_DOMAIN, _CLIENT_ID and _CLIENT_SECRET first.", file=sys.stderr)
        return 1
    from types import SimpleNamespace

    from apps.cloud import extensions

    loaded = extensions.load(settings)
    db = Database(settings)
    stores = make_asset_store(settings), make_skill_file_store(settings), make_workspace_store(settings), make_recording_store(settings)
    try:
        async for session in db.session():
            refusal = await before_delete(SimpleNamespace(settings=settings, db=db), session, sub, loaded)
            if refusal is not None:
                print(refusal.detail, file=sys.stderr)
                return 1
            await erase(session, sub, *stores, loaded)
            await delete_identity(settings, sub)
            print("Deleted.")
            return 0
    finally:
        for store in stores:
            await store.aclose()
        await db.dispose()
    return 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(asyncio.run(_main(sys.argv[1:])))
