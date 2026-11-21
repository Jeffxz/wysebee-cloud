"""A skill edited as a folder (2026-11-17): the website's Skills page — a tree of its files and
an editor, as Workspaces (apps/cloud/workspaces.py) — and Wysebee Assistant's skill tools
(apps/cloud/workspace_assistant.py) read and write a skill's files one at a time.

A skill is still kept as before (apps/cloud/skills.py): its row lists ``files`` (``[{path, id,
size}]``), each one's bytes in the person's skill file store (apps/cloud/skill_files.py,
content-addressed), so a paired Mac reads it as it did. A folder the person made that holds no
file yet is in ``folders`` (migration 0067); a folder with files is in their paths.

**``SKILL.md`` is the skill's card**: saved, it is read as Wysebee Agent for Mac reads it
(apps/cloud/skill_manifest.py) — what cannot be read is a 422 saying why — and its front
matter's ``description`` becomes the skill's. Its ``name`` is the skill's: written there on
every save, and again when the skill is renamed. It cannot be deleted.

The routes (the skill's owner only; another person's skill is a 404):

- ``GET /skills/{id}/files/{path}`` — ``{path, content, size}``: a file that is not UTF-8
  text is a 422 (download it by its id, ``GET /skill-files/{id}``).
- ``PUT /skills/{id}/files/{path}`` — ``{content}`` as JSON, or the file's bytes (an upload,
  any other ``Content-Type``) — writes it, its folders made with it: the skill. At most
  ``skill_file_max_bytes`` (413) and :data:`~apps.cloud.skills.MAX_FILES` files; a name that
  looks like it holds a secret is refused, as the Mac refuses it.
- ``DELETE /skills/{id}/files/{path}`` — 204; its folder stays.
- ``POST /skills/{id}/folders/{path}`` — 201 the skill; ``DELETE`` — 204, with all it holds.

A path is ``/``-separated inside the skill, with no ``..``, ``.`` or empty part (the Mac's
rule); no two files may differ only in case, and no file may be where a folder is. Every
change wakes the polls of the Macs whose agents have the skill, and drops the stored files
no skill of the person's has any more.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud import changes, skill_manifest
from apps.cloud.asset_storage import AssetStore
from apps.cloud.auth import User, current_user
from apps.cloud.config import Settings
from apps.cloud.deps import get_session
from apps.cloud.models import UserSkill
from apps.cloud.people import stamp
from apps.cloud.skill_files import _read_body, keep

router = APIRouter(prefix="/v1", tags=["Skills"])

SKILL_FILE = "SKILL.md"
STARTER = "Write here what to do, step by step, when this skill is used."


class FileBody(BaseModel):
    content: str


def _paths(row: UserSkill) -> list[str]:
    return [f["path"] for f in row.files or [] if isinstance(f, dict)]


def clean(raw: str) -> str:
    """A path inside the skill (slashes around it trimmed), or a 422."""
    from apps.cloud import skills

    path = raw.strip().strip("/")
    wrong = skills._path_problem(path)
    if wrong:
        raise HTTPException(status_code=422, detail=wrong)
    return path


def _clash(paths: list[str], folders: list[str]) -> str | None:
    """Two files equal but for case, or a file where a folder is: what is wrong, or None."""
    seen: set[str] = set()
    for p in paths:
        if p.lower() in seen:
            return f"Two files are at '{p}'."
        seen.add(p.lower())
    for p in [*paths, *(f + "/x" for f in folders)]:
        parts = p.lower().split("/")
        for i in range(1, len(parts)):
            if "/".join(parts[:i]) in seen:
                return f"'{'/'.join(p.split('/')[:i])}' is a file, and also a folder."
    return None


def _read_skill_md(row: UserSkill, data: bytes) -> tuple[bytes, str]:
    """SKILL.md as it is kept — its ``name`` the skill's — and its description, or a 422."""
    try:
        text = data.decode("utf-8")
        manifest = skill_manifest.parse(skill_manifest.with_name(text, row.name), row.name)
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"{SKILL_FILE} is text.") from exc
    except skill_manifest.Unreadable as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return skill_manifest.with_name(text, row.name).encode("utf-8"), manifest.description


async def _changed(session: AsyncSession, row: UserSkill, by: str) -> None:
    """Stamp the change, wake the Macs that have the skill, and tell the person's open pages
    (the change feed) — a file the AI app saved shows in their Skills tree."""
    from apps.cloud import browser_links

    row.updated_at = func.now()
    stamp(row, by)
    await browser_links.wake_for_skill(session, row.user_id, row.skill_id)
    await changes.bump(session, row.user_id)


