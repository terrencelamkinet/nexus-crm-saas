"""
Telegram AI Bridge — connects Telegram bot messages to the NEXUS AI engine.

Design (mirrors whatsapp_ai_bridge):
  - Telegram getUpdates long-polling (no public webhook URL needed)
  - Each inbound user message → internal AI chat (/api/v1/ai/chat) with the
    user's own SecretarySettings (tone / instructions / lang_pref) injected
    into the system prompt — per-user AI personality.
  - Reply sent back via sendMessage. Session persisted per chat per day so
    the AI remembers the conversation (same pattern as WhatsApp).

SOC 2:
  - CC6.1: Internal JWT (2min expiry) for cross-service AI calls
  - CC6.6: All internal calls via localhost
  - CC7.2: All AI interactions routed through platform's audit trail
"""
import uuid
import json
import logging
import os
import re
import subprocess
import tempfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import httpx
from jose import jwt
from sqlalchemy import select

from app.config import settings
from app.db import async_session
from app.models.telegram_bot import TelegramBotMapping
from app.models.ai.secretary_settings import SecretarySettings, ChannelCredential
from app.services.auth_service import _load_private_key
from app.services import telegram_service
from app.services import namecard_im

# NameCard pipeline helper (OCR detect + upload → G08 CRM)
NAMECARD_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "upload_namecard_to_g08.py"
PENDING_DIR = Path(__file__).resolve().parents[2] / "uploads" / "namecards" / "pending"
# Run the helper with the backend venv python so OpenCV/tesseract deps resolve
VENV_PY = Path(__file__).resolve().parents[2] / "venv" / "bin" / "python3"

AI_INTERNAL_URL = "http://localhost:8001/api/v1/ai"

