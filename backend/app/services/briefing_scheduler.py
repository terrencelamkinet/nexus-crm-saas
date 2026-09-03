"""
Briefing Scheduler — per-user greeting-slot driven daily summary push.

Design (mirrors GG notification pattern: scheduler polls DATA, not hardcoded
times):
  - Source of truth: ai_secretary_settings.greeting_slots (per-user start
    times set in the AI app UI — every user can differ, e.g. 05:00 vs 07:00).
  - A single cron runs this every 15 minutes. For each user+slot that is
    DUE now (start time reached, within a 3h window), it generates the
    briefing and pushes via Telegram (fallback WhatsApp).
  - Dedup: push_log row for (user, channel, slot, date) with status='sent'
    → skip. GG uses a state file; G08 uses its own push_log table.

Fully independent of the GG-Fighter stack — own DB, own Telegram creds.

CLI: python -m app.services.briefing_scheduler
"""
from __future__ import annotations

import asyncio
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

from sqlalchemy import select, text

# Allow running as script from backend/ dir
BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.db import async_session  # noqa: E402
from app.models.ai.secretary_settings import SecretarySettings, ChannelCredential, normalize_modules  # noqa: E402
from app.models.telegram_bot import TelegramBotMapping  # noqa: E402
from app.models.im_push import PushLog, IMDeliveryPref  # noqa: E402
from app.services.secret_crypto import decrypt_secret  # noqa: E402
from app.services import telegram_service, whatsapp_service  # noqa: E402
from app.models.whatsapp import WhatsAppMapping  # noqa: E402
from app.models.bible_reading import BibleReadingProgress  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker  # noqa: E402
from app.config import settings  # noqa: E402

HKT = timezone(timedelta(hours=8))
DUE_WINDOW_MIN = 180  # push if now within 3h after slot start (cron tolerance)

# Scheduler runs with a BYPASSRLS role so it can see ALL users' settings
# (RLS would otherwise hide every row — the app GUCs are unset here).
_sched_engine = create_async_engine(
    settings.briefing_database_url or settings.database_url,
    connect_args={"prepared_statement_cache_size": 0},
    pool_pre_ping=True,
    pool_size=2,
    max_overflow=5,
)
_sched_session = async_sessionmaker(_sched_engine, expire_on_commit=False)

# greeting_slots key → briefing slot key + compose intent
SLOT_MAP = {
    "morning": "morning",
    "afternoon": "noon",
    "evening": "evening",
    "lateNight": "night",
}

# bible_reading custom push time（push_time_mode=custom）— time_of_day → 指定時間
# 固定時間點：早晨 07:00 / 午間 12:00 / 傍晚 18:00 / 夜晚 22:00
BIBLE_SLOT_TIMES = {
    "morning": "07:00",
    "noon": "12:00",
    "evening": "18:00",
    "night": "22:00",
}

# slot key → emoji + 中文 label（同 briefing_generator.SLOT_PROMPTS 一致）
_SLOT_META = {
    "morning": ("🌅", "早安"),
    "noon": ("☀️", "午安"),
    "evening": ("🌆", "晚安"),
    "night": ("🌙", "深夜"),
}

# Telegram sendMessage 上限 4096 chars — 留 buffer 避免 API reject
_MAX_IM_LEN = 4000


