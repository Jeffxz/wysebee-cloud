"""Where assets are kept: a narrow interface and two implementations.

An asset is a small file a person stores here (Wysebee's avatar image is the first),
named by what it is: its id is the lowercase hex SHA-256 of its bytes. One is named
``<sub>/<asset id>``: the person's user id as their token carries it (``auth0|…``,
``google-oauth2|…``), so a person's assets can be found by who they are. Both parts are
checked before a name is built from them: the id must be a hash, and the user id a single
path segment of known characters (:func:`user_folder`). An asset is either whole or
absent:

- :class:`FileAssetStore` keeps it as a file under one directory, written to a
  temporary name in the same folder and renamed into place;
- :class:`AzureBlobAssetStore` keeps it as a block blob in one container, uploaded in
  one request (assets are small), with its content type on the blob.

The whole asset is in memory on the way in and out: they are capped at
``WYSEBEE_ASSET_MAX_BYTES`` (1 MiB by default), so streaming would buy nothing.
:class:`AssetStore` is what the routes use; nothing outside this module knows which.
"""

import os
import re
import uuid
from pathlib import Path
from typing import Any, Protocol

import anyio
from azure.core.exceptions import ResourceNotFoundError
from azure.storage.blob import ContentSettings
from azure.storage.blob.aio import ContainerClient


class InvalidName(ValueError):
    """An id or a path that may not become part of a file's or a blob's name."""


ASSET_ID_RE = re.compile(r"^[0-9a-f]{64}$")
# What Auth0 user ids are made of (`<connection>|<id>`, an email for some connections):
# one path segment — no "/" or "\\", nothing hidden or relative — on any file system and as
# a blob name. Anything else is refused rather than rewritten, so a name is always the id.
USER_ID_RE = re.compile(r"^[A-Za-z0-9|@+=:_-][A-Za-z0-9|@+=:._-]{0,254}$")


def valid_asset_id(value: str) -> bool:
    return isinstance(value, str) and bool(ASSET_ID_RE.match(value))


def user_folder(sub: str) -> str:
    """The person's folder: their user id itself, or :class:`InvalidName`."""
    if not isinstance(sub, str) or not USER_ID_RE.match(sub) or ".." in sub:
        raise InvalidName(f"user id cannot name a folder: {sub!r}")
    return sub


def asset_name(sub: str, asset_id: str) -> str:
    if not valid_asset_id(asset_id):
        raise InvalidName(f"bad asset id: {asset_id!r}")
    return f"{user_folder(sub)}/{asset_id}"


class AssetStore(Protocol):
    async def write(self, sub: str, asset_id: str, data: bytes, content_type: str) -> None:
        """Store an asset's bytes, replacing any earlier copy (the same bytes, since the
        id is their hash)."""

    async def read(self, sub: str, asset_id: str) -> bytes | None:
        """The asset's bytes, or None when there are none."""

    async def delete(self, sub: str, asset_id: str) -> None:
        """Remove one asset. Nothing there is not an error."""

    async def aclose(self) -> None:
        """Release clients and connections (on app shutdown)."""


class FileAssetStore:
    """Assets as files under one directory (a local disk or a mounted volume)."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def _path(self, sub: str, asset_id: str) -> Path:
        return self.root / asset_name(sub, asset_id)

    async def write(self, sub: str, asset_id: str, data: bytes, content_type: str) -> None:
        path = self._path(sub, asset_id)

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

    async def read(self, sub: str, asset_id: str) -> bytes | None:
        path = self._path(sub, asset_id)

        def read() -> bytes | None:
            try:
                return path.read_bytes() if path.is_file() else None
            except FileNotFoundError:
                return None

        return await anyio.to_thread.run_sync(read)

    async def delete(self, sub: str, asset_id: str) -> None:
        path = self._path(sub, asset_id)
        await anyio.to_thread.run_sync(lambda: path.unlink(missing_ok=True))

    async def aclose(self) -> None:
        pass


class AzureBlobAssetStore:
    """Assets as block blobs in one Azure Blob Storage container. A single-request
    upload is atomic: a reader sees the whole blob or none."""

    def __init__(self, container: ContainerClient, *, owned: tuple[Any, ...] = ()) -> None:
        self.container = container
        # Clients this store created and closes (the service client, the credential).
        self._owned = owned

    @classmethod
    def from_account_url(cls, account_url: str, container_name: str) -> "AzureBlobAssetStore":
        """Signed in as the app's identity (DefaultAzureCredential: the managed identity
        in Container Apps, ``az login`` on a laptop) — no account key is stored."""
        from azure.identity.aio import DefaultAzureCredential
        from azure.storage.blob.aio import BlobServiceClient

        credential = DefaultAzureCredential()
        service = BlobServiceClient(account_url, credential=credential)
        return cls(service.get_container_client(container_name), owned=(service, credential))

    async def write(self, sub: str, asset_id: str, data: bytes, content_type: str) -> None:
        blob = self.container.get_blob_client(asset_name(sub, asset_id))
        await blob.upload_blob(
            data, overwrite=True, length=len(data), content_settings=ContentSettings(content_type=content_type)
        )

    async def read(self, sub: str, asset_id: str) -> bytes | None:
        blob = self.container.get_blob_client(asset_name(sub, asset_id))
        try:
            download = await blob.download_blob()
            return await download.readall()
        except ResourceNotFoundError:
            return None

    async def delete(self, sub: str, asset_id: str) -> None:
        blob = self.container.get_blob_client(asset_name(sub, asset_id))
        try:
            await blob.delete_blob()
        except ResourceNotFoundError:
            pass

    async def aclose(self) -> None:
        await self.container.close()
        for client in self._owned:
            await client.close()
