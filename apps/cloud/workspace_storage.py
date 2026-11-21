"""Where workspaces' files are kept: a narrow interface and two implementations.

A workspace (apps/cloud/workspaces.py) is a folder of documentation files. Unlike assets and
skill files, which are content-addressed, a workspace's files are **named by their path**, so
the folder structure is the store's own: a file is ``<sub>/<workspace name>/<path>``, the
person's user id first (as their token carries it, checked by
:func:`apps.cloud.asset_storage.user_folder`), then the workspace's folder, then the file's
path inside it. A folder is only a prefix — Azure Blob Storage has none of its own — so an
empty folder holds an empty :data:`FOLDER_MARKER` blob.

- :class:`FileWorkspaceStore` keeps each as a file under one directory (local runs, tests);
- :class:`AzureBlobWorkspaceStore` keeps each as a block blob in one container
  (``user-workspaces`` in production).

Names are checked by the routes (:mod:`apps.cloud.workspaces`) before they reach a store; the
stores check again that nothing climbs out of the person's folder.
"""

import os
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import quote

import anyio
from azure.core.exceptions import ResourceNotFoundError
from azure.storage.blob import ContentSettings
from azure.storage.blob.aio import ContainerClient

from apps.cloud.asset_storage import user_folder
from apps.cloud.asset_storage import InvalidName

# What an otherwise empty folder holds, so the folder exists in a store that has none.
FOLDER_MARKER = ".keep"


@dataclass(frozen=True)
class StoredFile:
    """One file under a prefix: its path below the prefix, size and when it was written."""

    path: str
    size: int
    updated_at: datetime


def blob_name(sub: str, key: str) -> str:
    """``<sub>/<key>``, or :class:`InvalidName` when the key could climb out."""
    parts = key.split("/")
    if not key or any(p in ("", ".", "..") for p in parts) or "\\" in key:
        raise InvalidName(f"bad workspace path: {key!r}")
    return f"{user_folder(sub)}/{key}"


class WorkspaceStore(Protocol):
    async def write(self, sub: str, key: str, data: bytes, content_type: str) -> None:
        """Store a file's bytes at ``key`` (``<workspace>/<path>``), replacing any there."""

    async def read(self, sub: str, key: str) -> bytes | None:
        """The file's bytes, or None when there is none."""

    async def delete(self, sub: str, key: str) -> None:
        """Remove one file. Nothing there is not an error."""

    async def list(self, sub: str, prefix: str) -> list[StoredFile]:
        """Every file under ``prefix`` (``<workspace>/`` or deeper), paths relative to it."""

    async def delete_prefix(self, sub: str, prefix: str) -> None:
        """Remove every file under ``prefix``."""

    def url(self, sub: str, prefix: str) -> str:
        """Where ``prefix`` is kept, for the workspace's ``resource_url``."""

    async def aclose(self) -> None:
        """Release clients and connections (on app shutdown)."""


class FileWorkspaceStore:
    """Workspace files as files under one directory (a local disk or a mounted volume)."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def _path(self, sub: str, key: str) -> Path:
        return self.root / blob_name(sub, key)

    async def write(self, sub: str, key: str, data: bytes, content_type: str) -> None:
        path = self._path(sub, key)

        def write() -> None:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.parent / f".{path.name}.{uuid.uuid4().hex}.tmp"
            try:
                with open(tmp, "wb") as f:
                    f.write(data)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(tmp, path)
            except BaseException:
                tmp.unlink(missing_ok=True)
                raise

        await anyio.to_thread.run_sync(write)

    async def read(self, sub: str, key: str) -> bytes | None:
        path = self._path(sub, key)
        return await anyio.to_thread.run_sync(lambda: path.read_bytes() if path.is_file() else None)

    async def delete(self, sub: str, key: str) -> None:
        path = self._path(sub, key)
        await anyio.to_thread.run_sync(lambda: path.unlink(missing_ok=True))

    async def list(self, sub: str, prefix: str) -> list[StoredFile]:
        top = self._path(sub, prefix.rstrip("/"))

        def walk() -> list[StoredFile]:
            if not top.is_dir():
                return []
            found = []
            for path in sorted(top.rglob("*")):
                if path.is_file() and not path.name.endswith(".tmp"):
                    stat = path.stat()
                    found.append(StoredFile(path.relative_to(top).as_posix(), stat.st_size, datetime.fromtimestamp(stat.st_mtime, UTC)))
            return found

        return await anyio.to_thread.run_sync(walk)

    async def delete_prefix(self, sub: str, prefix: str) -> None:
        import shutil

        top = self._path(sub, prefix.rstrip("/"))
        await anyio.to_thread.run_sync(lambda: shutil.rmtree(top, ignore_errors=True))

    def url(self, sub: str, prefix: str) -> str:
        return self._path(sub, prefix.rstrip("/")).resolve().as_uri() + "/"

    async def aclose(self) -> None:
        pass


class AzureBlobWorkspaceStore:
    """Workspace files as block blobs in one Azure Blob Storage container."""

    def __init__(self, container: ContainerClient, *, owned: tuple[Any, ...] = ()) -> None:
        self.container = container
        self._owned = owned

    @classmethod
    def from_account_url(cls, account_url: str, container_name: str) -> "AzureBlobWorkspaceStore":  # pragma: no cover - needs Azure
        """Signed in as the app's identity (DefaultAzureCredential), as the asset store is."""
        from azure.identity.aio import DefaultAzureCredential
        from azure.storage.blob.aio import BlobServiceClient

        credential = DefaultAzureCredential()
        service = BlobServiceClient(account_url, credential=credential)
        return cls(service.get_container_client(container_name), owned=(service, credential))

    async def write(self, sub: str, key: str, data: bytes, content_type: str) -> None:
        blob = self.container.get_blob_client(blob_name(sub, key))
        await blob.upload_blob(data, overwrite=True, length=len(data), content_settings=ContentSettings(content_type=content_type))

    async def read(self, sub: str, key: str) -> bytes | None:
        blob = self.container.get_blob_client(blob_name(sub, key))
        try:
            download = await blob.download_blob()
            return await download.readall()
        except ResourceNotFoundError:
            return None

    async def delete(self, sub: str, key: str) -> None:
        try:
            await self.container.get_blob_client(blob_name(sub, key)).delete_blob()
        except ResourceNotFoundError:
            pass

    async def list(self, sub: str, prefix: str) -> list[StoredFile]:
        start = blob_name(sub, prefix.rstrip("/")) + "/"
        found = []
        async for blob in self.container.list_blobs(name_starts_with=start):
            found.append(StoredFile(blob.name[len(start):], int(blob.size or 0), blob.last_modified))
        return sorted(found, key=lambda f: f.path)

    async def delete_prefix(self, sub: str, prefix: str) -> None:
        start = blob_name(sub, prefix.rstrip("/")) + "/"
        async for blob in self.container.list_blobs(name_starts_with=start):
            try:
                await self.container.delete_blob(blob.name)
            except ResourceNotFoundError:
                pass

    def url(self, sub: str, prefix: str) -> str:
        return f"{self.container.url.rstrip('/')}/{quote(blob_name(sub, prefix.rstrip('/')))}/"

    async def aclose(self) -> None:
        await self.container.close()
        for client in self._owned:
            await client.close()
