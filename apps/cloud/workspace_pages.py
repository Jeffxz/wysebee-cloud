"""Pages: rich HTML made from a workspace document by the person's AI app (2026-11-17, the
person's call; migration 0077).

Wysebee Assistant's ``write_page`` (apps/cloud/workspace_assistant.py) takes a whole,
self-contained HTML page for **the document open in the person's editor** and keeps it — one
page per document, its id the same each time the AI app writes it again — in the workspace's
hidden ``.pages`` folder in the workspace store (``<user>/<workspace id>/.pages/<page id>.html``,
apps/cloud/workspace_storage.py), with a :class:`~apps.cloud.models.WorkspacePage` saying which
document it is of. The folder is not one of the workspace's files: its tree and file count
leave it out (apps/cloud/workspaces.py), and deleting a document deletes its page.

A page is **what the AI app wrote, so it is shown sandboxed**. It is served from its own
address, ``GET /page-view/{page_id}/{view_key}`` — the key random and new each time it is
written, so the address is the permission (an iframe cannot carry the sign-in) — under its own
Content-Security-Policy, :data:`VIEW_CSP`: ``sandbox allow-scripts`` gives it no origin (not
Wysebee's, whose pages and sign-in it cannot reach), and it may run only its own inline styles
and scripts and reach no network — no fetch, no images or fonts from elsewhere, no forms, no
frames — so it cannot send what it shows anywhere. (Shown in ``srcdoc`` instead, it would take
the web app's own policy, which refuses inline scripts.) The website frames it with
``sandbox="allow-scripts"`` too.

**Its look follows Wysebee's** (2026-11-19, the person's call): asked for with ``?theme=dark`` or
``?theme=light``, the page is served with :data:`THEME_SCRIPT` added before ``</head>`` — the
stored page is not changed. A framed page's ``prefers-color-scheme`` is the browser's, not its
frame's, so the script turns the page's own ``@media (prefers-color-scheme: …)`` rules on or off
to match, sets ``data-theme`` and ``color-scheme`` on its ``<html>``, and takes a new look from
the window that frames it (``postMessage({wysebeeTheme})``) without reloading. With no theme the
page is served as written and follows the browser.

- ``GET /pages/{page_id}`` — ``{id, workspace_id, workspace_name, source_path, title,
  view_url, updated_at}``: the page's own address, ``#/pages/<id>`` on the website.
- ``GET /workspaces/{workspace_id}/page?path=`` — ``{page: {id, title, updated_at} | null}``:
  the document's page, if it has one (the editor's Page view).
- ``DELETE /pages/{page_id}`` — 204.

Another person's page is a 404.
"""

import hmac
import logging
import secrets
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import HTMLResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud.extensions import require_access
from apps.cloud.auth import User, current_user
from apps.cloud.deps import get_session
from apps.cloud.models import UserWorkspace, WorkspacePage
from apps.cloud.workspace_storage import WorkspaceStore

logger = logging.getLogger("wysebee.cloud.workspace_pages")

router = APIRouter(prefix="/v1", tags=["Workspaces"])

FOLDER = ".pages"
MAX_BYTES = 2_000_000
MAX_TITLE = 200
# What a page may do where it is shown: no origin of its own, its own inline styles and scripts,
# pictures, fonts and media only as data, no network, no forms or frames, framed only by Wysebee.
VIEW_CSP = "; ".join([
    "sandbox allow-scripts",
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "script-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "media-src data: blob:",
    "connect-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
])


THEMES = ("dark", "light")
# Added to a page asked for in a look (``__THEME__`` is one of THEMES, nothing else): its rules
# for the other look off, for this one on — each rule's own text kept, so it can switch back.
THEME_SCRIPT = """<script>(function(){var t="__THEME__",kept=new WeakMap();
var on="(min-resolution: 0dppx)",off="(max-resolution: 0dppx)";
function walk(rules){for(var i=0;i<rules.length;i++){var r=rules[i];
if(r.media&&r.cssRules){if(!kept.has(r))kept.set(r,r.media.mediaText);var was=kept.get(r);
if(/prefers-color-scheme/i.test(was)){var now=was.replace(/\\(\\s*prefers-color-scheme\\s*:\\s*(dark|light)\\s*\\)/gi,function(_,s){return s.toLowerCase()===t?on:off;});
if(r.media.mediaText!==now)r.media.mediaText=now;}}
if(r.cssRules)walk(r.cssRules);}}
function apply(){var h=document.documentElement;h.setAttribute("data-theme",t);h.style.colorScheme=t;
for(var i=0;i<document.styleSheets.length;i++){try{walk(document.styleSheets[i].cssRules);}catch(e){}}}
apply();document.addEventListener("DOMContentLoaded",apply);
addEventListener("message",function(e){var d=e.data;if(e.source!==parent||!d||(d.wysebeeTheme!=="dark"&&d.wysebeeTheme!=="light"))return;t=d.wysebeeTheme;apply();});
})();</script>"""


def themed(html: bytes, theme: str) -> bytes:
    """The page with :data:`THEME_SCRIPT` for ``theme`` before its ``</head>`` (its head's
    styles read by then), else at its start."""
    script = THEME_SCRIPT.replace("__THEME__", theme).encode()
    at = html.lower().find(b"</head>")
    return html[:at] + script + html[at:] if at >= 0 else script + html


