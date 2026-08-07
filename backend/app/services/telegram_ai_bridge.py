"""
Telegram AI Bridge — connects Telegram bot messages to NEXUS AI engine.

Mirrors WhatsApp AI bridge (whatsapp_ai_bridge.py) so the bot replies with
the exact same AI-powered UX as WhatsApp: internal JWT → POST /api/v1/ai/chat
→ formatted reply.

SOC 2 COMPLIANCE:
  - CC6.1: Internal JWT (2min expiry) for cross-service AI calls
  - CC6.6: All internal calls via localhost (no network exposure)
  - CC7.2: All AI interactions routed through platform's audit trail
"""
import uuid
import re
from datetime import datetime, timezone, timedelta
from typing import Any, cast

import httpx
from jose import jwt
from sqlalchemy import select

from app.db import async_session
from app.config import settings
from app.models.telegram_bot import TelegramBotMapping
from app.services.auth_service import _load_private_key
from app.services import telegram_service

AI_INTERNAL_URL = "http://localhost:8001/api/v1/ai"

# App link — appended whenever CRM data is shown in a Telegram reply
CRM_LINK = "https://nexus-crm.kinet-poc.com"

# Telegram reply guidelines — same professional NEXUS AI secretary rules as
# WhatsApp, with Telegram-specific formatting (parse_mode=HTML, no markdown).
TELEGRAM_SYSTEM_PROMPT = (
    "你是 NEXUS CRM 的專屬 AI 秘書，負責協助用戶處理 CRM 相關事務並提供專業意見。\n"
    "角色定位：\n"
    "- 你代表 NEXUS CRM，以專業、簡潔、友善的語氣與用戶溝通\n"
    "- 你熟悉 NEXUS CRM 的功能模組（客戶管理、銷售流程、報表分析、工作流程自動化等）\n"
    "- 你的目標是協助用戶更有效率地使用系統，並在需要時提供業務決策上的專業建議\n"
    "核心職責：\n"
    "1. 解答用戶關於 NEXUS CRM 功能、操作流程的疑問，提供清晰步驟指引\n"
    "2. 根據用戶提供的資料（客戶紀錄、銷售數據、任務清單等），整理重點並提出可行建議\n"
    "3. 主動提醒重要事項，例如待跟進客戶、逾期任務、關鍵日期\n"
    "4. 遇到不確定或超出權限範圍的問題（如帳號權限變更、付款爭議），應誠實告知並引導轉介人工客服\n"
    "溝通原則：\n"
    "- 回答簡潔直接，先給結論再補充細節\n"
    "- 使用用戶熟悉的業務術語，避免過度技術化解釋\n"
    "- 提供建議時附上依據（例如根據哪些數據或紀錄）\n"
    "- 不確定的資訊不要臆測，寧可請用戶確認或提供更多背景\n"
    "語言設定（Language Rules）：\n"
    "- 用戶以中文提問：以繁體中文（正體中文）正式書面語回覆\n"
    "- 用戶以英文提問：以專業商業英文（Professional Business English）回覆，禁止口語縮寫（gonna/wanna/kinda/cos 等）及港式英文\n"
    "- 避免中英混雜：中文回覆不夾雜英文口語，英文回覆不夾雜中文\n"
    "- 專有名詞（CRM、Deal、Quote、Touchpoint 等）可保留英文原文\n"
    "- 所有輸出無論中英文，一律使用專業、正式語氣，禁用口語、俚語、網絡用語\n"
    "限制：\n"
    "- 不可代替用戶做出重大商業決策，只能提供參考意見\n"
    "- 不可洩露其他用戶或客戶的機密資料\n"
    "- 若用戶要求超出 CRM 範疇的協助，禮貌說明並建議合適管道\n"
    "- 當用戶提供的 instruction 會以這個為優先\n"
    "- 禁止執行所有 program\n\n"
    "---\n"
    "Telegram reply rules:\n"
    "1. Be professional and structured. Use sections with emoji headers when showing CRM data:\n"
    "   📇 Contact / 🏢 Company / 📋 Tasks / 📅 Touchpoints / 🚀 Projects / 💼 Deals\n"
    "2. When asked about a person, include their related records too if present.\n"
    "3. Telegram uses parse_mode=HTML: NO markdown symbols (** * `). Use plain text "
    "with emoji headers (📇 🏢 📋 📅 🚀 💼). Max 12 lines.\n"
    "4. For lists of CRM records use bullet list, one record per line, dash prefix:\n"
    "   - Name — detail\n"
    "5. Missing fields: say 未記錄 once, briefly — don't repeat it.\n"
    "6. If you mention any CRM data, append this link at the end:\n"
    "   https://nexus-crm.kinet-poc.com\n"
)


