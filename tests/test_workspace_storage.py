"""The workspace store: files named by their paths, under ``<user id>/<workspace>/``, on disk
and in a fake Azure container."""

from datetime import UTC, datetime
from types import SimpleNamespace

import anyio
import pytest
from azure.core.exceptions import ResourceNotFoundError

from apps.cloud.asset_storage import InvalidName
from apps.cloud.config import Settings
from apps.cloud.workspace_storage import AzureBlobWorkspaceStore, FileWorkspaceStore, blob_name
from apps.cloud.workspaces import make_workspace_store
from tests.test_asset_storage import FakeContainer

SUB = "auth0|abc"


class FakeWorkspaceContainer(FakeContainer):
    url = "https://acct.blob.core.windows.net/user-workspaces"

    async def list_blobs(self, name_starts_with: str = ""):
        for name in sorted(self.blobs):
            if name.startswith(name_starts_with):
                yield SimpleNamespace(name=name, size=len(self.blobs[name]), last_modified=datetime(2026, 11, 14, tzinfo=UTC))

    async def delete_blob(self, name: str) -> None:
        if name == f"{SUB}/Gone/vanishes.md":
            raise ResourceNotFoundError("gone meanwhile")
        self.blobs.pop(name, None)


@pytest.fixture(params=["file", "fake"])
def on_store(request, tmp_path):
    if request.param == "file":
        return lambda fn: anyio.run(fn, FileWorkspaceStore(tmp_path))
    return lambda fn: anyio.run(fn, AzureBlobWorkspaceStore(FakeWorkspaceContainer()))


def test_files_are_named_by_path_listed_and_removed_by_prefix(on_store):
    async def go(store):
        await store.write(SUB, "Docs/README.md", b"# Docs\n", "text/markdown")
        await store.write(SUB, "Docs/guide/setup.md", b"setup", "text/markdown")
        await store.write(SUB, "Other/a.md", b"a", "text/markdown")
        assert await store.read(SUB, "Docs/README.md") == b"# Docs\n"
        assert await store.read(SUB, "Docs/missing.md") is None
        listed = await store.list(SUB, "Docs")
        assert [(f.path, f.size) for f in listed] == [("README.md", 7), ("guide/setup.md", 5)]
        assert all(f.updated_at.tzinfo is not None for f in listed)
        assert [f.path for f in await store.list(SUB, "Docs/guide/")] == ["setup.md"]
        assert await store.list(SUB, "Nothing") == []
        await store.delete(SUB, "Docs/README.md")
        await store.delete(SUB, "Docs/README.md")
        await store.delete_prefix(SUB, "Docs")
        assert await store.list(SUB, "Docs") == []
        assert [f.path for f in await store.list(SUB, "Other")] == ["a.md"]
        await store.aclose()

    on_store(go)


def test_a_path_never_climbs_out():
    for key in ["", "../x", "a//b", "a/./b", "a\\b"]:
        with pytest.raises(InvalidName):
            blob_name(SUB, key)
    with pytest.raises(InvalidName):
        blob_name("../evil", "a")
    assert blob_name(SUB, "P/a.md") == f"{SUB}/P/a.md"


def test_urls_name_the_folder(tmp_path):
    assert FileWorkspaceStore(tmp_path).url(SUB, "My Docs").endswith("/auth0%7Cabc/My%20Docs/")
    store = AzureBlobWorkspaceStore(FakeWorkspaceContainer())
    assert store.url(SUB, "My Docs") == "https://acct.blob.core.windows.net/user-workspaces/auth0%7Cabc/My%20Docs/"


def test_azure_delete_prefix_shrugs_off_a_blob_gone_meanwhile():
    async def go():
        container = FakeWorkspaceContainer()
        container.blobs[f"{SUB}/Gone/vanishes.md"] = b"x"
        container.blobs[f"{SUB}/Gone/stays-gone.md"] = b"y"
        closed = SimpleNamespace(closed=False)

        async def close():
            closed.closed = True

        store = AzureBlobWorkspaceStore(container, owned=(SimpleNamespace(close=close),))
        await store.delete_prefix(SUB, "Gone")
        assert f"{SUB}/Gone/stays-gone.md" not in container.blobs
        await store.aclose()
        assert container.closed and closed.closed

    anyio.run(go)


def test_the_store_follows_the_asset_store_setting(tmp_path, monkeypatch):
    assert isinstance(make_workspace_store(Settings(workspace_dir=tmp_path)), FileWorkspaceStore)
    with pytest.raises(RuntimeError):
        make_workspace_store(Settings(asset_store="azure"))
    made = {}
    monkeypatch.setattr(AzureBlobWorkspaceStore, "from_account_url", classmethod(lambda cls, url, name: made.setdefault("args", (url, name))))
    make_workspace_store(Settings(asset_store="azure", asset_azure_account_url="https://acct.blob.core.windows.net"))
    assert made["args"] == ("https://acct.blob.core.windows.net", "user-workspaces")


def test_a_failed_write_leaves_no_temporary_file(tmp_path, monkeypatch):
    import os

    def fail(*_):
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", fail)
    store = FileWorkspaceStore(tmp_path)
    with pytest.raises(OSError):
        anyio.run(store.write, SUB, "P/a.md", b"x", "text/markdown")
    assert [p.name for p in (tmp_path / SUB / "P").iterdir()] == []
