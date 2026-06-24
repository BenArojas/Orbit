"""OS keychain storage for cloud AI provider secrets.

SQLite may store only the opaque reference returned by this module. Secret
material must stay in the OS keychain and must never be returned to routes.
"""
from __future__ import annotations

import asyncio
from typing import Protocol


class AIKeyStoreUnavailableError(RuntimeError):
    """Raised when the OS keychain backend cannot store provider secrets."""


class KeyringBackend(Protocol):
    async def set_password(self, service: str, account: str, password: str) -> None:
        ...

    async def get_password(self, service: str, account: str) -> str | None:
        ...

    async def delete_password(self, service: str, account: str) -> None:
        ...


class PythonKeyringBackend:
    """Thin async adapter around the platform keyring backend."""

    async def set_password(self, service: str, account: str, password: str) -> None:
        keyring = self._load_keyring()
        self._validate_os_backed(keyring)
        await asyncio.to_thread(keyring.set_password, service, account, password)

    async def get_password(self, service: str, account: str) -> str | None:
        keyring = self._load_keyring()
        self._validate_os_backed(keyring)
        return await asyncio.to_thread(keyring.get_password, service, account)

    async def delete_password(self, service: str, account: str) -> None:
        keyring = self._load_keyring()
        self._validate_os_backed(keyring)
        await asyncio.to_thread(keyring.delete_password, service, account)

    @staticmethod
    def _load_keyring():
        try:
            import keyring
        except ImportError as exc:
            raise AIKeyStoreUnavailableError("OS keychain is unavailable") from exc
        return keyring

    @staticmethod
    def _validate_os_backed(keyring_module) -> None:
        backend = keyring_module.get_keyring()
        backend_module = backend.__class__.__module__
        backend_name = backend.__class__.__name__.lower()
        unsafe_module_prefixes = (
            "keyrings.alt",
            "keyring.backends.fail",
            "keyring.backends.null",
            "keyring.backends.chainer",
        )
        unsafe_name_fragments = ("plaintext", "encrypted", "fail", "null", "chainer")
        if backend_module.startswith(unsafe_module_prefixes) or any(
            fragment in backend_name for fragment in unsafe_name_fragments
        ):
            raise AIKeyStoreUnavailableError("unsafe keyring backend is unavailable")

        safe_module_prefixes = (
            "keyring.backends.macOS",
            "keyring.backends.Windows",
            "keyring.backends.SecretService",
            "keyring.backends.kwallet",
            "keyring.backends.libsecret",
        )
        if not backend_module.startswith(safe_module_prefixes):
            raise AIKeyStoreUnavailableError("unsafe keyring backend is unavailable")


class AIKeyStore:
    """Store provider API keys in the OS keychain and return opaque refs."""

    def __init__(self, backend: KeyringBackend | None = None) -> None:
        self._backend = backend or PythonKeyringBackend()

    async def save_provider_key(self, provider_name: str, api_key: str) -> str:
        ref = self._key_ref(provider_name)
        try:
            await self._backend.set_password(ref.service, ref.account, api_key)
        except AIKeyStoreUnavailableError:
            raise
        except (OSError, RuntimeError) as exc:
            raise AIKeyStoreUnavailableError("OS keychain is unavailable") from exc
        return ref.value

    async def delete_provider_key(self, provider_name: str) -> None:
        ref = self._key_ref(provider_name)
        try:
            await self._backend.delete_password(ref.service, ref.account)
        except AIKeyStoreUnavailableError:
            raise
        except (OSError, RuntimeError) as exc:
            raise AIKeyStoreUnavailableError("OS keychain is unavailable") from exc

    async def get_provider_key(self, provider_name: str, api_key_ref: str) -> str:
        ref = self._key_ref(provider_name)
        if api_key_ref != ref.value:
            raise AIKeyStoreUnavailableError("OS keychain reference is invalid")
        try:
            api_key = await self._backend.get_password(ref.service, ref.account)
        except AIKeyStoreUnavailableError:
            raise
        except (OSError, RuntimeError) as exc:
            raise AIKeyStoreUnavailableError("OS keychain is unavailable") from exc
        if not api_key:
            raise AIKeyStoreUnavailableError("OS keychain secret is unavailable")
        return api_key

    @staticmethod
    def _key_ref(provider_name: str) -> "_ProviderKeyRef":
        service = f"orbit-ai/{provider_name}"
        return _ProviderKeyRef(
            service=service,
            account=provider_name,
            value=f"macos-keychain:{service}",
        )


class _ProviderKeyRef:
    def __init__(self, *, service: str, account: str, value: str) -> None:
        self.service = service
        self.account = account
        self.value = value