def key(workspace_id: str, page_id: str) -> str:
    return f"{workspace_id}/{FOLDER}/{page_id}.html"


def is_page_path(path: str) -> bool:
    """A path in the workspace store that is a page, not one of the workspace's files."""
    return path == FOLDER or path.startswith(FOLDER + "/")


def _store(request: Request) -> WorkspaceStore:
    return request.app.state.workspace_store


async def save(session: AsyncSession, store: WorkspaceStore, sub: str, user_id: str, workspace: UserWorkspace, source_path: str, html: str, title: str) -> WorkspacePage:
    """The document's page, made or written again (its id kept): :class:`ValueError` saying
    what is wrong with it. Commits."""
    data = html.encode("utf-8")
    if not html.strip():
        raise ValueError("Give the page's whole HTML as 'html'.")
    if len(data) > MAX_BYTES:
        raise ValueError(f"A page is at most {MAX_BYTES} bytes: keep it to this document, with no pictures inlined that it does not need.")
    title = " ".join(title.split())[:MAX_TITLE]
    page = await session.scalar(select(WorkspacePage).where(WorkspacePage.workspace_id == workspace.workspace_id, WorkspacePage.source_path == source_path))
    # A new key each write: an address shown before stops working.
    key_now = secrets.token_urlsafe(24)
    if page is None:
        page = WorkspacePage(page_id=str(uuid.uuid4()), user_id=user_id, workspace_id=workspace.workspace_id, source_path=source_path, title=title, view_key=key_now)
        session.add(page)
    else:
        page.title, page.view_key, page.updated_at = title, key_now, func.now()
    await store.write(sub, key(workspace.workspace_id, page.page_id), data, "text/html; charset=utf-8")
    await session.commit()
    await session.refresh(page)
    logger.info("page_written bytes=%d", len(data))
    return page


async def forget(session: AsyncSession, store: WorkspaceStore, sub: str, workspace_id: str, source_path: str) -> None:
    """A document deleted: its page goes too (the caller commits)."""
    page = await session.scalar(select(WorkspacePage).where(WorkspacePage.workspace_id == workspace_id, WorkspacePage.source_path == source_path))
    if page is not None:
        await store.delete(sub, key(workspace_id, page.page_id))
        await session.delete(page)


async def _mine(session: AsyncSession, user: User, page_id: str) -> WorkspacePage:
    try:
        pid = str(uuid.UUID(page_id))
    except ValueError:
        pid = ""
    page = await session.get(WorkspacePage, pid) if pid else None
    if page is None or page.user_id != user.sub:
        raise HTTPException(status_code=404, detail="There is no such page.")
    return page


@router.get("/pages/{page_id}", dependencies=[Depends(require_access)])
async def get_page(page_id: str, request: Request, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    from apps.cloud.workspaces import _sub

    page = await _mine(session, user, page_id)
    workspace = await session.get_one(UserWorkspace, page.workspace_id)
    return {
        "id": page.page_id, "workspace_id": page.workspace_id, "workspace_name": workspace.name, "source_path": page.source_path,
        "title": page.title, "view_url": f"/api/v1/page-view/{page.page_id}/{page.view_key}", "updated_at": page.updated_at,
    }


@router.get("/page-view/{page_id}/{view_key}", include_in_schema=False)
async def view_page(
    page_id: str, view_key: str, request: Request, theme: str | None = Query(None), session: AsyncSession = Depends(get_session)
) -> Response:
    """The page itself, for the website's iframe: its address its permission, under
    :data:`VIEW_CSP` — in Wysebee's look when ``theme`` names one (:func:`themed`)."""
    from apps.cloud.asset_storage import user_folder

    try:
        pid = str(uuid.UUID(page_id))
    except ValueError:
        pid = ""
    page = await session.get(WorkspacePage, pid) if pid else None
    if page is None or not hmac.compare_digest(page.view_key.encode(), view_key.encode()):
        raise HTTPException(status_code=404, detail="There is no such page.")
    data = await _store(request).read(user_folder(page.user_id), key(page.workspace_id, page.page_id))
    if data is None:
        raise HTTPException(status_code=404, detail="The page's file is gone: ask your AI app to write it again.")
    if theme in THEMES:
        data = themed(data, theme)
    return HTMLResponse(data, headers={
        "Content-Security-Policy": VIEW_CSP, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store",
    })


@router.get("/workspaces/{workspace_id}/page", dependencies=[Depends(require_access)])
async def document_page(workspace_id: str, path: str = Query(...), user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    from apps.cloud.workspaces import _workspace, valid_path

    workspace = await _workspace(session, user, workspace_id)
    page = await session.scalar(select(WorkspacePage).where(WorkspacePage.workspace_id == workspace.workspace_id, WorkspacePage.source_path == valid_path(path)))
    return {"page": None if page is None else {"id": page.page_id, "title": page.title, "updated_at": page.updated_at}}


@router.delete("/pages/{page_id}", status_code=204, dependencies=[Depends(require_access)])
async def delete_page(page_id: str, request: Request, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> Response:
    from apps.cloud.workspaces import _sub

    page = await _mine(session, user, page_id)
    await _store(request).delete(_sub(user), key(page.workspace_id, page.page_id))
    await session.delete(page)
    await session.commit()
    return Response(status_code=204)