# Telegram reply guidelines — base personality, then per-user tone/instructions
# appended from SecretarySettings. AI router strips client system messages, so
# this is prefixed into the user content (same approach as WhatsApp bridge).
TELEGRAM_BASE_PROMPT = (
    "你是 NEXUS CRM 的專屬 AI 秘書，負責協助用戶處理 CRM 相關事務並提供專業意見。\n"
    "角色定位：\n"
    "- 你代表 NEXUS CRM，以專業、簡潔、友善的語氣與用戶溝通\n"
    "- 你熟悉 NEXUS CRM 的功能模組（客戶管理、銷售流程、報表分析、工作流程自動化等）\n"
    "- 你的目標是協助用戶更有效率地使用系統，並在需要時提供業務決策上的專業建議\n"
    "核心職責：\n"
    "1. 解答用戶關於 NEXUS CRM 功能、操作流程的疑問，提供清晰步驟指引\n"
    "2. 根據用戶提供的資料（客戶紀錄、銷售數據、任務清單等），整理重點並提出可行建議\n"
    "3. 主動提醒重要事項，例如待跟進客戶、逾期任務、關鍵日期\n"
    "4. 遇到不確定或超出權限範圍的問題，應誠實告知並引導轉介人工客服\n"
    "溝通原則：\n"
    "- 回答簡潔直接，先給結論再補充細節\n"
    "- 使用用戶熟悉的業務術語，避免過度技術化解釋\n"
    "- 提供建議時附上依據（例如根據哪些數據或紀錄）\n"
    "- 不確定的資訊不要臆測，寧可請用戶確認或提供更多背景\n"
    "語言設定：\n"
    "- 用戶以中文提問：以繁體中文（正體中文）正式書面語回覆\n"
    "- 用戶以英文提問：以專業商業英文（Professional Business English）回覆\n"
    "- 避免中英混雜：中文回覆不夾雜英文口語，英文回覆不夾雜中文\n"
    "- 專有名詞（CRM、Deal、Quote、Touchpoint 等）可保留英文原文\n"
    "限制：\n"
    "- 不可代替用戶做出重大商業決策，只能提供參考意見\n"
    "- 不可洩露其他用戶或客戶的機密資料\n"
    "- 若用戶要求超出 CRM 範疇的協助，禮貌說明並建議合適管道\n"
    "---\n"
    "Telegram reply rules:\n"
    "1. Be professional and structured. Use sections with emoji headers when showing CRM data:\n"
    "   📇 Contact / 🏢 Company / 📋 Tasks / 📅 Touchpoints / 🚀 Projects / 💼 Deals\n"
    "2. When asked about a person, include their related records too (company, tasks, touchpoints, projects) if present.\n"
    "3. Format: NO markdown symbols at all — no **, no *, no backticks. Use emoji headers and plain text only. Max 12 lines.\n"
    "4. For lists of CRM records use bullet list, one record per line, dash prefix:\n"
    "   - Name — detail\n"
    "5. Missing fields: say 未記錄 once, briefly — don't repeat it for every field.\n"
    "6. If you mention any CRM data (contacts/companies/deals), append this link at the end:\n"
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


def _build_system_prompt(settings_row: SecretarySettings | None) -> str:
    """Base prompt + per-user tone / instructions / lang preference."""
    prompt = TELEGRAM_BASE_PROMPT
    if settings_row is None:
        return prompt

    tone = settings_row.tone or "professional"
    instructions = (settings_row.instructions or "").strip()
    lang = settings_row.lang_pref or "zh-HK"

    lang_rule = {
        "zh-HK": "語言：以廣東話/繁體中文回覆（口語自然，唔好用書面語硬繃繃）。",
        "zh-TW": "語言：以繁體中文（正體中文）正式書面語回覆。",
        "en": "語言：以 Professional Business English 回覆，禁止口語縮寫及港式英文。",
    }.get(lang, "語言：以繁體中文正式書面語回覆。")

    tone_rule = {
        "professional": "語氣：專業、簡潔、正式。",
        "friendly": "語氣：友善、親切、輕鬆但保持專業。",
        "direct": "語氣：直接了當，唔兜圈，講重點。",
        "encouraging": "語氣：正面、鼓勵性，同時保持客觀。",
        "formal": "語氣：非常正式，書面語，適合高層匯報。",
    }.get(tone, "語氣：專業、簡潔、正式。")

    extra = f"\n用戶額外指示（必須遵守）：{instructions}" if instructions else ""
    return f"{prompt}\n\n---\n用戶個人設定：\n{tone_rule}\n{lang_rule}{extra}"


async def _resolve_settings(db, mapping: TelegramBotMapping) -> SecretarySettings | None:
    row = (
        await db.execute(
            select(SecretarySettings).where(SecretarySettings.user_id == mapping.user_id)
        )
    ).scalar_one_or_none()
    return row


async def handle_telegram_message(mapping: TelegramBotMapping, text: str) -> str | None:
    """Telegram message → internal AI chat → return reply text. None if no reply."""
    async with async_session() as db:
        # Re-fetch mapping to get fresh config (session id may have been updated)
        fresh = (
            await db.execute(
                select(TelegramBotMapping).where(TelegramBotMapping.id == mapping.id)
            )
        ).scalar_one_or_none()
        if fresh is None:
            return None
        mapping = fresh

        settings_row = await _resolve_settings(db, mapping)
        system_prompt = _build_system_prompt(settings_row)

        # Reuse today's session (HKT) so the AI remembers the conversation
        hkt_now = datetime.now(timezone.utc) + timedelta(hours=8)
        today_hkt = hkt_now.strftime("%Y-%m-%d")
        cfg: dict[str, Any] = dict(mapping.config or {})
        session_id: str | None = None
        if cfg.get("ai_session_date") == today_hkt and cfg.get("ai_session_id"):
            session_id = str(cfg["ai_session_id"])

    token = _make_internal_token(mapping.user_id, mapping.tenant_id)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Question: {text}"},
    ]

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            AI_INTERNAL_URL + "/chat",
            json=messages,
            params={"session_id": session_id} if session_id else None,
            headers={"Authorization": f"Bearer {token}"},
        )

    # Stale-session fallback — retry without session_id (same as WhatsApp)
    if resp.status_code == 404 and session_id:
        session_id = None
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                AI_INTERNAL_URL + "/chat",
                json=messages,
                headers={"Authorization": f"Bearer {token}"},
            )

    if resp.status_code != 200:
        try:
            error_detail = resp.json().get("detail") or resp.json().get("error", {}).get("message", "Unknown error")
        except Exception:
            error_detail = f"HTTP {resp.status_code}"
        return f"⚠️ AI 暫時冇回應（{error_detail}）。請稍後再試。"

    data = resp.json()
    reply = data.get("text") or "抱歉，我暫時未能處理呢個請求。"

    # Persist session id for today's reuse
    new_session_id = data.get("session_id")
    if new_session_id and new_session_id != session_id:
        async with async_session() as db:
            m = (
                await db.execute(
                    select(TelegramBotMapping).where(TelegramBotMapping.id == mapping.id)
                )
            ).scalar_one_or_none()
            if m:
                m_cfg: dict[str, Any] = dict(m.config or {})
                m_cfg["ai_session_id"] = new_session_id
                m_cfg["ai_session_date"] = today_hkt
                m.config = m_cfg
                await db.commit()

    return reply


