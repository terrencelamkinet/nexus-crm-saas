"""
WhatsApp AI Bridge — connects WhatsApp messages to NEXUS AI engine.

SOC 2 COMPLIANCE:
  - CC6.1: Internal JWT (2min expiry) for cross-service AI calls
  - CC6.6: All internal calls via localhost (no network exposure)
  - CC7.2: All AI interactions routed through platform's audit trail
  - Uses the platform's internal AI chat endpoint (/api/v1/ai/chat) so all
  provider configuration, session management, and CRM search work exactly
  as they do in the web UI.
"""
import uuid
from datetime import datetime, timezone, timedelta

import httpx
from jose import jwt
from sqlalchemy import select

from app.db import async_session
from app.config import settings
from app.models.whatsapp import WhatsAppMapping
from app.services.auth_service import _load_private_key
from app.services import whatsapp_service

AI_INTERNAL_URL = "http://localhost:8001/api/v1/ai"


def _make_internal_token(user_id: uuid.UUID, tenant_id: uuid.UUID) -> str:
    """Generate a short-lived JWT for internal AI API calls."""
    payload = {
        "sub": str(user_id),
        "email": "whatsapp-bridge@internal",
        "role": "admin",
        "tenant_id": str(tenant_id),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=2),
    }
    return jwt.encode(payload, _load_private_key(), algorithm=settings.jwt_algorithm)


async def handle_whatsapp_message(wa_id: str, text: str) -> str | None:
    """
    WhatsApp message → internal AI chat → return reply text.
    Returns None if user not found.
    """
    # 1. Look up user mapping — normalize wa_id (Meta sends without +, we store with +)
    search_wa_id = wa_id
    search_wa_id_alt = "+" + wa_id if not wa_id.startswith("+") else wa_id[1:]
    async with async_session() as db:
        q = select(WhatsAppMapping).where(
            WhatsAppMapping.wa_id.in_([search_wa_id, search_wa_id_alt]),
            WhatsAppMapping.status == "active",
        )
        mapping = (await db.execute(q)).scalar_one_or_none()

    if not mapping:
        return None

    # 2. Call internal AI chat endpoint
    token = _make_internal_token(mapping.user_id, mapping.tenant_id)
    messages = [{"role": "user", "content": text}]

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            AI_INTERNAL_URL + "/chat",
            json=messages,
            headers={"Authorization": f"Bearer {token}"},
        )

    if resp.status_code != 200:
        error_detail = resp.json().get("detail") or resp.json().get("error", {}).get("message", "Unknown error")
        return f"AI error: {error_detail}"

    data = resp.json()
    return data.get("text", "I couldn't process that request.")


async def push_notification(
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    title: str,
    body: str | None = None,
    priority: str = "NORMAL",
) -> bool:
    """
    Push a notification to user's WhatsApp.
    Returns True if sent, False if user has no WhatsApp connection.
    """
    async with async_session() as db:
        q = select(WhatsAppMapping).where(
            WhatsAppMapping.tenant_id == tenant_id,
            WhatsAppMapping.user_id == user_id,
            WhatsAppMapping.status == "active",
        )
        mapping = (await db.execute(q)).scalar_one_or_none()
        if not mapping:
            return False

        message = f"🔔 {title}"
        if body:
            message += f"\n\n{body}"

        result = await whatsapp_service.send_text(mapping.wa_id, message)
        return not result.get("error")


async def search_crm_data(
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    query: str,
) -> str:
    """
    Direct CRM search via AI — sends query to internal AI endpoint.
    """
    token = _make_internal_token(user_id, tenant_id)
    messages = [{"role": "user", "content": query}]

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            AI_INTERNAL_URL + "/chat",
            json=messages,
            headers={"Authorization": f"Bearer {token}"},
        )

    if resp.status_code != 200:
        return f"Search error: {resp.status_code}"

    data = resp.json()
    return data.get("text", "No results found.")
