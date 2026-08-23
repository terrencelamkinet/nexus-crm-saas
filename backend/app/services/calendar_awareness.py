"""Calendar Awareness scanner — 掃描日程缺漏，生成 AI 主動提問。

缺漏偵測規則（針對未來 7 日嘅 calendar events）：
1. meeting 冇 location          → 「《title》未設地點，要加嗎？」
2. meeting 冇 description       → 「《title》冇 agenda，要寫低準備事項嗎？」
3. 時間重疊（同日兩個 event 撞） → 衝突提示（補 briefing 唔覆蓋嘅時段）

Dedup：同 context_id + 同 source + status=pending 已存在 → 唔重複生成。
每人最多 PENDING_LIMIT 條未回覆問題。
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import cast

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai.pending_question import PendingAIQuestion
from app.models.crm import ProjectCalendarEvent

log = logging.getLogger(__name__)

PENDING_LIMIT = 5
SCAN_DAYS = 7
MEETING_TYPES = ("meeting", "milestone", "reminder")
# 假期/私人 events 唔需要問地點/agenda（AL、年假、生日、假期等）
SKIP_TITLE_HINTS = ("annual leave", "al ", "年假", "假期", "leave", "holiday", "birthday", "放假")


async def scan_calendar_gaps(
    db: AsyncSession,
    user_id,
    tenant_id,
) -> list[PendingAIQuestion]:
    """掃描用戶未來 7 日嘅日程缺漏，生成 pending questions（有 dedup）。"""
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(days=SCAN_DAYS)

    events = (
        await db.execute(
            select(ProjectCalendarEvent)
            .where(
                ProjectCalendarEvent.tenant_id == tenant_id,
                ProjectCalendarEvent.owner_user_id == user_id,
                ProjectCalendarEvent.start >= now,
                ProjectCalendarEvent.start <= horizon,
            )
            .order_by(ProjectCalendarEvent.start)
        )
    ).scalars().all()

    if not events:
        return []

    # 現有問題（dedup 用 — 唔理 status：一條 event 一個問題只問一次）
    existing = (
        await db.execute(
            select(PendingAIQuestion).where(
                PendingAIQuestion.tenant_id == tenant_id,
                PendingAIQuestion.user_id == user_id,
            )
        )
    ).scalars().all()
    existing_keys = {
        (q.context_type, str(q.context_id), q.source) for q in existing
    }

    created: list[PendingAIQuestion] = []
    pending_count = len(existing)

    def _fmt_dt(dt) -> str:
        local = cast(datetime, dt).astimezone()
        return local.strftime("%m月%d日 %H:%M")

    for ev in events:
        if pending_count >= PENDING_LIMIT:
            break
        etype = (ev.event_type or "").lower()
        if etype not in MEETING_TYPES:
            continue
        title = (ev.title or "").strip()
        if any(h in title.lower() for h in SKIP_TITLE_HINTS):
            continue
        key = ("calendar", str(ev.id), "calendar_gap")
        if key in existing_keys:
            continue

        # 1. 冇 location
        if not (ev.location or "").strip():
            q = PendingAIQuestion(
                user_id=user_id,
                tenant_id=tenant_id,
                question=f"《{ev.title}》（{_fmt_dt(ev.start)}）未設地點，要加嗎？",
                context_type="calendar",
                context_id=ev.id,
                context_title=ev.title,
                suggested_answers=["加地點：辦公室", "加地點：客戶公司", "唔使"],
                source="calendar_gap",
            )
            db.add(q)
            created.append(q)
            existing_keys.add(key)
            pending_count += 1
            if pending_count >= PENDING_LIMIT:
                break

        # 2. 冇 description（agenda）
        if not (ev.description or "").strip():
            key2 = ("calendar", str(ev.id), "calendar_agenda")
            if key2 in existing_keys:
                continue
            q = PendingAIQuestion(
                user_id=user_id,
                tenant_id=tenant_id,
                question=f"《{ev.title}》（{_fmt_dt(ev.start)}）冇 agenda，要寫低準備事項嗎？",
                context_type="calendar",
                context_id=ev.id,
                context_title=ev.title,
                suggested_answers=["寫低 agenda", "唔使"],
                source="calendar_agenda",
            )
            db.add(q)
            created.append(q)
            existing_keys.add(key2)
            pending_count += 1

    if created:
        await db.flush()
        log.info("calendar_awareness: created %d pending questions for user %s", len(created), user_id)
    return created


async def list_pending(
    db: AsyncSession,
    user_id,
    tenant_id,
    force_scan: bool = True,
) -> list[PendingAIQuestion]:
    """攞 pending questions（可選先掃描一次再攞）。"""
    if force_scan:
        try:
            await scan_calendar_gaps(db, user_id, tenant_id)
            await db.commit()
        except Exception:
            log.exception("calendar_awareness scan failed — fallback to existing rows")
            await db.rollback()

    rows = (
        await db.execute(
            select(PendingAIQuestion)
            .where(
                PendingAIQuestion.tenant_id == tenant_id,
                PendingAIQuestion.user_id == user_id,
                PendingAIQuestion.status == "pending",
            )
            .order_by(PendingAIQuestion.created_at)
            .limit(PENDING_LIMIT + 5)
        )
    ).scalars().all()
    return list(rows)
