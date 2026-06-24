from __future__ import annotations

import sys
import types

import pytest


class FakeBackend:
    def __init__(self, *, available: bool = True) -> None:
        self.available = available
        self.passwords: dict[tuple[str, str], str] = {}
        self.deleted: list[tuple[str, str]] = []

    async def set_password(self, service: str, account: str, password: str) -> None:
        if not self.available:
            raise RuntimeError(f"backend unavailable for {password}")
        self.passwords[(service, account)] = password

    async def get_password(self, service: str, account: str) -> str | None:
        if not self.available:
            raise RuntimeError("backend unavailable")
        return self.passwords.get((service, account))

    async def delete_password(self, service: str, account: str) -> None:
        if not self.available:
            raise RuntimeError("backend unavailable")
        self.deleted.append((service, account))


@pytest.mark.asyncio
async def test_ai_keystore_saves_provider_key_in_os_keychain_without_leaking_secret():
    from services.ai_keystore import AIKeyStore

    backend = FakeBackend()
    store = AIKeyStore(backend=backend)

    key_ref = await store.save_provider_key("openrouter", "sk-or-secret")

    assert key_ref == "macos-keychain:orbit-ai/openrouter"
    assert backend.passwords == {("orbit-ai/openrouter", "openrouter"): "sk-or-secret"}
    assert "sk-or-secret" not in key_ref


@pytest.mark.asyncio
async def test_ai_keystore_reads_provider_key_from_opaque_ref():
    from services.ai_keystore import AIKeyStore

    backend = FakeBackend()
    store = AIKeyStore(backend=backend)

    key_ref = await store.save_provider_key("openrouter", "sk-or-secret")
    api_key = await store.get_provider_key("openrouter", key_ref)

    assert api_key == "sk-or-secret"
    assert key_ref == "macos-keychain:orbit-ai/openrouter"


@pytest.mark.asyncio
async def test_ai_keystore_deletes_provider_key_from_os_keychain():
    from services.ai_keystore import AIKeyStore

    backend = FakeBackend()
    store = AIKeyStore(backend=backend)

    await store.delete_provider_key("openrouter")

    assert backend.deleted == [("orbit-ai/openrouter", "openrouter")]


@pytest.mark.asyncio
async def test_ai_keystore_unavailable_error_redacts_secret_material():
    from services.ai_keystore import AIKeyStore, AIKeyStoreUnavailableError

    backend = FakeBackend(available=False)
    store = AIKeyStore(backend=backend)

    with pytest.raises(AIKeyStoreUnavailableError) as exc_info:
        await store.save_provider_key("openrouter", "sk-or-secret")

    assert "sk-or-secret" not in str(exc_info.value)
    assert "OS keychain is unavailable" in str(exc_info.value)


@pytest.mark.asyncio
async def test_python_keyring_backend_rejects_unsafe_plaintext_backend(monkeypatch):
    from services.ai_keystore import AIKeyStore, AIKeyStoreUnavailableError

    class UnsafeBackend:
        __module__ = "keyrings.alt.file"
        __class_name__ = "PlaintextKeyring"

    fake_keyring = types.SimpleNamespace(
        get_keyring=lambda: UnsafeBackend(),
        set_password=lambda *_args: pytest.fail("unsafe backend should not be used"),
        get_password=lambda *_args: pytest.fail("unsafe backend should not be used"),
        delete_password=lambda *_args: pytest.fail("unsafe backend should not be used"),
    )
    monkeypatch.setitem(sys.modules, "keyring", fake_keyring)
    store = AIKeyStore()

    with pytest.raises(AIKeyStoreUnavailableError) as exc_info:
        await store.save_provider_key("openrouter", "sk-or-secret")

    assert "unsafe keyring backend" in str(exc_info.value)
    assert "sk-or-secret" not in str(exc_info.value)
