"""Envelope encryption for the secrets the cloud keeps: the passwords of the PostgreSQL
and Snowflake connections of agents living in Wysebee Cloud (apps/cloud/user_tools.py) and the credentials the person's Wysebee apps keep here so
that all of them have them (apps/cloud/credentials.py).
(The person's own AI keys were kept this way too, until bring-your-own-key ended on
2026-11-03: the cloud's AI keys are environment variables now.)

Each secret is encrypted with **a data key of its own** (AES-256-GCM, a fresh 12-byte nonce,
the owner and the secret's name bound in as associated data, so a row copied to another
person or provider does not open). The data key is stored only **wrapped** by a
**key-encryption key (KEK) that is never in the database**:

- **Azure Key Vault** in production (``WYSEBEE_AI_KEK_VAULT_KEY_URL``,
  ``https://<vault>.vault.azure.net/keys/<name>[/<version>]``): an RSA key that never leaves
  the vault; wrapping and unwrapping are the vault's ``wrapkey``/``unwrapkey`` operations
  (RSA-OAEP-256), signed in as the app's identity (``DefaultAzureCredential``: the managed
  identity in Container Apps). The versioned key id the vault answers is stored with each
  row, so rotating the key leaves older rows readable while that version is enabled.
- **A local key** for development and tests (``WYSEBEE_AI_KEK``: 32 bytes, base64): AES key
  wrap (RFC 3394). Its id is ``local:`` and the first 16 hex digits of its SHA-256, so a
  row sealed under another local key says so instead of failing obscurely.

So a copy of the database alone reveals no secret: opening one needs the KEK too.
"""

import base64
import hashlib
import os
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.keywrap import InvalidUnwrap, aes_key_unwrap, aes_key_wrap

from apps.cloud.config import Settings

KEY_VAULT_API = "7.4"
KEY_VAULT_SCOPE = "https://vault.azure.net/.default"
WRAP_ALG = "RSA-OAEP-256"


class EnvelopeError(Exception):
    """A secret could not be sealed or opened: the KEK is unreachable, or is not the one it
    was sealed with."""


class Kek(Protocol):
    async def wrap(self, data_key: bytes) -> tuple[bytes, str]:
        """The data key wrapped, and the id of the KEK (version) that wrapped it."""
        ...

    async def unwrap(self, wrapped: bytes, kek_id: str) -> bytes: ...

    async def aclose(self) -> None: ...


