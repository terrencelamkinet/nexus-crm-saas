"""
Provider API key resolution — G08 獨立 API key 儲存（nexus_ai.provider_credentials）。

Keys are stored AES-256-GCM encrypted at rest (secret_crypto), tenant-scoped,
BYOK-enabled. This module is the single source of truth for provider keys:

  - async ``load_provider_key(provider, tenant_id)`` — decrypt from DB, cache
    in-process, fall back to ``<PROVIDER>_API_KEY`` env when nothing stored.
  - sync ``cached_provider_key(provider)`` — read the in-process cache
    (populated by the async loader); safe for sync callers (e.g. namecard OCR)
    that run inside the same process after an async load happened.

Security: keys never leave the process; cache is memory-only; env fallback
preserves dev/self-hosted setups. Multi-tenant BYOK: when tenant_id is given
the lookup is scoped to that tenant; when omitted it takes the newest active
row (current deployments have a single provider key).
"""
from __future__ import annotations

import os

from app.services.secret_crypto import decrypt_secret

# provider → decrypted key (memory-only cache)
_cache: dict[str, str] = {}


def cached_provider_key(provider: str) -> str:
    """Sync read of the in-process cache (may be empty before async load)."""
    return _cache.get(provider, "")


async def load_provider_key(provider: str, tenant_id=None) -> str:
    """Load + decrypt a provider key from provider_credentials.

    Cache hit returns immediately. Otherwise query the newest ACTIVE row
    (tenant-scoped when tenant_id given), decrypt, cache, and return.
    Falls back to ``<PROVIDER>_API_KEY`` env when the DB has no row.
    """
    cached = _cache.get(provider)
    if cached:
        return cached

    from sqlalchemy import select

    from app.db import async_session
    from app.models.ai.provider import ProviderCredential

    key = ""
    try:
        from sqlalchemy import text as _sa_text

        async with async_session() as db:
            # RLS: provider_credentials has FORCE RLS — set the tenant GUC
            # before querying, else 0 rows and callers silently fall back.
            if tenant_id is not None:
                await db.execute(
                    _sa_text("SELECT set_config('app.tenant_id', :tid, true)"),
                    {"tid": str(tenant_id)},
                )
            q = (
                select(ProviderCredential)
                .where(
                    ProviderCredential.provider == provider,
                    ProviderCredential.status == "active",
                )
                .order_by(ProviderCredential.created_at.desc())
            )
            if tenant_id is not None:
                q = q.where(ProviderCredential.tenant_id == tenant_id)
            row = (await db.execute(q.limit(1))).scalar_one_or_none()
            if row is not None and row.encrypted_api_key:
                key = decrypt_secret(row.encrypted_api_key)
    except Exception:
        key = ""  # never raise — callers fall back

    if key:
        _cache[provider] = key
        return key
    return os.environ.get(f"{provider.upper()}_API_KEY", "")
