"""
WhatsApp Cloud API client — send messages, templates, verify webhooks.

Uses Meta's Graph API v21.0 (WhatsApp Business Platform).
All config read from app.config.settings at call-time.
"""
import hmac
import hashlib
import httpx
from app.config import settings

GRAPH_API_BASE = "https://graph.facebook.com/v21.0"


def _access_token() -> str:
    return settings.whatsapp_access_token or ""


def _phone_number_id() -> str:
    return settings.whatsapp_phone_number_id or ""


def _verify_token() -> str:
    return settings.whatsapp_webhook_verify_token or ""


def _app_secret() -> str:
    return settings.whatsapp_app_secret or ""


def verify_webhook(mode: str, token: str, challenge: str) -> tuple[bool, str]:
    """
    Handle Meta's webhook verification handshake (GET).
    Returns (is_valid, challenge_or_error).
    """
    if mode == "subscribe" and token == _verify_token():
        return True, challenge
    return False, ""


def verify_signature(payload_body: bytes, signature_header: str) -> bool:
    """
    Validate X-Hub-Signature-256 header.
    Meta signs each webhook POST with the App Secret.
    """
    expected = hmac.new(
        _app_secret().encode(), payload_body, hashlib.sha256
    ).hexdigest()
    received = signature_header.replace("sha256=", "").strip()
    return hmac.compare_digest(expected, received)


async def send_template(
    wa_id: str,
    template_name: str,
    params: list[str] | None = None,
    lang: str = "zh_HK",
) -> dict:
    """
    Send a template message (required for 24h+ window / first touch).
    Returns the API response JSON.
    """
    components = []
    if params:
        components.append({
            "type": "body",
            "parameters": [{"type": "text", "text": p} for p in params],
        })

    payload = {
        "messaging_product": "whatsapp",
        "to": wa_id,
        "type": "template",
        "template": {
            "name": template_name,
            "language": {"code": lang},
        },
    }
    if components:
        payload["template"]["components"] = components

    return await _post_message(payload)


async def send_text(wa_id: str, text: str) -> dict:
    """Send a free-form text message (24h window from last user message)."""
    payload = {
        "messaging_product": "whatsapp",
        "to": wa_id,
        "type": "text",
        "text": {"body": text},
    }
    return await _post_message(payload)


async def send_otp(wa_id: str, otp: str) -> dict:
    """
    Send OTP verification message.
    Uses text message for testing (works in sandbox mode).
    For production: use 'account_verification_otp' template (must be approved in Meta Business Manager).
    """
    return await send_text(wa_id, f"Your NEXUS CRM verification code: {otp}\n\nCode expires in 5 minutes.")


async def _post_message(payload: dict) -> dict:
    """POST to the WhatsApp Cloud API messages endpoint."""
    phone_id = _phone_number_id()
    token = _access_token()
    if not phone_id or not token:
        return {"error": True, "message": "WhatsApp API not configured"}

    url = f"{GRAPH_API_BASE}/{phone_id}/messages"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, headers=headers, json=payload)
        return resp.json()