async def _get_bot_token(db, mapping: TelegramBotMapping) -> str:
    """Bot token: ChannelCredential (encrypted store) preferred, fall back to
    mapping.bot_token (legacy rows where the credential write failed).

    NOTE: ChannelCredential query previously crashed the whole poller with
    `invalid input syntax for type uuid: ""` (empty-string UUID params in
    some tenant rows) — wrapped in try/except so a credential-store hiccup
    can never take down Telegram inbound processing again.
    """
    try:
        cred = (
            await db.execute(
                select(ChannelCredential).where(
                    ChannelCredential.tenant_id == mapping.tenant_id,
                    ChannelCredential.user_id == mapping.user_id,
                    ChannelCredential.channel == "telegram",
                )
            )
        ).scalar_one_or_none()
        if cred and cred.access_token:
            return cred.access_token
    except Exception:  # noqa: BLE001 — credential store must never block inbound
        import logging
        logging.getLogger("telegram_inbound").exception(
            "ChannelCredential lookup failed for bot %s — falling back to mapping token",
            mapping.bot_username,
        )
    tok = str(mapping.bot_token or "")
    return tok if tok and tok != "None" else ""


async def _download_photo(token: str, photo_sizes: list[dict]) -> str | None:
    """Download the largest photo size → temp file. Returns local path or None."""
    if not photo_sizes:
        return None
    largest = max(photo_sizes, key=lambda p: p.get("file_size", 0) or 0)
    file_id = largest.get("file_id")
    if not file_id:
        return None
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            info = (await client.post(
                f"https://api.telegram.org/bot{token}/getFile",
                json={"file_id": file_id},
            )).json()
        file_path = (info.get("result") or {}).get("file_path")
        if not file_path:
            return None
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(f"https://api.telegram.org/file/bot{token}/{file_path}")
        if resp.status_code != 200:
            return None
        PENDING_DIR.mkdir(parents=True, exist_ok=True)
        tmp = PENDING_DIR / f"pending_{uuid.uuid4().hex[:12]}.jpg"
        tmp.write_bytes(resp.content)
        return str(tmp)
    except Exception:
        return None


async def _handle_photo(mapping: TelegramBotMapping, token: str, photo_sizes: list[dict]) -> str | None:
    """Photo message → detect namecard → store pending → ask user."""
    path = await _download_photo(token, photo_sizes)
    if not path:
        return "⚠️ 圖片下載失敗，請再試一次。"

    det = namecard_im.run_script(["--detect", path])
    if not det.get("is_namecard"):
        # Clean up non-namecard image
        try:
            os.remove(path)
        except OSError:
            pass
        return None  # Not a namecard — no reply (plain photo)

    # Store pending upload path in mapping config for the "係/是" follow-up
    # Preview: use parsed name + company when available (friendlier than raw OCR)
    preview = (det.get("ocr_preview") or "")[:80]
    async with async_session() as db:
        m = (
            await db.execute(
                select(TelegramBotMapping).where(TelegramBotMapping.id == mapping.id)
            )
        ).scalar_one_or_none()
        if m:
            m_cfg: dict[str, Any] = dict(m.config or {})
            m_cfg["pending_namecard_path"] = path
            m_cfg["pending_namecard_preview"] = preview
            m.config = m_cfg
            await db.commit()

    # Try to extract a clean name/company for the confirmation message
    try:
        from app.services.namecard_ocr import parse_namecard, ocr_image
        det_txt = det.get("ocr_preview") or ""
        # Re-OCR full text for parse (detect only returns preview)
        full_txt = ocr_image(path)
        parsed = parse_namecard(full_txt or det_txt)
        p_name = parsed.get("name") or ""
        p_company = parsed.get("company") or ""
        if p_name:
            preview = f"{p_name}" + (f" · {p_company}" if p_company else "")
        elif det_txt:
            preview = det_txt[:80]
    except Exception:
        pass

    return (
        f"📇 偵測到名片：{preview}\n\n"
        f"需要上載到名片庫嗎？（自動 OCR + 存入 CRM 聯絡人）\n"
        f"回覆「係」上載，或「唔使」取消"
    )


