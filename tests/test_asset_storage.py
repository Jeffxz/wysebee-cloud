"""The asset stores: the file store, the Azure Blob store against a fake container client
(no network) and, when WYSEBEE_TEST_AZURITE_CONNECTION_STRING is set, against Azurite
(Azurite, the storage emulator).
"""

import hashlib
import os
import uuid

import anyio
import pytest
from azure.core.exceptions import ResourceNotFoundError

from apps.cloud import asset_storage
from apps.cloud.asset_storage import AzureBlobAssetStore, FileAssetStore, InvalidName, asset_name
from apps.cloud.assets import make_asset_store
from apps.cloud.config import Settings

SUB = "user-123"
# A person's folder is their user id itself.
USER = SUB
DATA = b"\x89PNG\r\n\x1a\nimage"
AID = hashlib.sha256(DATA).hexdigest()
AZURITE = os.environ.get("WYSEBEE_TEST_AZURITE_CONNECTION_STRING")


# --- a fake container client -----------------------------------------------------------


class _Download:
    def __init__(self, data: bytes) -> None:
        self.data = data

    async def readall(self) -> bytes:
        return self.data


class FakeBlob:
    def __init__(self, container: "FakeContainer", name: str) -> None:
        self.c = container
        self.name = name

    async def upload_blob(self, data: bytes, overwrite: bool = False, length=None, content_settings=None) -> None:
        assert overwrite and length == len(data)
        self.c.blobs[self.name] = bytes(data)
        self.c.types[self.name] = content_settings.content_type

    async def download_blob(self) -> _Download:
        if self.name not in self.c.blobs:
            raise ResourceNotFoundError("The specified blob does not exist.")
        return _Download(self.c.blobs[self.name])

    async def delete_blob(self) -> None:
        if self.c.blobs.pop(self.name, None) is None:
            raise ResourceNotFoundError("The specified blob does not exist.")


class FakeContainer:
    def __init__(self) -> None:
        self.blobs: dict[str, bytes] = {}
        self.types: dict[str, str] = {}
        self.closed = False

    def get_blob_client(self, name: str) -> FakeBlob:
        return FakeBlob(self, name)

    async def list_blob_names(self):
        for name in sorted(self.blobs):
            yield name

    async def close(self) -> None:
        self.closed = True


class _Closable:
    closed = False

    async def close(self) -> None:
        self.closed = True


# --- every store -----------------------------------------------------------------------


@pytest.fixture(params=["file", "fake", "azurite"])
def on_store(request, tmp_path):
    """Runs ``fn(store)`` in one event loop (the SDK's HTTP session belongs to one)."""
    if request.param == "file":
        return lambda fn: anyio.run(fn, FileAssetStore(tmp_path))
    if request.param == "fake":
        return lambda fn: anyio.run(fn, AzureBlobAssetStore(FakeContainer()))
    if not AZURITE:
        pytest.skip("WYSEBEE_TEST_AZURITE_CONNECTION_STRING is not set")
    from azure.storage.blob.aio import BlobServiceClient

    def run_azurite(fn):
        async def go():
            service = BlobServiceClient.from_connection_string(AZURITE)
            container = service.get_container_client(f"test-{uuid.uuid4().hex[:12]}")
            await container.create_container()
            store = AzureBlobAssetStore(container, owned=(service,))
            try:
                return await fn(store)
            finally:
                await container.delete_container()
                await store.aclose()

        return anyio.run(go)

    return run_azurite


async def _names(store) -> list[str]:
    if isinstance(store, FileAssetStore):
        return sorted(str(p.relative_to(store.root)) for p in store.root.rglob("*") if p.is_file())
    return [n async for n in store.container.list_blob_names()]


def test_an_asset_is_written_under_the_documented_name_and_reads_back(on_store):
    async def go(store):
        await store.write(SUB, AID, DATA, "image/png")
        assert await store.read(SUB, AID) == DATA
        assert await _names(store) == [f"{USER}/{AID}"]
        if isinstance(store, AzureBlobAssetStore) and not isinstance(store.container, FakeContainer):
            props = await store.container.get_blob_client(f"{USER}/{AID}").get_blob_properties()
            assert props.content_settings.content_type == "image/png"

    on_store(go)


def test_writing_again_replaces_it_whole(on_store):
    async def go(store):
        await store.write(SUB, AID, b"old old old", "image/png")
        await store.write(SUB, AID, DATA, "image/png")
        assert await store.read(SUB, AID) == DATA

    on_store(go)


def test_a_missing_asset_reads_as_none_and_deletes_quietly(on_store):
    async def go(store):
        assert await store.read(SUB, AID) is None
        await store.delete(SUB, AID)

    on_store(go)


def test_delete_removes_only_that_persons_asset(on_store):
    async def go(store):
        await store.write(SUB, AID, DATA, "image/png")
        await store.write("someone-else", AID, DATA, "image/png")
        await store.delete(SUB, AID)
        assert await store.read(SUB, AID) is None
        assert await store.read("someone-else", AID) == DATA

    on_store(go)


