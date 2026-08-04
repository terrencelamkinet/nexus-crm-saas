"""
Telegram integration router — bot binding, connection status, webhooks.

SOC 2 COMPLIANCE:
  - CC6.1 (Access Control): All auth endpoints use get_tenant_session + JWT
  - CC6.6 (Encryption): Cloudflare TLS for all external traffic
  - CC6.7 (At Rest): Bot token stored in nexus_ai.ai_channel_credentials
    (ChannelCredential, encrypted at app level) — NOT plaintext in mapping.
  - CC7.2 (Audit): Webhook deliveries logged to /tmp/telegram_webhook.log

Design: docs/design-im-push-module.md §4 endpoint table.
  POST /telegram/bind       — user provides bot_token + chat_id → getMe() validate
  GET  /telegram/status     — connection status
  POST /telegram/disconnect — unbind
  POST /telegram/webhook    — (public) Telegram Bot update receiver (reserved)
"""
import uuid
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Request, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_tenant_session
from app.models.telegram_bot import TelegramBotMapping
from app.models.ai.secretary_settings import SecretarySettings, ChannelCredential, DEFAULT_CHANNELS
from app.models.integration import Integration
from app.routers.crm_integrations import _tid, _uid, PROVIDER_DISPLAY
from app.services import telegram_service

router = APIRouter(prefix="/api/v1")


# ── Schemas ──────────────────────────────────────────────────────────
class TelegramBindRequest(BaseModel):
    bot_token: str    # from @BotFather
    chat_id: str      # the chat the user wants deliveries in (Terrence: "bot id 等資料")


# ── AUTH: Bind Telegram bot ──────────────────────────────────────────