async def put_file(session: AsyncSession, settings: Settings, store: AssetStore, row: UserSkill, path: str, data: bytes, by: str) -> set[str]:
    """Write one file of the skill, in the caller's transaction (they commit): the stored
    files it no longer has (for :func:`~apps.cloud.skills._forget_files`)."""
    from apps.cloud import skills

    if len(data) > settings.skill_file_max_bytes:
        raise HTTPException(status_code=413, detail=f"A skill file is at most {settings.skill_file_max_bytes} bytes.")
    if path == SKILL_FILE:
        data, description = _read_skill_md(row, data)
        row.description = description
    elif skill_manifest.is_secret(path):
        raise HTTPException(status_code=422, detail=f"'{path}' looks like it holds a secret: such files are never kept in Wysebee Cloud.")
    files = [f for f in row.files or [] if isinstance(f, dict) and f.get("path") != path]
    if len(files) >= skills.MAX_FILES:
        raise HTTPException(status_code=422, detail=f"A skill keeps at most {skills.MAX_FILES} files in Wysebee Cloud.")
    folders = [f for f in row.folders or [] if not path.startswith(f + "/")]
    wrong = _clash([*(f["path"] for f in files), path], folders)
    if wrong:
        raise HTTPException(status_code=422, detail=wrong)
    before = {f.get("id") for f in row.files or [] if isinstance(f, dict)}
    file_id, size = await keep(session, store, settings, row.user_id, data)
    row.files = sorted([*files, {"path": path, "id": file_id, "size": size}], key=lambda f: f["path"].encode())
    row.folders = folders
    await _changed(session, row, by)
    return before - {f["id"] for f in row.files}


async def remove_file(session: AsyncSession, row: UserSkill, path: str, by: str) -> set[str]:
    """Delete one file (not SKILL.md); its folder stays. The stored files it no longer has."""
    if path == SKILL_FILE:
        raise HTTPException(status_code=422, detail=f"A skill needs its {SKILL_FILE}.")
    gone = next((f for f in row.files or [] if isinstance(f, dict) and f.get("path") == path), None)
    if gone is None:
        raise HTTPException(status_code=404, detail="There is no such file.")
    row.files = [f for f in row.files if f is not gone]
    parent = path.rsplit("/", 1)[0] if "/" in path else ""
    if parent and not any(p.startswith(parent + "/") for p in _paths(row)):
        row.folders = sorted({*(row.folders or []), parent})
    await _changed(session, row, by)
    return {gone["id"]} - {f["id"] for f in row.files}


async def add_folder(session: AsyncSession, row: UserSkill, path: str, by: str) -> None:
    """Make a folder (nothing when it is there already)."""
    if any(p.startswith(path + "/") for p in _paths(row)) or path in (row.folders or []):
        return
    wrong = _clash(_paths(row), [path])
    if wrong:
        raise HTTPException(status_code=422, detail=wrong)
    row.folders = sorted({f for f in row.folders or [] if not path.startswith(f + "/")} | {path})
    await _changed(session, row, by)


async def remove_folder(session: AsyncSession, row: UserSkill, path: str, by: str) -> set[str]:
    """Delete a folder and all it holds. The stored files it no longer has."""
    inside = [f for f in row.files or [] if isinstance(f, dict) and f["path"].startswith(path + "/")]
    held = [f for f in row.folders or [] if f == path or f.startswith(path + "/")]
    if not inside and not held:
        raise HTTPException(status_code=404, detail="There is no such folder.")
    row.files = [f for f in row.files if f not in inside]
    row.folders = [f for f in row.folders or [] if f not in held]
    parent = path.rsplit("/", 1)[0] if "/" in path else ""
    if parent and not any(p.startswith(parent + "/") for p in _paths(row)):
        row.folders = sorted({*row.folders, parent})
    await _changed(session, row, by)
    return {f["id"] for f in inside} - {f["id"] for f in row.files}


async def create(
    session: AsyncSession, settings: Settings, store: AssetStore, user_id: str, name: str, description: str, instructions: str, by: str,
) -> UserSkill:
    """A new skill of the person's — its SKILL.md from ``description`` and ``instructions`` —
    in the caller's transaction (they commit). The name is checked by the caller."""
    import uuid

    row = UserSkill(skill_id=str(uuid.uuid4()), user_id=user_id, name=name, description="", files=[], folders=[])
    stamp(row, by, made=True)
    session.add(row)
    try:
        await session.flush()
    except IntegrityError as exc:
        # The name index caught a clash the caller's check could not see: a 409, never a 500.
        await session.rollback()
        raise HTTPException(status_code=409, detail=f"There is already a skill named '{name}'.") from exc
    source = skill_manifest.render(name, description, instructions or f"# {name}\n\n{STARTER}")
    await put_file(session, settings, store, row, SKILL_FILE, source.encode("utf-8"), by)
    return row