@pytest.mark.parametrize("bad", ["../" + "a" * 61, "A" * 64, "a" * 63, "a" * 32, ""])
def test_bad_ids_never_become_names(tmp_path, bad):
    for store in (FileAssetStore(tmp_path / "files"), AzureBlobAssetStore(FakeContainer())):
        with pytest.raises(InvalidName):
            anyio.run(store.write, SUB, bad, DATA, "image/png")
        with pytest.raises(InvalidName):
            anyio.run(store.read, SUB, bad)
        with pytest.raises(InvalidName):
            anyio.run(store.delete, SUB, bad)
    assert not (tmp_path / "files").exists()


def test_a_failed_file_write_leaves_nothing(tmp_path, monkeypatch):
    store = FileAssetStore(tmp_path)

    def broken(*args):
        raise OSError("disk full")

    monkeypatch.setattr(asset_storage.os, "replace", broken)
    with pytest.raises(OSError):
        anyio.run(store.write, SUB, AID, DATA, "image/png")
    assert [p for p in tmp_path.rglob("*") if p.is_file()] == []


def test_an_asset_deleted_while_it_is_read_reads_as_none(tmp_path, monkeypatch):
    store = FileAssetStore(tmp_path)
    anyio.run(store.write, SUB, AID, DATA, "image/png")

    def gone(self):
        raise FileNotFoundError(self)  # deleted between the check and the read

    monkeypatch.setattr(asset_storage.Path, "read_bytes", gone)
    assert anyio.run(store.read, SUB, AID) is None


def test_the_blob_carries_its_content_type():
    container = FakeContainer()
    anyio.run(AzureBlobAssetStore(container).write, SUB, AID, DATA, "image/webp")
    assert container.types == {f"{USER}/{AID}": "image/webp"}


def test_aclose_closes_the_container_and_owned_clients():
    container, service, credential = FakeContainer(), _Closable(), _Closable()
    anyio.run(AzureBlobAssetStore(container, owned=(service, credential)).aclose)
    assert container.closed and service.closed and credential.closed


# --- choosing the store ----------------------------------------------------------------


def test_the_file_store_is_the_default(tmp_path):
    store = make_asset_store(Settings(_env_file=None, asset_dir=tmp_path))
    assert isinstance(store, FileAssetStore) and store.root == tmp_path


def test_azure_needs_an_account_url():
    with pytest.raises(RuntimeError, match="WYSEBEE_ASSET_AZURE_ACCOUNT_URL"):
        make_asset_store(Settings(_env_file=None, asset_store="azure", asset_azure_account_url=" "))


def test_azure_store_from_settings():
    settings = Settings(
        _env_file=None, asset_store="azure", asset_azure_account_url="https://assets.blob.core.windows.net"
    )
    store = make_asset_store(settings)
    assert isinstance(store, AzureBlobAssetStore)
    assert store.container.container_name == "user-assets"
    assert store.container.url.startswith("https://assets.blob.core.windows.net/user-assets")
    anyio.run(store.aclose)


def test_azure_falls_back_to_the_shared_storage_account(monkeypatch):
    # The name deployments set while desktop backups were kept here still names it.
    monkeypatch.setenv("WYSEBEE_BACKUP_AZURE_ACCOUNT_URL", "https://shared.blob.core.windows.net")
    settings = Settings(
        _env_file=None,
        asset_store="azure",
        asset_azure_container="pictures",
    )
    store = make_asset_store(settings)
    assert store.container.url.startswith("https://shared.blob.core.windows.net/pictures")
    anyio.run(store.aclose)


def test_an_unknown_store_is_refused():
    with pytest.raises(ValueError):
        Settings(_env_file=None, asset_store="s3")


@pytest.mark.parametrize("sub", ["auth0|65f1c2d3e4", "google-oauth2|1098765", "mock|dev@wysebee.local", "user-123"])
def test_an_asset_is_named_by_its_user_id(tmp_path, sub):
    assert asset_name(sub, AID) == f"{sub}/{AID}"
    store = FileAssetStore(tmp_path)
    anyio.run(store.write, sub, AID, DATA, "image/png")
    assert (tmp_path / sub / AID).read_bytes() == DATA


@pytest.mark.parametrize("sub", ["", "a/b", "..", "auth0|..", ".hidden", "a\\b", "a\nb", "x" * 256, "ü|1"])
def test_a_user_id_that_is_not_one_segment_is_refused(tmp_path, sub):
    with pytest.raises(InvalidName):
        asset_name(sub, AID)
    for store in (FileAssetStore(tmp_path / "files"), AzureBlobAssetStore(FakeContainer())):
        with pytest.raises(InvalidName):
            anyio.run(store.write, sub, AID, DATA, "image/png")
    assert not (tmp_path / "files").exists()
