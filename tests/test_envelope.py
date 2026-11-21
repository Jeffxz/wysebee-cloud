"""Envelope encryption (apps/cloud/envelope.py): a local KEK and Azure Key Vault's, the
latter over a fake vault."""

import base64
import json

import httpx
import pytest

from apps.cloud.config import Settings
from apps.cloud.envelope import EnvelopeError, KeyVaultKek, LocalKek, Sealed, make_kek, open_sealed, seal

pytestmark = pytest.mark.anyio

KEK = base64.b64encode(b"k" * 32).decode()


async def test_a_secret_opens_only_for_its_owner_and_name_under_its_key() -> None:
    kek = LocalKek.from_base64(KEK)
    sealed = await seal(kek, "auth0|a", "openai", "sk-secret")
    assert b"sk-secret" not in sealed.ciphertext + sealed.wrapped_key
    assert sealed.kek_id.startswith("local:")
    assert await open_sealed(kek, "auth0|a", "openai", sealed) == "sk-secret"
    # Another person's, or another provider's, does not open: they are bound in.
    for owner, name in (("auth0|b", "openai"), ("auth0|a", "anthropic")):
        with pytest.raises(EnvelopeError, match="could not be opened"):
            await open_sealed(kek, owner, name, sealed)
    # Under another key: said so.
    other = LocalKek(b"o" * 32)
    with pytest.raises(EnvelopeError, match="another key"):
        await open_sealed(other, "auth0|a", "openai", sealed)
    # A wrapped key that was tampered with.
    with pytest.raises(EnvelopeError, match="could not be opened"):
        await open_sealed(kek, "auth0|a", "openai", Sealed(sealed.ciphertext, sealed.nonce, b"x" * 40, sealed.kek_id))
    await kek.aclose()


def test_a_local_key_is_32_bytes_of_base64() -> None:
    for bad in ("not base64!", base64.b64encode(b"short").decode()):
        with pytest.raises(ValueError, match="32 bytes"):
            LocalKek.from_base64(bad)


def test_the_configured_key_is_the_vaults_else_the_local_one_else_none(monkeypatch) -> None:
    assert make_kek(Settings()) is None
    assert make_kek(Settings(ai_kek=" ")) is None
    assert isinstance(make_kek(Settings(ai_kek=KEK)), LocalKek)
    made = []
    monkeypatch.setattr(KeyVaultKek, "with_identity", classmethod(lambda cls, url: made.append(url) or "vault"))
    assert make_kek(Settings(ai_kek=KEK, ai_kek_vault_key_url="https://v.vault.azure.net/keys/k")) == "vault"
    assert made == ["https://v.vault.azure.net/keys/k"]


def _vault(seen: list, status: int = 200):
    def handle(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append((request.url.path, request.url.params.get("api-version"), request.headers["Authorization"], body["alg"]))
        if status != 200:
            return httpx.Response(status, json={"error": {"message": "nope"}})
        # The fake vault "wraps" by reversing the bytes.
        value = base64.urlsafe_b64decode(body["value"] + "=" * (-len(body["value"]) % 4))[::-1]
        return httpx.Response(200, json={"kid": "https://v.vault.azure.net/keys/k/v2", "value": base64.urlsafe_b64encode(value).rstrip(b"=").decode()})

    return handle


async def test_a_key_vault_key_wraps_and_unwraps_in_the_vault() -> None:
    seen: list = []

    async def token() -> str:
        return "tok"

    http = httpx.AsyncClient(transport=httpx.MockTransport(_vault(seen)))
    kek = KeyVaultKek("https://v.vault.azure.net/keys/k/", token, http, owned=(http,))
    sealed = await seal(kek, "auth0|a", "openai", "sk-secret")
    assert sealed.kek_id == "https://v.vault.azure.net/keys/k/v2"
    assert await open_sealed(kek, "auth0|a", "openai", sealed) == "sk-secret"
    assert seen == [("/keys/k/wrapkey", "7.4", "Bearer tok", "RSA-OAEP-256"), ("/keys/k/v2/unwrapkey", "7.4", "Bearer tok", "RSA-OAEP-256")]
    # A row naming another vault is never sent anywhere.
    with pytest.raises(EnvelopeError, match="another key"):
        await kek.unwrap(b"x", "https://evil.example/keys/k/v1")
    await kek.aclose()
    assert http.is_closed


async def test_a_vault_that_refuses_or_cannot_be_reached_is_an_envelope_error() -> None:
    async def token() -> str:
        return "tok"

    refusing = KeyVaultKek("https://v.vault.azure.net/keys/k", token, httpx.AsyncClient(transport=httpx.MockTransport(_vault([], 403))))
    with pytest.raises(EnvelopeError, match=r"refused \(403\)"):
        await refusing.wrap(b"k" * 32)

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    unreachable = KeyVaultKek("https://v.vault.azure.net/keys/k", token, httpx.AsyncClient(transport=httpx.MockTransport(down)))
    with pytest.raises(EnvelopeError, match="could not be reached"):
        await unreachable.wrap(b"k" * 32)


async def test_with_identity_signs_in_as_the_app_and_closes_what_it_made(monkeypatch) -> None:
    closed = []

    class Credential:
        async def get_token(self, scope: str):
            return type("T", (), {"token": f"for {scope}"})()

        async def close(self) -> None:
            closed.append("credential")

    import azure.identity.aio

    monkeypatch.setattr(azure.identity.aio, "DefaultAzureCredential", Credential)
    kek = KeyVaultKek.with_identity("https://v.vault.azure.net/keys/k")
    assert await kek._token() == "for https://vault.azure.net/.default"
    await kek.aclose()
    assert closed == ["credential"]