def _style_for_channel(content: str, channel: str, slot: str, now: datetime, header: str | None = None) -> str:
    """Convert briefing content to the target IM's message style.

    Telegram（高密度、時間放最前、少隔行、冇 table — 跟 telegram-mobile-format）：
      - 第一行加 `🕐 HH:MM · 🌅 早安` header（時間放最前；`header` 參數可覆蓋，
        例如分類推送用「🕐 HH:MM · 🔔 通知」）
      - 剝走 content 開頭重複嘅 emoji title（LLM 已出「🌅 早安」）
      - 壓縮連續空行 → 最多 1 個
      - `|` 分隔嘅 table 行 → bullet（Telegram 唔 support table）
      - 截斷到 4000 chars
    WhatsApp 等：淨係壓空行 + 截斷（寬鬆啲，保留原文）。

    其他 channel（未支援）：原樣返回。
    """
    text = (content or "").strip()
    if not text:
        return text
    # 壓縮連續空行（高密度）→ 最多保留 1 個
    text = re.sub(r"\n{2,}", "\n", text)
    # strip 每行頭尾空白
    text = "\n".join(line.strip() for line in text.splitlines()).strip()
    if channel != "telegram":
        return text[:_MAX_IM_LEN] if len(text) > _MAX_IM_LEN else text

    if header is None:
        emoji, label = _SLOT_META.get(slot, ("📋", "簡報"))
        header = f"🕐 {now.strftime('%H:%M')} · {emoji} {label}"
        # 剝走 content 開頭重複嘅 emoji+label title（「🌅 早安」/「🌅早安」）
        for e2, l2 in _SLOT_META.values():
            for prefix in (f"{e2} {l2}", f"{e2}{l2}"):
                if text.startswith(prefix):
                    text = text[len(prefix):].lstrip("\n:： ")
                    break
    text = f"{header}\n{text}"
    # Telegram 唔 support table — 兩格以上 | 嘅行轉 bullet
    text = "\n".join(
        ("• " + line.replace("|", " · ").strip("• ")) if line.count("|") >= 2 else line
        for line in text.splitlines()
    )
    return text[:_MAX_IM_LEN] if len(text) > _MAX_IM_LEN else text


def _now_hkt() -> datetime:
    return datetime.now(HKT)


def _minutes(dt: datetime) -> int:
    return dt.hour * 60 + dt.minute


def _is_due(now: datetime, start_hhmm: str) -> bool:
    """True if slot start time has been reached within the due window."""
    try:
        h, m = (int(x) for x in start_hhmm.split(":"))
    except (ValueError, AttributeError):
        return False
    start_min = h * 60 + m
    now_min = _minutes(now)
    diff = (now_min - start_min) % (24 * 60)
    # Due when now >= start and within window; handles lateNight crossing
    # midnight (start 23:00, now 00:30 → diff 90 → due).
    return 0 <= diff < DUE_WINDOW_MIN


async def _already_processed(db, user_id, slot: str, now: datetime) -> bool:
    """True if this slot already attempted today (sent/skipped/failed).

    T0.1（2026-09-04）：語意由「sent」擴展做「任何結果」— 被 gate 擋
    （quiet_hours/slot_off/weekend_mute）或 push failed 都算已處理，唔可以
    令下一個 15-min tick regenerate 再燒 LLM call（9/3 實測：evening gate
    擋咗 → 每 15 min regenerate 13 次）。缺點：transient push failure 唔會
    自動 retry — 接受（寧願 miss 一次都唔好無限燒；聽日自然有新 briefing）。
    """
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    row = (
        await db.execute(
            select(PushLog.id).where(
                PushLog.user_id == user_id,
                PushLog.slot == slot,
                PushLog.status.in_(("sent", "skipped", "failed")),
                PushLog.sent_at >= day_start,
            ).limit(1)
        )
    ).scalar_one_or_none()
    return row is not None


def _hkt_weekend(now: datetime) -> bool:
    """True if `now` (HKT) falls on Sat/Sun."""
    return now.weekday() >= 5


def _in_quiet_hours(now: datetime, quiet_hours) -> bool:
    """True if `now` is inside the configured quiet hours window (handles overnight)."""
    try:
        start_s = (quiet_hours or {}).get("start", "22:00")
        end_s = (quiet_hours or {}).get("end", "08:00")
        start = datetime.strptime(start_s, "%H:%M").time()
        end = datetime.strptime(end_s, "%H:%M").time()
        t = now.time()
        return (start <= t <= end) if start <= end else (t >= start or t <= end)
    except (ValueError, AttributeError):
        return False