async def _handle_namecard_confirm(mapping: TelegramBotMapping, text: str) -> str | None:
    """User replied '係/是/好/yes' after a namecard photo → run upload pipeline."""
    low = text.strip().lower()
    YES = {"係", "是", "好", "yes", "y", "ok", "可以", "上載", "上傳", "upload"}
    NO = {"唔使", "不用", "no", "n", "取消", "cancel", "不要", "唔好"}
    is_yes = low in YES or low in {w.lower() for w in YES}
    is_no = low in NO or low in {w.lower() for w in NO}
    if not is_yes and not is_no:
        return None  # not a confirmation — treat as normal message

    async with async_session() as db:
        m = (
            await db.execute(
                select(TelegramBotMapping).where(TelegramBotMapping.id == mapping.id)
            )
        ).scalar_one_or_none()
        if not m:
            return None
        cfg: dict[str, Any] = dict(m.config or {})
        pending = cfg.get("pending_namecard_path")
        # Clear pending immediately (single-use)
        for k in ("pending_namecard_path", "pending_namecard_preview"):
            cfg.pop(k, None)
        m.config = cfg
        await db.commit()

    if is_no:
        if pending:
            try:
                os.remove(pending)
            except OSError:
                pass
        return "✅ 已取消，名片唔會上載。"
    if not pending or not os.path.isfile(pending):
        return None  # no pending namecard — treat as normal message

    res = namecard_im.run_script(["--upload", pending])
    try:
        os.remove(pending)
    except OSError:
        pass

    msg, review_state = namecard_im.format_upload_result(res)
    # Review tier: remember the card so 「覆蓋/保留」can resolve it
    if review_state.get("card_id"):
        async with async_session() as db:
            m = (
                await db.execute(
                    select(TelegramBotMapping).where(TelegramBotMapping.id == mapping.id)
                )
            ).scalar_one_or_none()
            if m:
                cfg2: dict[str, Any] = dict(m.config or {})
                cfg2["pending_review_card_id"] = review_state["card_id"]
                m.config = cfg2
                await db.commit()
    return msg


async def _handle_namecard_review_reply(mapping: TelegramBotMapping, text: str) -> str | None:
    """User replied '覆蓋/保留' to a review-status card → resolve via API."""
    is_ow = namecard_im.match_intent(text, namecard_im.OVERWRITE_WORDS)
    is_kp = namecard_im.match_intent(text, namecard_im.KEEP_WORDS)
    if not is_ow and not is_kp:
        return None  # not a review reply — treat as normal message

    card_id = ""
    async with async_session() as db:
        m = (
            await db.execute(
                select(TelegramBotMapping).where(TelegramBotMapping.id == mapping.id)
            )
        ).scalar_one_or_none()
        if not m:
            return None
        cfg: dict[str, Any] = dict(m.config or {})
        card_id = cfg.get("pending_review_card_id") or ""
        cfg.pop("pending_review_card_id", None)
        m.config = cfg
        await db.commit()

    if not card_id:
        return None  # no pending review — treat as normal message

    action = "overwrite" if is_ow else "keep_both"
    res = namecard_im.run_script(["--resolve", card_id, action])
    return namecard_im.format_resolve_result(res, action)