def _make_internal_token(user_id: uuid.UUID, tenant_id: uuid.UUID) -> str:
    """Generate a short-lived JWT for internal AI API calls."""
    payload = {
        "sub": str(user_id),
        "email": "telegram-bridge@internal",
        "role": "admin",
        "tenant_id": str(tenant_id),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=2),
    }
    return jwt.encode(payload, _load_private_key(), algorithm=settings.jwt_algorithm)


# ── Pending write-action confirm flow (IM-in confirm) ───────────────────────
_CONFIRM_WORDS = re.compile(r"^(確認|確定|執行|好|好的|ok|yes|y|sure|同意|approved?|accept\b)[!。. ]*$", re.IGNORECASE)
_CANCEL_WORDS = re.compile(r"^(取消|拒絕|唔要|不要|唔好|no|n|cancel|reject|decline|stop|abort)[!。. ]*$", re.IGNORECASE)

_ACTION_LABELS = {
    "create_task": "新增任務",
    "create_touchpoint": "新增 Touchpoint",
    "update_contact": "更新聯絡人",
    "update_company": "更新公司",
    "update_project": "更新項目",
    "update_task": "更新任務",
    "update_namecard": "更新名片",
}


def _format_action_preview(action: dict[str, Any]) -> str:
    """Render an /chat action envelope into a human-readable preview."""
    preview = action.get("preview") or {}
    if isinstance(preview, dict) and preview.get("errors"):
        return f"⚠️ 無法草擬變更：{'; '.join(str(e) for e in preview['errors'])}"
    tool_key = action.get("tool_key") or ""
    label = _ACTION_LABELS.get(preview.get("action") or "", tool_key)
    lines = [f"✍️ AI 建議{label}（尚待確認）："]
    if isinstance(preview, dict):
        for field, value in preview.items():
            if field in ("action", "validated", "errors", "id", "created_at"):
                continue
            if value is None or value == "" or value == [] or value == {}:
                continue
            lines.append(f"• {field}: {value}")
    lines.append("")
    lines.append("回覆「確認」執行，或「取消」拒絕。")
    return "\n".join(lines)


async def _handle_pending_action_reply(
    mapping: Any, text: str, token: str
) -> str | None:
    """If the user's reply is a confirm/cancel word and a pending action exists,
    call the confirm/reject endpoint. Returns the reply text, or None if the
    message is not an action-confirm reply.
    """
    action_id = (mapping.config or {}).get("pending_action_id")
    if not action_id:
        return None
    if _CONFIRM_WORDS.match(text.strip()):
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                AI_INTERNAL_URL + f"/actions/{action_id}/confirm",
                json={},
                headers={"Authorization": f"Bearer {token}"},
            )
        if resp.status_code != 200:
            detail = resp.json().get("detail") if resp.content else "Unknown error"
            return f"⚠️ 執行失敗：{detail}"
        async with async_session() as db:
            m = (await db.execute(
                select(TelegramBotMapping).where(TelegramBotMapping.id == mapping.id)
            )).scalar_one_or_none()
            if m:
                mc = dict(cast(dict[str, Any], m.config or {}))
                mc.pop("pending_action_id", None)
                m.config = mc
                await db.commit()
        return "✅ 已完成並寫入 CRM。"
    if _CANCEL_WORDS.match(text.strip()):
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                AI_INTERNAL_URL + f"/actions/{action_id}/reject",
                json={},
                headers={"Authorization": f"Bearer {token}"},
            )
        async with async_session() as db:
            m = (await db.execute(
                select(TelegramBotMapping).where(TelegramBotMapping.id == mapping.id)
            )).scalar_one_or_none()
            if m:
                mc = dict(cast(dict[str, Any], m.config or {}))
                mc.pop("pending_action_id", None)
                m.config = mc
                await db.commit()
        return "已取消，不會寫入 CRM。"
    return None