async def _working_hours_quiet_window(db, user, fallback: dict | None) -> dict:
    """Quiet window = outside Working Hours (AI Apps 設定).

    用戶 2026-08-25: quiet_hours 應該跟 AI Apps 嘅 Working Hours，
    唔係獨立嘅 hardcoded 22:00-08:00。Work start/end 由
    ai_secretary_settings.work_start / work_end 讀取（Time columns）。
    strict_silence=False（AI Apps untick Strict Silence Off-Hours）=
    ignore quiet time，任何時間都推。
    Edge case：工作時段 ≥23h（例如 00:00-23:59）= 幾乎全天工作 →
    冇靜音窗，返回 fallback 但 caller 會見到寬 window 照擋？唔會 —
    呢度直接返回 fallback（保持原行為）。
    """
    try:
        row = (
            await db.execute(
                select(SecretarySettings).where(
                    SecretarySettings.tenant_id == user.tenant_id,
                    SecretarySettings.user_id == user.user_id,
                )
            )
        ).scalar_one_or_none()
        if row and row.work_start and row.work_end:
            start_s = row.work_end.strftime("%H:%M")   # 工作結束 → 靜音開始
            end_s = row.work_start.strftime("%H:%M")   # 工作開始 → 靜音結束
            return {"start": start_s, "end": end_s, "strict_silence": bool(row.strict_silence)}
    except Exception:
        pass
    return {"start": "22:00", "end": "08:00", "strict_silence": True}


async def _channel_gate(db, user, channel: str, slot: str) -> str:
    """Return '' (allow) or a skip reason string when IMDeliveryPref blocks push.

    Honors user prefs: enabled / slots[slot] / weekend_mute / quiet_hours.  Missing
    pref row = Default ON (frictionless onboarding per IMDeliveryPref default
    enabled=True) unless a row explicitly disables the channel.
    """
    now = _now_hkt()
    try:
        pref = (
            await db.execute(
                select(IMDeliveryPref).where(
                    IMDeliveryPref.tenant_id == user.tenant_id,
                    IMDeliveryPref.user_id == user.user_id,
                    IMDeliveryPref.channel == channel,
                )
            )
        ).scalar_one_or_none()
    except Exception:
        return ""
    if pref is not None:
        if not pref.enabled:
            return "disabled"
        slots = pref.slots or {}
        if slots and not slots.get(slot):
            return "slot_off"
        if pref.weekend_mute and _hkt_weekend(now):
            return "weekend_mute"
        # 靜音時段跟 AI Apps Working Hours（用戶 2026-08-25）：
        # 非工作時段 = 靜音。morning slot 豁免（用戶明示想朝早收 briefing）。
        # strict_silence=False（AI Apps untick）→ ignore quiet time，照推。
        qh = await _working_hours_quiet_window(db, user, pref.quiet_hours)
        if qh.get("strict_silence", True) and _in_quiet_hours(now, qh) and slot != "morning":
            return "quiet_hours"
    return ""


# greeting slot key → bible time_of_day（SLOT_MAP 反向）
_GREETING_TO_TOD = {
    "morning": "morning",
    "afternoon": "noon",
    "evening": "evening",
    "lateNight": "night",
}


async def _advance_bible_progress(db, user, modules_raw, slot_key: str) -> None:
    """Push 成功後推進讀經進度（每日一章，用戶 2026-08-25）。

    只有 bible_reading 啟用 + 當前 slot 對應 bible time_of_day 先推進：
    - greeting mode：bible 只喺 time_of_day 指定 slot 出現（briefing_sources
      filter）→ 嗰個 slot push 成功就推進一次
    - custom mode（push_time_mode=custom）：bible-only push 成功就推進
    day_index += 1 + last_completed_at 更新，commit 由 caller（per-member
    commit）處理。
    """
    try:
        modules = normalize_modules(modules_raw)
        bopts = modules.get("bible_reading") or {}
        if not bopts:
            return
        tod = bopts.get("time_of_day", "morning")
        if bopts.get("push_time_mode") != "custom" and _GREETING_TO_TOD.get(slot_key) != tod:
            return
        plan = bopts.get("plan", "one_year")
        row = (
            await db.execute(
                select(BibleReadingProgress).where(
                    BibleReadingProgress.tenant_id == user.tenant_id,
                    BibleReadingProgress.user_id == user.user_id,
                    BibleReadingProgress.plan == plan,
                )
            )
        ).scalar_one_or_none()
        if row is not None:
            row.day_index += 1
            row.last_completed_at = datetime.now(timezone.utc)
            await db.flush()
    except Exception:
        pass


_CATEGORY_LABELS = {
    "notifications": "🔔 通知",
    "reminders": "⏰ 提醒",
    "info": "📰 資訊",
    "bible": "📖 聖經",
}