async def rename(session: AsyncSession, settings: Settings, store: AssetStore, row: UserSkill, name: str, by: str) -> set[str]:
    """Rename the skill, and its SKILL.md's ``name`` with it. The stored files it no longer has."""
    row.name = name
    try:
        await session.flush()
    except IntegrityError as exc:
        # The name index caught a clash the caller's check could not see: a 409, never a 500.
        await session.rollback()
        raise HTTPException(status_code=409, detail=f"There is already a skill named '{name}'.") from exc
    kept = next((f["id"] for f in row.files or [] if isinstance(f, dict) and f.get("path") == SKILL_FILE), None)
    data = await store.read(row.user_id, kept) if kept else None
    if data is None:
        await _changed(session, row, by)
        return set()
    return await put_file(session, settings, store, row, SKILL_FILE, data, by)


async def read_text(store: AssetStore, row: UserSkill, path: str) -> str:
    """A file's text, or a 404 (none) or 422 (not text)."""
    found = next((f for f in row.files or [] if isinstance(f, dict) and f.get("path") == path), None)
    data = await store.read(row.user_id, found["id"]) if found else None
    if data is None:
        raise HTTPException(status_code=404, detail="There is no such file.")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"'{path}' is not text: download it instead.") from exc


# --- routes -------------------------------------------------------------------------------


def _deps(request: Request) -> tuple[Settings, AssetStore]:
    return request.app.state.settings, request.app.state.skill_file_store


async def _answer(session: AsyncSession, request: Request, user: User, row: UserSkill, dropped: set[str]) -> Any:
    from apps.cloud import skills

    await skills._commit(session, row.name)
    await session.refresh(row)
    out = await skills._one(session, row)
    await skills._forget_files(session, request.app.state.skill_file_store, user.sub, dropped)
    return out


@router.get("/skills/{skill_id}/files/{file_path:path}")
async def get_file(skill_id: str, file_path: str, request: Request, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    from apps.cloud import skills

    row = await skills._mine(session, user, skill_id)
    path = clean(file_path)
    content = await read_text(request.app.state.skill_file_store, row, path)
    return {"path": path, "content": content, "size": len(content.encode("utf-8"))}


@router.put("/skills/{skill_id}/files/{file_path:path}")
async def put_skill_file(skill_id: str, file_path: str, request: Request, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> Any:
    from apps.cloud import skills

    settings, store = _deps(request)
    row = await skills._mine(session, user, skill_id)
    path = clean(file_path)
    if request.headers.get("content-type", "").startswith("application/json"):
        try:
            data = FileBody.model_validate_json(await request.body()).content.encode("utf-8")
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Send the file as {\"content\": text}, or its bytes.") from exc
    else:
        data = await _read_body(request, settings.skill_file_max_bytes)
    dropped = await put_file(session, settings, store, row, path, data, user.sub)
    return await _answer(session, request, user, row, dropped)


@router.delete("/skills/{skill_id}/files/{file_path:path}", status_code=204)
async def delete_skill_file(skill_id: str, file_path: str, request: Request, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> Response:
    from apps.cloud import skills

    row = await skills._mine(session, user, skill_id)
    dropped = await remove_file(session, row, clean(file_path), user.sub)
    await _answer(session, request, user, row, dropped)
    return Response(status_code=204)


@router.post("/skills/{skill_id}/folders/{folder_path:path}", status_code=201)
async def make_skill_folder(skill_id: str, folder_path: str, request: Request, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> Any:
    from apps.cloud import skills

    row = await skills._mine(session, user, skill_id)
    await add_folder(session, row, clean(folder_path), user.sub)
    return await _answer(session, request, user, row, set())


@router.delete("/skills/{skill_id}/folders/{folder_path:path}", status_code=204)
async def delete_skill_folder(skill_id: str, folder_path: str, request: Request, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> Response:
    from apps.cloud import skills

    row = await skills._mine(session, user, skill_id)
    dropped = await remove_folder(session, row, clean(folder_path), user.sub)
    await _answer(session, request, user, row, dropped)
    return Response(status_code=204)