class LocalKek:
    """A KEK held in the process's environment: development and tests only."""

    def __init__(self, key: bytes) -> None:
        if len(key) != 32:
            raise ValueError("WYSEBEE_AI_KEK must be 32 bytes, base64-encoded.")
        self._key = key
        self.kek_id = "local:" + hashlib.sha256(key).hexdigest()[:16]

    @classmethod
    def from_base64(cls, text: str) -> "LocalKek":
        try:
            key = base64.b64decode(text.strip(), validate=True)
        except ValueError as exc:
            raise ValueError("WYSEBEE_AI_KEK must be 32 bytes, base64-encoded.") from exc
        return cls(key)

    async def wrap(self, data_key: bytes) -> tuple[bytes, str]:
        return aes_key_wrap(self._key, data_key), self.kek_id

    async def unwrap(self, wrapped: bytes, kek_id: str) -> bytes:
        if kek_id != self.kek_id:
            raise EnvelopeError(f"This secret was sealed under another key ({kek_id}).")
        try:
            return aes_key_unwrap(self._key, wrapped)
        except InvalidUnwrap as exc:
            raise EnvelopeError("This secret could not be opened.") from exc

    async def aclose(self) -> None:
        pass


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64url(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


TokenSource = Callable[[], Awaitable[str]]


class KeyVaultKek:
    """An RSA key in Azure Key Vault: the data key goes to the vault to be wrapped or
    unwrapped; the KEK itself never leaves it."""

    def __init__(self, key_url: str, token: TokenSource, http: httpx.AsyncClient, *, owned: tuple[object, ...] = ()) -> None:
        self.key_url = key_url.rstrip("/")
        self._token = token
        self._http = http
        self._owned = owned

    @classmethod
    def with_identity(cls, key_url: str) -> "KeyVaultKek":
        """Signed in as the app's identity (``DefaultAzureCredential``)."""
        from azure.identity.aio import DefaultAzureCredential

        credential = DefaultAzureCredential()

        async def token() -> str:
            return (await credential.get_token(KEY_VAULT_SCOPE)).token

        http = httpx.AsyncClient(timeout=30)
        return cls(key_url, token, http, owned=(credential, http))

    async def _call(self, url: str, value: bytes) -> dict:
        try:
            r = await self._http.post(
                f"{url}?api-version={KEY_VAULT_API}",
                json={"alg": WRAP_ALG, "value": _b64url(value)},
                headers={"Authorization": f"Bearer {await self._token()}"},
            )
        except Exception as exc:  # noqa: BLE001 — any failure to reach the vault
            raise EnvelopeError(f"The key vault could not be reached ({type(exc).__name__}).") from exc
        if r.status_code != 200:
            raise EnvelopeError(f"The key vault refused ({r.status_code}).")
        return r.json()

    async def wrap(self, data_key: bytes) -> tuple[bytes, str]:
        out = await self._call(f"{self.key_url}/wrapkey", data_key)
        return _unb64url(out["value"]), str(out.get("kid") or self.key_url)

    async def unwrap(self, wrapped: bytes, kek_id: str) -> bytes:
        # Only this vault's keys: a row naming another URL is never sent anywhere.
        vault = self.key_url.split("/keys/")[0]
        if not kek_id.startswith(vault + "/keys/"):
            raise EnvelopeError(f"This secret was sealed under another key ({kek_id}).")
        out = await self._call(f"{kek_id}/unwrapkey", wrapped)
        return _unb64url(out["value"])

    async def aclose(self) -> None:
        # The credential and the HTTP client this KEK made (``with_identity``).
        for client in self._owned:
            if isinstance(client, httpx.AsyncClient):
                await client.aclose()
            else:
                await client.close()  # type: ignore[attr-defined]


def make_kek(settings: Settings) -> Kek | None:
    """The configured KEK: the vault's key, else the local one; none when neither is set."""
    if settings.ai_kek_vault_key_url:
        return KeyVaultKek.with_identity(settings.ai_kek_vault_key_url)
    if settings.ai_kek:
        return LocalKek.from_base64(settings.ai_kek)
    return None


@dataclass
class Sealed:
    ciphertext: bytes
    nonce: bytes
    wrapped_key: bytes
    kek_id: str


def _aad(owner: str, name: str) -> bytes:
    return f"wysebee-secret|{owner}|{name}".encode()


async def seal(kek: Kek, owner: str, name: str, secret: str) -> Sealed:
    """Encrypt ``secret`` for ``owner`` under a fresh data key, wrapped by ``kek``."""
    data_key = AESGCM.generate_key(bit_length=256)
    nonce = os.urandom(12)
    ciphertext = AESGCM(data_key).encrypt(nonce, secret.encode(), _aad(owner, name))
    wrapped, kek_id = await kek.wrap(data_key)
    return Sealed(ciphertext, nonce, wrapped, kek_id)


async def open_sealed(kek: Kek, owner: str, name: str, sealed: Sealed) -> str:
    """The secret back; :class:`EnvelopeError` when it cannot be opened."""
    data_key = await kek.unwrap(sealed.wrapped_key, sealed.kek_id)
    try:
        return AESGCM(data_key).decrypt(sealed.nonce, sealed.ciphertext, _aad(owner, name)).decode()
    except Exception as exc:  # noqa: BLE001 — tampered, or another owner's row
        raise EnvelopeError("This secret could not be opened.") from exc