async def _push_telegram(db, user, slot: str, content: str, categories: dict | None = None) -> str:
    """Push via bound Telegram bot. Returns 'sent'|'skipped'|'failed'.

    categories 有值時按類別分開 send（每類一條 message — 用戶 2026-08-24：
    message 一次過太長睇唔到，按類別分類發送）。
    """
    # ⚠️ Caller（generate_briefing）已經 commit — transaction-local GUC 隨
    # transaction 完結消失，必須重新 set 先讀到 IMDeliveryPref / 寫 push_log
    # （兩者都有 RLS）。唔 set 嘅話 push_log INSERT 會 RLS violation → 永遠
    # 寫唔入 → _already_processed 永遠 False → 每 15 分鐘 regenerate。
    try:
        await db.execute(
            text("SELECT set_config('app.tenant_id', :t, true), set_config('app.user_id', :u, true)"),
            {"t": str(user.tenant_id), "u": str(user.user_id)},
        )
    except Exception:
        pass
    reason = await _channel_gate(db, user, "telegram", slot)
    if reason:
        db.add(PushLog(tenant_id=user.tenant_id, user_id=user.user_id, channel="telegram",
                       slot=slot, status="skipped", reason=reason))
        return "skipped"
    tg = (
        await db.execute(
            select(TelegramBotMapping).where(
                TelegramBotMapping.tenant_id == user.tenant_id,
                TelegramBotMapping.user_id == user.user_id,
                TelegramBotMapping.status == "active",
            )
        )
    ).scalar_one_or_none()
    if not tg:
        return "skipped"
    cred = (
        await db.execute(
            select(ChannelCredential).where(
                ChannelCredential.tenant_id == user.tenant_id,
                ChannelCredential.user_id == user.user_id,
                ChannelCredential.channel == "telegram",
            )
        )
    ).scalar_one_or_none()
    token = ""
    try:
        token = decrypt_secret(cred.access_token) if cred and cred.access_token else ""
    except Exception:
        # decrypt 失敗（key drift / token 損壞）→ fallback 去 mapping 嘅
        # plaintext bot_token，唔好令 push 靜默失敗（2026-08-25 InvalidTag）
        token = ""
    if not token:
        # Fallback: legacy plaintext token on the mapping row (credential
        # store may have never been populated for this bot).
        token = str(tg.bot_token or "")
        if token == "None":
            token = ""
    if not token:
        return "skipped"
    try:
        now = _now_hkt()
        if categories:
            # 按類別分開 send — 每類一條 message（🔔通知/⏰提醒/📰資訊/📖聖經）
            all_ok = True
            for cat_key in ("notifications", "reminders", "info", "bible"):
                body = (categories.get(cat_key) or "").strip()
                if not body:
                    continue
                label = _CATEGORY_LABELS.get(cat_key, cat_key)
                styled = _style_for_channel(
                    body, "telegram", slot, now,
                    header=f"🕐 {now.strftime('%H:%M')} · {label}",
                )
                result = await telegram_service.send_message(token, str(tg.chat_id), styled)
                if not (isinstance(result, dict) and result.get("ok")):
                    all_ok = False
            return "sent" if all_ok else "failed"
        styled = _style_for_channel(content, "telegram", slot, now)
        result = await telegram_service.send_message(token, str(tg.chat_id), styled)
        ok = isinstance(result, dict) and result.get("ok")
        return "sent" if ok else "failed"
    except Exception:
        return "failed"


async def _push_whatsapp(db, user, slot: str, content: str, categories: dict | None = None) -> str:
    """Fallback channel — only if no active Telegram mapping."""
    # 同 _push_telegram — caller commit 後 GUC 消失，重新 set（RLS）
    try:
        await db.execute(
            text("SELECT set_config('app.tenant_id', :t, true), set_config('app.user_id', :u, true)"),
            {"t": str(user.tenant_id), "u": str(user.user_id)},
        )
    except Exception:
        pass
    reason = await _channel_gate(db, user, "whatsapp", slot)
    if reason:
        db.add(PushLog(tenant_id=user.tenant_id, user_id=user.user_id, channel="whatsapp",
                       slot=slot, status="skipped", reason=reason))
        return "skipped"
    mapping = (
        await db.execute(
            select(WhatsAppMapping).where(
                WhatsAppMapping.tenant_id == user.tenant_id,
                WhatsAppMapping.user_id == user.user_id,
                WhatsAppMapping.status == "active",
            )
        )
    ).scalar_one_or_none()
    if not mapping:
        return "skipped"
    try:
        styled = _style_for_channel(content, "whatsapp", slot, _now_hkt())
        result = await whatsapp_service.send_text(mapping.wa_id, styled)
        ok = isinstance(result, dict) and result.get("messages")
        return "sent" if ok else "failed"
    except Exception:
        return "failed"


