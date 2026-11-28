"""Pages run the person's tools: ``wysebee.callTool`` (2026-11-28, the person's call; migration 0086).

A page (apps/cloud/workspace_pages.py) is sandboxed with no network, so it cannot reach Wysebee
itself. Shown **in Wysebee, to its owner**, it is served with :data:`BRIDGE_SCRIPT`, which gives
it ``wysebee.callTool(agent, tool, args)``: a message to the web app framing it
(ui/app/src/components/PageFrame.tsx), which alone calls ``POST /pages/{id}/tool-calls`` with the
person's sign-in and posts the result back. At its public address (``/s/<key>``) a page gets
:data:`STUB_SCRIPT` instead: every call refused, since nobody's tools run for a visitor.

**The person approves**: a tool the page has no grant for is answered 403 ``{code:
"needs_approval", agent, tool, reads}``; the web app asks the person and calls again with
``allow`` — ``"once"``, or ``"always"``, kept as a :class:`~apps.cloud.models.PageToolGrant`.
A tool that only reads is allowed for good; one that can change something only for the page as
it is (its ``view_key``): written again, the page asks again. The call names the ``view_key`` of
the page it came from, so an old copy still open cannot use a grant made for a new one.

The tool runs as the AI app's ``call_agent_read_tool`` / ``call_agent_tool`` would
(apps/cloud/agent_mcp.py :func:`~apps.cloud.agent_mcp.run_tool`): the agent on for AI apps, the
tool offered, a read-only one run read-only, one credit when it answers. At most
:data:`RATE_PER_MINUTE` calls a page a minute (per replica), so a page in a loop cannot spend
the person's credits. Pictures for the person alone (a Mac folder's) are not passed to the page.

- ``POST /pages/{page_id}/tool-calls`` ``{agent, tool, arguments, view_key, allow?}`` →
  ``{text, images, is_error}``; 403 ``needs_approval``; 409 when ``view_key`` is not the page's;
  429 past the rate.
- ``GET /pages/{page_id}/tool-grants`` → ``{grants: [{agent, tool, reads, current}]}``.
- ``DELETE /pages/{page_id}/tool-grants/{agent}/{tool}`` → 204.
"""

import hmac
import logging
import time
from collections import defaultdict, deque
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud.auth import User, current_user
from apps.cloud.deps import get_session
from apps.cloud.extensions import require_access
from apps.cloud.models import PageToolGrant, WorkspacePage

logger = logging.getLogger("wysebee.cloud.page_tools")

router = APIRouter(prefix="/v1", tags=["Workspaces"])

RATE_PER_MINUTE = 30
ALLOW = ("once", "always")
_calls: dict[str, deque[float]] = defaultdict(deque)

# Added to a page shown to its owner (before </head>, as the theme script is): wysebee.callTool.
BRIDGE_SCRIPT = """<script>(function(){var n=0,waiting={};
addEventListener("message",function(e){var d=e.data;if(e.source!==parent||!d||d.wysebee!=="result"||!waiting[d.id])return;
var w=waiting[d.id];delete waiting[d.id];if(d.error)w[1](new Error(d.error));else w[0]({text:d.text,images:d.images||[],isError:!!d.isError});});
window.wysebee={callTool:function(agent,tool,args){return new Promise(function(ok,no){var id=++n;waiting[id]=[ok,no];
parent.postMessage({wysebee:"call",id:id,agent:String(agent).replace(/^@/,""),tool:String(tool),arguments:args||{}},"*");});}};
})();</script>"""
# At a page's public address: the same name, every call refused.
STUB_SCRIPT = """<script>window.wysebee={callTool:function(){return Promise.reject(new Error("This page's tools run only in Wysebee, for its owner."));}};</script>"""


def with_script(html: bytes, script: str) -> bytes:
    """The page with ``script`` before its ``</head>``, else at its start."""
    at = html.lower().find(b"</head>")
    return html[:at] + script.encode() + html[at:] if at >= 0 else script.encode() + html


class ToolCall(BaseModel):
    agent: str
    tool: str
    arguments: dict[str, Any] = {}
    view_key: str
    allow: str | None = None