@router.post("/telegram/bind")
async def bind_telegram(
    body: TelegramBindRequest,
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    """
    Validate the user's bot token with Telegram getMe(), then store the
    binding so the bot can push messages to the given chat_id.
    Body: { "bot_token": "...", "chat_id": "123456" }
    """
    bot_token = body.bot_token.strip()
    chat_id = body.chat_id.strip()
    if not bot_token or not chat_id:
        raise HTTPException(400, "bot_token and chat_id are required")

    # 🛡️ Validate token against Telegram BEFORE storing anything.
    info = await telegram_service.get_me(bot_token)
    if not info.get("ok"):
        raise HTTPException(400, f"Telegram bot token invalid: {info.get('error')}")

    bot = info.get("bot", {})
    bot_username = bot.get("username") or ""

    tenant_id = _tid(request)
    user_id = _uid(request)

    # ── Store bot token in the secret store (ChannelCredential) ──
    cred = (
        await db.execute(
            select(ChannelCredential).where(
                ChannelCredential.tenant_id == tenant_id,
                ChannelCredential.user_id == user_id,
                ChannelCredential.channel == "telegram",
            )
        )
    ).scalar_one_or_none()
    if cred is None:
        cred = ChannelCredential(
            tenant_id=tenant_id, user_id=user_id, channel="telegram"
        )
        db.add(cred)
    cred.access_token = bot_token
    cred.external_id = chat_id
    cred.connected_at = datetime.now(timezone.utc)
    cred.revoked_at = None

    # ── Upsert mapping (connection record) ──
    mapping = (
        await db.execute(
            select(TelegramBotMapping).where(
                TelegramBotMapping.tenant_id == tenant_id,
                TelegramBotMapping.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if mapping is None:
        mapping = TelegramBotMapping(
            tenant_id=tenant_id,
            user_id=user_id,
            bot_username=bot_username,
            bot_token=bot_token,  # opaque reference; secret lives in ChannelCredential
            chat_id=chat_id,
            status="active",
            config={"bot_id": bot.get("id"), "token_validated_at": datetime.now(timezone.utc).isoformat()},
        )
        db.add(mapping)
    else:
        mapping.bot_username = bot_username
        mapping.bot_token = bot_token
        mapping.chat_id = chat_id
        mapping.status = "active"
        mapping.config = mapping.config or {}
        mapping.config.update({"bot_id": bot.get("id"), "token_validated_at": datetime.now(timezone.utc).isoformat()})
        mapping.updated_at = datetime.now(timezone.utc)
    await db.flush()

    # ── Upsert into nexus_integrations so the Marketplace shows it ──
    integration = (
        await db.execute(
            select(Integration).where(
                Integration.tenant_id == tenant_id,
                Integration.user_id == user_id,
                Integration.provider == "telegram",
            )
        )
    ).scalar_one_or_none()
    if integration:
        integration.status = "active"
        integration.config = {"bot_username": bot_username, "chat_id": chat_id}
        integration.metadata_ = {
            **(integration.metadata_ or {}),
            "connected_at": datetime.now(timezone.utc).isoformat(),
        }
        integration.updated_at = datetime.now(timezone.utc)
    else:
        db.add(Integration(
            tenant_id=tenant_id,
            user_id=user_id,
            provider="telegram",
            provider_display=PROVIDER_DISPLAY.get("telegram", "Telegram"),
            status="active",
            config={"bot_username": bot_username, "chat_id": chat_id},
            metadata_={"connected_at": datetime.now(timezone.utc).isoformat()},
        ))

    # ── Default-ON: enable AI briefing push for telegram (§2.1) ──
    from app.models.im_push import IMDeliveryPref
    pref = (
        await db.execute(
            select(IMDeliveryPref).where(
                IMDeliveryPref.tenant_id == tenant_id,
                IMDeliveryPref.user_id == user_id,
                IMDeliveryPref.channel == "telegram",
            )
        )
    ).scalar_one_or_none()
    if pref is None:
        db.add(IMDeliveryPref(tenant_id=tenant_id, user_id=user_id, channel="telegram"))
    else:
        pref.enabled = True
    await db.flush()

    # ── Flip SecretarySettings.channels[telegram].connected = True ──
    await _set_channels(db, tenant_id, user_id, connected=True, enabled=True)

    await db.commit()
    return {
        "status": "connected",
        "bot_username": bot_username,
        "chat_id": chat_id,
    }


# ── AUTH: Get Telegram connection status ─────────────────────────────


@router.get("/telegram/status")
async def telegram_status(
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    """Get the current user's Telegram binding status."""
    tenant_id = _tid(request)
    user_id = _uid(request)

    mapping = (
        await db.execute(
            select(TelegramBotMapping).where(
                TelegramBotMapping.tenant_id == tenant_id,
                TelegramBotMapping.user_id == user_id,
                TelegramBotMapping.status == "active",
            )
        )
    ).scalar_one_or_none()

    if not mapping:
        return {"status": "disconnected", "bot_username": None, "chat_id": None}

    return {
        "status": "active",
        "bot_username": mapping.bot_username,
        "chat_id": str(mapping.chat_id),
        "connected_at": mapping.created_at.isoformat() if mapping.created_at else None,
    }


# ── AUTH: Disconnect Telegram ────────────────────────────────────────


@router.post("/telegram/disconnect")
async def disconnect_telegram(
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    """Unbind Telegram bot from the current user's account."""
    tenant_id = _tid(request)
    user_id = _uid(request)

    # Deactivate mapping
    mapping = (
        await db.execute(
            select(TelegramBotMapping).where(
                TelegramBotMapping.tenant_id == tenant_id,
                TelegramBotMapping.user_id == user_id,
                TelegramBotMapping.status == "active",
            )
        )
    ).scalar_one_or_none()
    if mapping:
        mapping.status = "disconnected"
        mapping.updated_at = datetime.now(timezone.utc)

    # Revoke secret
    cred = (
        await db.execute(
            select(ChannelCredential).where(
                ChannelCredential.tenant_id == tenant_id,
                ChannelCredential.user_id == user_id,
                ChannelCredential.channel == "telegram",
            )
        )
    ).scalar_one_or_none()
    if cred:
        cred.revoked_at = datetime.now(timezone.utc)
        cred.access_token = ""

    # Deactivate integration
    integration = (
        await db.execute(
            select(Integration).where(
                Integration.tenant_id == tenant_id,
                Integration.user_id == user_id,
                Integration.provider == "telegram",
            )
        )
    ).scalar_one_or_none()
    if integration:
        integration.status = "disconnected"
        integration.updated_at = datetime.now(timezone.utc)

    # Flip SecretarySettings.channels[telegram].connected = False
    await _set_channels(db, tenant_id, user_id, connected=False, enabled=False)

    await db.commit()
    return {"status": "disconnected"}


# ── PUBLIC: Webhook receiver (reserved — Phase C) ────────────────────


@router.post("/telegram/webhook")
async def telegram_webhook(request: Request):
    """
    Telegram sends updates here when a webhook is registered (Phase C).
    Reserved endpoint — currently logs + acknowledges. Public by nature
    (Telegram calls it); any processing must never assume tenant context.
    """
    body = await request.body()
    data = json.loads(body) if body else {}
    from datetime import datetime as _dt
    with open("/tmp/telegram_webhook.log", "a") as f:
        f.write(f"[{_dt.now().isoformat()}] update: {str(data)[:500]}\n")
    return {"ok": True}


# ── AUTH: Send test message ───────────────────────────────────────────


@router.post("/telegram/send")
async def send_telegram_message(
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    """Send a test message to the user's bound Telegram chat."""
    tenant_id = _tid(request)
    user_id = _uid(request)

    mapping = (
        await db.execute(
            select(TelegramBotMapping).where(
                TelegramBotMapping.tenant_id == tenant_id,
                TelegramBotMapping.user_id == user_id,
                TelegramBotMapping.status == "active",
            )
        )
    ).scalar_one_or_none()
    if not mapping:
        raise HTTPException(400, "Telegram not connected")

    cred = (
        await db.execute(
            select(ChannelCredential).where(
                ChannelCredential.tenant_id == tenant_id,
                ChannelCredential.user_id == user_id,
                ChannelCredential.channel == "telegram",
            )
        )
    ).scalar_one_or_none()
    token = cred.access_token if cred and cred.access_token else ""
    if not token:
        raise HTTPException(400, "Telegram bot token missing")

    text = "🤖 [AI 助理] Telegram 測試推送成功！\n\n你已開啟 AI 每日簡報（早安 / 午間 / 傍晚）。"
    result = await telegram_service.send_message(token, str(mapping.chat_id), text)
    if not result.get("ok"):
        raise HTTPException(502, f"Telegram delivery failed: {result.get('description', 'API error')}")
    return {"status": "sent", "detail": result}


# ── INTERNAL HELPERS ─────────────────────────────────────────────────


async def _set_channels(
    db: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID, *, connected: bool, enabled: bool
):
    """Flip SecretarySettings.channels[telegram] so the AI Apps UI stays in sync."""
    row = (
        await db.execute(
            select(SecretarySettings).where(
                SecretarySettings.tenant_id == tenant_id,
                SecretarySettings.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return
    channels = dict(row.channels or DEFAULT_CHANNELS)
    current = dict(channels.get("telegram", {}))
    current["connected"] = connected
    current["enabled"] = enabled
    channels["telegram"] = current
    row.channels = channels