async def process_update(mapping: TelegramBotMapping, update: dict) -> None:
    """Process one Telegram update: extract message → AI reply → send back."""
    msg = update.get("message") or update.get("edited_message")
    if not msg:
        return
    text = (msg.get("text") or "").strip()
    chat_id = str(msg.get("chat", {}).get("id", ""))
    if not chat_id:
        return
    # Ignore our own outgoing messages (bot echo)
    if msg.get("from", {}).get("is_bot"):
        return

    async with async_session() as db:
        token = await _get_bot_token(db, mapping)
    if not token:
        return

    # Namecard photo flow
    if not text and msg.get("photo"):
        reply = await _handle_photo(mapping, token, msg["photo"])
        if reply:
            await telegram_service.send_message(token, chat_id, reply)
        return

    # Namecard confirmation flow (係/唔使 after a photo)
    if text:
        confirm_reply = await _handle_namecard_confirm(mapping, text)
        if confirm_reply is not None:
            await telegram_service.send_message(token, chat_id, confirm_reply)
            return

    # Namecard review flow (覆蓋/保留 after a duplicate warning)
    if text:
        review_reply = await _handle_namecard_review_reply(mapping, text)
        if review_reply is not None:
            await telegram_service.send_message(token, chat_id, review_reply)
            return

    reply = await handle_telegram_message(mapping, text)
    if not reply:
        return

    result = await telegram_service.send_message(token, chat_id, reply)
    if not result.get("ok"):
        # Log failure, don't crash the poller
        import logging
        logging.getLogger("telegram_inbound").warning(
            "send failed: %s", result.get("description", "unknown")
        )


async def poll_once(db) -> int:
    """One polling pass: fetch updates for every active bot, process them.
    Returns number of updates processed. Used by the lifespan background task."""
    mappings = (
        await db.execute(
            select(TelegramBotMapping).where(TelegramBotMapping.status == "active")
        )
    ).scalars().all()
    processed = 0
    for mapping in mappings:
        token = await _get_bot_token(db, mapping)
        if not token:
            continue

        cfg: dict[str, Any] = dict(mapping.config or {})
        offset = cfg.get("tg_update_offset")
        try:
            data = await telegram_service.get_updates(token, offset=offset, timeout=1)
        except Exception as e:  # noqa: BLE001 — network errors must not kill the poller silently
            logging.getLogger("telegram_inbound").warning(
                "get_updates failed for %s (offset=%s): %s", mapping.bot_username, offset, e
            )
            continue
        if not data.get("ok"):
            # Telegram returns ok=false on 409 conflict / 401 / 429 / network blips.
            # A delivered-but-unconfirmed update is NOT re-sent with the same offset,
            # so a single failed poll can permanently lose a message — log loudly.
            logging.getLogger("telegram_inbound").warning(
                "get_updates !ok for %s (offset=%s): %s",
                mapping.bot_username, offset, data.get("description", data),
            )
            continue

        updates = data.get("result", [])
        for upd in updates:
            try:
                await process_update(mapping, upd)
            except Exception as e:  # noqa: BLE001 — per-update isolation
                import logging
                logging.getLogger("telegram_inbound").exception(
                    "process_update failed for update %s: %s", upd.get("update_id"), e
                )
                continue

        if updates:
            last_id = updates[-1]["update_id"]
            async with async_session() as db2:
                m = (
                    await db2.execute(
                        select(TelegramBotMapping).where(TelegramBotMapping.id == mapping.id)
                    )
                ).scalar_one_or_none()
                if m:
                    m_cfg: dict[str, Any] = dict(m.config or {})
                    m_cfg["tg_update_offset"] = last_id + 1
                    m.config = m_cfg
                    await db2.commit()
            processed += len(updates)
    return processed


async def handle_webhook_update(data: dict) -> None:
    """Background processor for webhook-delivered updates (fast-ACK pattern).

    Telegram pushes the update here; the HTTP handler ACKs immediately and
    this runs in a background task. Idempotency via tg_last_webhook_update_id
    so Telegram retries (caused by slow ACK) never double-process.
    """
    import logging as _log
    try:
        async with async_session() as db:
            mapping = (
                await db.execute(
                    select(TelegramBotMapping).where(TelegramBotMapping.status == "active")
                )
            ).scalars().first()
            if not mapping:
                _log.getLogger("telegram_inbound").warning(
                    "webhook update received but no active bot mapping"
                )
                return
            upd_id = data.get("update_id")
            cfg: dict[str, Any] = dict(mapping.config or {})
            last_id = cfg.get("tg_last_webhook_update_id")
            if upd_id is not None and last_id is not None and upd_id <= last_id:
                return  # duplicate delivery (Telegram retry) — already processed
            await process_update(mapping, data)
            if upd_id is not None:
                cfg["tg_last_webhook_update_id"] = upd_id
                mapping.config = cfg
                await db.commit()
    except Exception:  # noqa: BLE001 — one bad update must not kill the webhook path
        _log.getLogger("telegram_inbound").exception(
            "webhook update processing failed: %s", str(data)[:200]
        )
