"""Where browser recordings are kept: a narrow interface and two implementations.

A recording (apps/cloud/browser_recordings.py) is one scenario video the Wysebee Agent
extension filmed, a WebM of up to ``WYSEBEE_RECORDING_MAX_BYTES`` (500 MiB by default) — far
too big to hold in memory as assets are (apps/cloud/asset_storage.py), so it is **streamed**
both ways: written as it arrives, read a piece at a time (and from any byte, for a player
that seeks). It is named ``<sub>/<recording id>.webm``: the person's user id (checked by
:func:`apps.cloud.asset_storage.user_folder`), then the recording's id, 32 lowercase hex
characters. It is either whole or absent:

- :class:`FileRecordingStore` writes it to a temporary name in its folder and renames it
  into place (local runs, tests);
- :class:`AzureBlobRecordingStore` stages it as blocks of a block blob and commits them at
  the end — a reader sees the whole blob or none (uncommitted blocks are dropped by Azure).

A write longer than its limit stops at once (:class:`TooLarge`) and leaves nothing behind.
"""

import os
import re
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, Protocol

import anyio
from azure.core.exceptions import ResourceNotFoundError
from azure.storage.blob import BlobBlock, ContentSettings
from azure.storage.blob.aio import ContainerClient

from apps.cloud.asset_storage import InvalidName, user_folder

RECORDING_ID_RE = re.compile(r"^[0-9a-f]{32}$")
CONTENT_TYPE = "video/webm"
# How much is read from disk, or staged to Azure, at a time.
CHUNK = 1024**2
BLOCK = 4 * 1024**2


class TooLarge(Exception):
    """The upload went past its limit; nothing was kept."""


def recording_name(sub: str, recording_id: str) -> str:
    if not isinstance(recording_id, str) or not RECORDING_ID_RE.match(recording_id):
        raise InvalidName(f"bad recording id: {recording_id!r}")
    return f"{user_folder(sub)}/{recording_id}.webm"


class RecordingStore(Protocol):
    async def write(self, sub: str, recording_id: str, chunks: AsyncIterator[bytes], limit: int) -> int:
        """Store the bytes ``chunks`` yields, at most ``limit`` of them (else
        :class:`TooLarge`, nothing kept); how many there were."""

    async def size(self, sub: str, recording_id: str) -> int | None:
        """How many bytes it is, or None when there is none."""

    def read(self, sub: str, recording_id: str, start: int, length: int) -> AsyncIterator[bytes]:
        """``length`` bytes from ``start``, a piece at a time."""

    async def delete(self, sub: str, recording_id: str) -> None:
        """Remove one. Nothing there is not an error."""

    async def aclose(self) -> None:
        """Release clients and connections (on app shutdown)."""


class FileRecordingStore:
    """Recordings as files under one directory (a local disk or a mounted volume)."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def _path(self, sub: str, recording_id: str) -> Path:
        return self.root / recording_name(sub, recording_id)

    async def write(self, sub: str, recording_id: str, chunks: AsyncIterator[bytes], limit: int) -> int:
        path = self._path(sub, recording_id)
        await anyio.to_thread.run_sync(lambda: path.parent.mkdir(parents=True, exist_ok=True))
        tmp = path.parent / f".{path.name}.{uuid.uuid4().hex}.tmp"
        total = 0
        try:
            async with await anyio.open_file(tmp, "wb") as f:
                async for chunk in chunks:
                    total += len(chunk)
                    if total > limit:
                        raise TooLarge()
                    await f.write(chunk)
                await f.flush()
                await anyio.to_thread.run_sync(os.fsync, f.wrapped.fileno())
            await anyio.to_thread.run_sync(os.replace, tmp, path)
        except BaseException:
            await anyio.to_thread.run_sync(lambda: tmp.unlink(missing_ok=True))
            raise
        return total

    async def size(self, sub: str, recording_id: str) -> int | None:
        path = self._path(sub, recording_id)

        def size() -> int | None:
            try:
                return path.stat().st_size if path.is_file() else None
            except FileNotFoundError:
                return None

        return await anyio.to_thread.run_sync(size)

    async def read(self, sub: str, recording_id: str, start: int, length: int) -> AsyncIterator[bytes]:
        path = self._path(sub, recording_id)
        async with await anyio.open_file(path, "rb") as f:
            await f.seek(start)
            left = length
            while left > 0:
                piece = await f.read(min(CHUNK, left))
                if not piece:
                    return
                left -= len(piece)
                yield piece

    async def delete(self, sub: str, recording_id: str) -> None:
        path = self._path(sub, recording_id)
        await anyio.to_thread.run_sync(lambda: path.unlink(missing_ok=True))

    async def aclose(self) -> None:
        pass


class AzureBlobRecordingStore:  # pragma: no cover - needs Azure
    """Recordings as block blobs in one Azure Blob Storage container."""

    def __init__(self, container: ContainerClient, *, owned: tuple[Any, ...] = ()) -> None:
        self.container = container
        self._owned = owned

    @classmethod
    def from_account_url(cls, account_url: str, container_name: str) -> "AzureBlobRecordingStore":
        """Signed in as the app's identity (DefaultAzureCredential), as the asset store is."""
        from azure.identity.aio import DefaultAzureCredential
        from azure.storage.blob.aio import BlobServiceClient

        credential = DefaultAzureCredential()
        service = BlobServiceClient(account_url, credential=credential)
        return cls(service.get_container_client(container_name), owned=(service, credential))

    async def write(self, sub: str, recording_id: str, chunks: AsyncIterator[bytes], limit: int) -> int:
        blob = self.container.get_blob_client(recording_name(sub, recording_id))
        blocks: list[BlobBlock] = []
        buffer = bytearray()
        total = 0

        async def stage() -> None:
            block_id = f"{len(blocks):08d}"
            await blob.stage_block(block_id, bytes(buffer), length=len(buffer))
            blocks.append(BlobBlock(block_id=block_id))
            buffer.clear()

        async for chunk in chunks:
            total += len(chunk)
            if total > limit:
                raise TooLarge()  # the staged blocks are never committed: Azure drops them
            buffer += chunk
            if len(buffer) >= BLOCK:
                await stage()
        if buffer or not blocks:
            await stage()
        await blob.commit_block_list(blocks, content_settings=ContentSettings(content_type=CONTENT_TYPE))
        return total

    async def size(self, sub: str, recording_id: str) -> int | None:
        try:
            props = await self.container.get_blob_client(recording_name(sub, recording_id)).get_blob_properties()
        except ResourceNotFoundError:
            return None
        return int(props.size)

    async def read(self, sub: str, recording_id: str, start: int, length: int) -> AsyncIterator[bytes]:
        if length <= 0:
            return
        blob = self.container.get_blob_client(recording_name(sub, recording_id))
        download = await blob.download_blob(offset=start, length=length)
        async for piece in download.chunks():
            yield piece

    async def delete(self, sub: str, recording_id: str) -> None:
        try:
            await self.container.get_blob_client(recording_name(sub, recording_id)).delete_blob()
        except ResourceNotFoundError:
            pass

    async def aclose(self) -> None:
        await self.container.close()
        for client in self._owned:
            await client.close()