async def _generate_content(db, user, slot_key: str) -> tuple[str, dict]:
    """Compose briefing content via the existing generator.

    Returns (content, categories) — categories = {category_key: body} 俾
    scheduler 按類別分開發送（通知/提醒/資訊/聖經）。冇分類 tags 時 categories={}。

    skip_im_push=True: 推送由 scheduler 統一控制（Telegram primary + WhatsApp
    fallback，各自 channel gate）— 避免 generator 內部 WhatsApp push 同
    scheduler push 造成 double push。
    """
    from app.services.briefing_generator import generate_briefing

    # generate_briefing(db, tenant_id, user_id, slot) — slot is morning/noon/evening/night
    result = await generate_briefing(
        db, user.tenant_id, user.user_id,
        SLOT_MAP.get(slot_key, "morning"),
        skip_im_push=True,
    )
    content = result.get("content", "") if isinstance(result, dict) else ""
    categories = result.get("categories") or {} if isinstance(result, dict) else {}
    return content, categories


async def run_scheduler(dry_run: bool = False) -> dict:
    now = _now_hkt()
    stats = {"scanned": 0, "due": 0, "sent": 0, "skipped": 0, "failed": 0, "details": []}
    async with _sched_session() as db:
        # RLS: ai_secretary_settings uses user_isolation_settings policy
        # (user_id + tenant_id GUCs, FORCE RLS). A bare SELECT returns 0 rows.
        # Iterate all tenant/user memberships, set both GUCs per member.
        # Same pattern as notification_scan.scan_once.
        members = (
            await db.execute(
                text(
                    "SELECT tenant_id, user_id FROM nexus_auth.nexus_auth_tenant_members"
                )
            )
        ).fetchall()
        for tenant_id, user_id in members:
            await db.execute(
                text(
                    "SELECT set_config('app.tenant_id', :tid, true), "
                    "set_config('app.user_id', :uid, true)"
                ),
                {"tid": str(tenant_id), "uid": str(user_id)},
            )
            rows = (
                await db.execute(
                    text(
                        "SELECT user_id, tenant_id, greeting_slots, modules FROM nexus_ai.ai_secretary_settings"
                    )
                )
            ).fetchall()
            stats["scanned"] += len(rows)

            for r in rows:
                user_id, tenant_id = r[0], r[1]
                slots = r[2] or []
                modules_raw = r[3] if len(r) > 3 else None
                # Lightweight user shim for push helpers
                user = type("U", (), {"user_id": user_id, "tenant_id": tenant_id})()
                for slot_cfg in slots:
                    key = (slot_cfg or {}).get("key")
                    start = (slot_cfg or {}).get("start")
                    if not key or not start:
                        continue
                    if not _is_due(now, start):
                        continue
                    stats["due"] += 1
                    # Dedup per day — any channel sent for this slot today
                    if await _already_processed(db, user_id, key, now):
                        stats["skipped"] += 1
                        stats["details"].append(f"{str(user_id)[:8]} {key}: already sent")
                        continue
                    if dry_run:
                        stats["details"].append(f"{str(user_id)[:8]} {key}@{start}: DUE (dry)")
                        continue
                    content, categories = await _generate_content(db, user, key)
                    if not content:
                        # T0.1: empty 都要寫 push_log（skipped/empty_content）→
                        # _already_processed 下次 tick 擋住，唔好無限 regenerate
                        # 燒 LLM（SPEC edge case：空內容記 skipped + 已處理）
                        db.add(PushLog(
                            tenant_id=tenant_id, user_id=user_id,
                            channel="telegram", slot=key,
                            status="skipped", reason="empty_content",
                        ))
                        stats["skipped"] += 1
                        stats["details"].append(f"{str(user_id)[:8]} {key}: empty content")
                        continue
                    status = await _push_telegram(db, user, key, content, categories)
                    if status == "skipped":
                        status = await _push_whatsapp(db, user, key, content, categories)
                    db.add(PushLog(
                        tenant_id=tenant_id, user_id=user_id,
                        channel="telegram" if status != "skipped" else "whatsapp",
                        slot=key, status=status,
                        error="" if status == "sent" else (status if status == "failed" else "no_channel"),
                    ))
                    stats[status] += 1
                    stats["details"].append(f"{str(user_id)[:8]} {key}@{start}: {status}")
                    # 讀經進度推進：morning greeting push 成功 → 每日一章
                    if status == "sent":
                        await _advance_bible_progress(db, user, modules_raw, key)

                # bible_reading custom push time（唔跟 greeting schedule）→ 指定時間推 bible-only
                try:
                    modules = normalize_modules(modules_raw)
                    bopts = modules.get("bible_reading") or {}
                except Exception:
                    bopts = {}
                if bopts.get("push_time_mode") == "custom":
                    tod = bopts.get("time_of_day", "morning")
                    b_start = BIBLE_SLOT_TIMES.get(tod)
                    if b_start and _is_due(now, b_start):
                        b_slot = f"bible_{tod}"
                        if await _already_processed(db, user_id, b_slot, now):
                            stats["skipped"] += 1
                            stats["details"].append(f"{str(user_id)[:8]} {b_slot}: already sent")
                        elif dry_run:
                            stats["details"].append(f"{str(user_id)[:8]} {b_slot}@{b_start}: BIBLE DUE (dry)")
                        else:
                            from app.services.briefing_generator import generate_briefing
                            bres = await generate_briefing(db, tenant_id, user_id, tod, only_modules=["bible_reading"], skip_im_push=True)
                            if bres.get("status") in ("published", "empty_content"):
                                if bres["status"] == "empty_content":
                                    stats["skipped"] += 1
                                    stats["details"].append(f"{str(user_id)[:8]} {b_slot}: empty content")
                                    continue
                                bstatus = await _push_telegram(db, user, b_slot, bres["content"], bres.get("categories") or {})
                                if bstatus == "skipped":
                                    bstatus = await _push_whatsapp(db, user, b_slot, bres["content"], bres.get("categories") or {})
                                db.add(PushLog(
                                    tenant_id=tenant_id, user_id=user_id,
                                    channel="telegram" if bstatus != "skipped" else "whatsapp",
                                    slot=b_slot, status=bstatus,
                                    error="" if bstatus == "sent" else (bstatus if bstatus == "failed" else "no_channel"),
                                ))
                                stats[bstatus] += 1
                                stats["details"].append(f"{str(user_id)[:8]} {b_slot}@{b_start}: {bstatus}")
                                # 讀經進度推進：bible-only custom push 成功 → 每日一章
                                if bstatus == "sent":
                                    await _advance_bible_progress(db, user, modules_raw, tod)
                            else:
                                stats["skipped"] += 1
                                stats["details"].append(f"{str(user_id)[:8]} {b_slot}: {bres.get('status', 'failed')}")
            # ⚠️ per-member commit — pending PushLog 必須喺呢個 member 嘅 GUC
            # 之下 flush。唔 commit 嘅話，下一個 member set 咗新 GUC 之後，
            # autoflush 會用新 GUC INSERT 舊 member 嘅 PushLog → RLS violation
            # （tenant mismatch — push_log policy 只睇 app.tenant_id GUC）
            try:
                await db.commit()
            except Exception:
                try:
                    await db.rollback()
                except Exception:
                    pass
        await db.commit()
    return stats


def main() -> None:
    dry = "--dry-run" in sys.argv
    stats = asyncio.run(run_scheduler(dry_run=dry))
    print(f"briefing_scheduler {'(DRY)' if dry else ''}: {stats['due']} due, "
          f"{stats['sent']} sent, {stats['skipped']} skipped, {stats['failed']} failed "
          f"({stats['scanned']} users scanned)")
    for d in stats["details"]:
        print(" ", d)


if __name__ == "__main__":
    main()