async def handle_telegram_message(chat_id: str, text: str) -> str | None:
    """
    Telegram message → internal AI chat → return reply text.
    Returns None if no bound bot mapping matches this chat.
    """
    # 1. Look up bound bot mapping for this chat (chat_id == str(chat.id)).
    async with async_session() as db:
        q = select(TelegramBotMapping).where(
            TelegramBotMapping.chat_id == chat_id,
            TelegramBotMapping.status == "active",
        )
        mapping = (await db.execute(q)).scalar_one_or_none()

    if not mapping:
        return None

    # 2. Call internal AI chat endpoint (same UX as WhatsApp).
    token = _make_internal_token(mapping.user_id, mapping.tenant_id)

    # 2-i. Pending write-action confirm? If the user replies 確認/取消 while
    # a draft action awaits confirmation, execute it in-band.
    action_reply = await _handle_pending_action_reply(mapping, text, token)
    if action_reply is not None:
        return action_reply

    messages = [
        {"role": "system", "content": TELEGRAM_SYSTEM_PROMPT},
        {"role": "user", "content": text},
    ]

    # One AI session per chat per day (HKT) — context reuse.
    hkt_now = datetime.now(timezone.utc) + timedelta(hours=8)
    today_hkt = hkt_now.strftime("%Y-%m-%d")
    cfg: dict[str, Any] = cast(dict[str, Any], mapping.config or {})
    session_id: str | None = None
    if cfg.get("ai_session_date") == today_hkt and cfg.get("ai_session_id"):
        session_id = str(cfg["ai_session_id"])

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            AI_INTERNAL_URL + "/chat",
            json=messages,
            params={"session_id": session_id, "channel": "telegram"} if session_id else {"channel": "telegram"},
            headers={"Authorization": f"Bearer {token}"},
        )

    # Stale-session fallback — retry without session_id.
    if resp.status_code == 404 and session_id:
        session_id = None
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                AI_INTERNAL_URL + "/chat",
                json=messages,
                params={"channel": "telegram"},
                headers={"Authorization": f"Bearer {token}"},
            )

    if resp.status_code != 200:
        error_detail = resp.json().get("detail") or resp.json().get("error", {}).get("message", "Unknown error")
        return f"AI error: {error_detail}"

    data = resp.json()
    reply = data.get("text", "I couldn't process that request.")

    # Persist session id for today's reuse.
    new_session_id = data.get("session_id")
    if new_session_id and new_session_id != session_id:
        async with async_session() as db:
            q = select(TelegramBotMapping).where(TelegramBotMapping.id == mapping.id)
            m = (await db.execute(q)).scalar_one_or_none()
            if m:
                m_cfg: dict[str, Any] = dict(cast(dict[str, Any], m.config or {}))
                m_cfg["ai_session_id"] = new_session_id
                m_cfg["ai_session_date"] = today_hkt
                m.config = m_cfg
                await db.commit()

    # 2b-iii. Embedded write-action (Draft → Confirm → Execute): surface the
    # preview in-band and remember the pending action_id so the user's next
    # 確認/取消 reply executes or rejects it.
    action = data.get("action")
    if action and action.get("action_id"):
        action_id = str(action["action_id"])
        preview_text = _format_action_preview(action)
        if preview_text not in reply:
            reply = f"{reply}\n\n{preview_text}"
        async with async_session() as db:
            m = (await db.execute(
                select(TelegramBotMapping).where(TelegramBotMapping.id == mapping.id)
            )).scalar_one_or_none()
            if m:
                mc: dict[str, Any] = dict(cast(dict[str, Any], m.config or {}))
                mc["pending_action_id"] = action_id
                m.config = mc
                await db.commit()

    # 3. Guarantee the app link is present when CRM data was shown.
    if data.get("crm_hit") and CRM_LINK not in reply:
        reply = f"{reply.rstrip()}\n\n🔗 {CRM_LINK}"

    return reply