async def _mine(session: AsyncSession, user: User, page_id: str) -> WorkspacePage:
    from apps.cloud.workspace_pages import _mine as mine

    return await mine(session, user, page_id)


def _too_many(page_id: str) -> bool:
    now, calls = time.monotonic(), _calls[page_id]
    while calls and now - calls[0] > 60:
        calls.popleft()
    if len(calls) >= RATE_PER_MINUTE:
        return True
    calls.append(now)
    return False


def _holds(grant: PageToolGrant | None, reads: bool, page: WorkspacePage) -> bool:
    """A grant that covers this call: for a tool that changes something, made for this page as it is."""
    if grant is None or grant.reads != reads:
        return False
    return reads or grant.view_key == page.view_key


@router.post("/pages/{page_id}/tool-calls", dependencies=[Depends(require_access)])
async def call_tool(page_id: str, body: ToolCall, request: Request, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> Any:
    from apps.cloud import agent_mcp

    page = await _mine(session, user, page_id)
    if not hmac.compare_digest(page.view_key.encode(), body.view_key.encode()):
        raise HTTPException(status_code=409, detail="The page has changed since it was opened: reload it.")
    if body.allow is not None and body.allow not in ALLOW:
        raise HTTPException(status_code=422, detail="'allow' is \"once\" or \"always\".")
    agent, tool = body.agent.strip().removeprefix("@"), body.tool.strip()
    if not agent or not tool or len(agent) > 100 or len(tool) > 200:
        raise HTTPException(status_code=422, detail="Name the agent and its tool.")
    served = await agent_mcp.find_tool(request, user.sub, agent, tool)
    if isinstance(served, str):
        return {"text": served, "images": [], "is_error": True}
    reads = not served.box.writes(tool, body.arguments)
    grant = await session.get(PageToolGrant, (page.page_id, served.name, tool))
    if not _holds(grant, reads, page):
        if body.allow is None:
            return JSONResponse(status_code=403, content={
                "detail": "The person has not allowed this page to run this tool.", "code": "needs_approval",
                "agent": served.name, "tool": tool, "reads": reads,
            })
        if body.allow == "always":
            if grant is None:
                grant = PageToolGrant(page_id=page.page_id, agent=served.name, tool=tool, reads=reads)
                session.add(grant)
            grant.reads, grant.view_key = reads, None if reads else page.view_key
        logger.info("page_tool_allowed allow=%s reads=%s", body.allow, reads)
    await session.commit()
    # Counted once allowed: a call the person declines spends nothing.
    if _too_many(page.page_id):
        raise HTTPException(status_code=429, detail=f"A page runs at most {RATE_PER_MINUTE} tools a minute: wait a moment.")
    await session.close()
    out = await agent_mcp.run_tool(request, user.sub, served, tool, body.arguments, read_only=reads)
    images = [{"media_type": i["media_type"], "data": i["data"]} for i in out.images if isinstance(i, dict) and i.get("data") and i.get("media_type")]
    return {"text": out.text, "images": images, "is_error": out.is_error}


@router.get("/pages/{page_id}/tool-grants", dependencies=[Depends(require_access)])
async def list_grants(page_id: str, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """What the page may run without asking: ``current`` false for a tool that changes something,
    allowed for the page before it was written again (it will ask again)."""
    page = await _mine(session, user, page_id)
    rows = (await session.scalars(select(PageToolGrant).where(PageToolGrant.page_id == page.page_id).order_by(PageToolGrant.agent, PageToolGrant.tool))).all()
    return {"grants": [{"agent": g.agent, "tool": g.tool, "reads": g.reads, "current": _holds(g, g.reads, page)} for g in rows]}


@router.delete("/pages/{page_id}/tool-grants/{agent}/{tool}", status_code=204, dependencies=[Depends(require_access)])
async def revoke(page_id: str, agent: str, tool: str, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> Response:
    page = await _mine(session, user, page_id)
    await session.execute(delete(PageToolGrant).where(PageToolGrant.page_id == page.page_id, PageToolGrant.agent == agent, PageToolGrant.tool == tool))
    await session.commit()
    return Response(status_code=204)
