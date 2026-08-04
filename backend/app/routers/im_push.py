"""IM Push module — Tri-Daily Briefing delivery via WhatsApp/Telegram.

Phase A scope (2026-07-31):
- GET/PUT /im-push/prefs  — per-user delivery preferences (settings UI)
- POST /im-push/test      — send a test message to the caller's channels
- POST /im-push/briefing  — Cron-Api-Key protected; compose slot briefing + fan-out

Message format follows AI_Personal_CRM_TriDaily_Strategy.md §2.2 — highly
scannable, emoji hierarchy, deep link on every action point.
"""
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_tenant_session
from app.config import settings
from app.ai.session.context import AISessionContext
from app.ai.tool_registry import _get_upcoming_events, _list_tasks
from app.models.im_push import IMDeliveryPref, PushLog, DEFAULT_SLOTS
from app.models.whatsapp import WhatsAppMapping
from app.models.notification import Notification
from app.services import whatsapp_service

router = APIRouter(prefix="/api/v1")

APP_BASE_URL = "https://nexus-crm.kinet-poc.com"
HKT = timezone(timedelta(hours=8))
SLOTS = ("morning", "noon", "evening")


# ── Schemas ──────────────────────────────────────────────────────────
class PrefItem(BaseModel):
    channel: str
    enabled: bool = True
    slots: dict[str, bool] = dict(DEFAULT_SLOTS)
    weekend_mute: bool = True
    quiet_hours: dict[str, str] = {"start": "22:00", "end": "08:00"}
    tz: str = "Asia/Hong_Kong"


class PrefsResponse(BaseModel):
    channels: dict[str, PrefItem]


class TestPushRequest(BaseModel):
    channel: str = "whatsapp"


# ── Helpers ──────────────────────────────────────────────────────────
def _tid(request: Request) -> uuid.UUID:
    return uuid.UUID(request.state.tenant_id)


def _uid(request: Request) -> uuid.UUID:
    return uuid.UUID(request.state.user_id)


def _now_hkt() -> datetime:
    return datetime.now(HKT)


def _parse_dt(value: Any) -> datetime | None:
    """Tolerant ISO/datetime parser; assumes naive values are HKT."""
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=HKT)
        return dt.astimezone(HKT)
    s = str(value)
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=HKT)
        return dt.astimezone(HKT)
    except Exception:
        return None


def _in_quiet_hours(pref: IMDeliveryPref, now: datetime) -> bool:
    try:
        start_s, end_s = (pref.quiet_hours or {}).get("start", "22:00"), (pref.quiet_hours or {}).get("end", "08:00")
        start = datetime.strptime(start_s, "%H:%M").time()
        end = datetime.strptime(end_s, "%H:%M").time()
        t = now.time()
        if start <= end:
            return start <= t <= end
        return t >= start or t <= end  # overnight window
    except Exception:
        return False


async def _resolve_workspace(db: AsyncSession, tenant_id: uuid.UUID) -> uuid.UUID:
    try:
        row = await db.execute(
            text("""SELECT id FROM nexus_auth.workspaces WHERE tenant_id = :tid ORDER BY created_at ASC LIMIT 1"""),
            {"tid": tenant_id},
        )
        result = row.scalar_one_or_none()
        if result:
            return uuid.UUID(str(result))
    except Exception:
        pass
    return uuid.UUID(int=0)


def _build_ctx(tenant_id: uuid.UUID, user_id: uuid.UUID, workspace_id: uuid.UUID) -> AISessionContext:
    return AISessionContext(
        session_id=uuid.uuid4(),
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        user_id=user_id,
        membership_id=uuid.UUID(int=0),
        plan_type="chat",
    )


def _deep_link(kind: str, entity_id: str | None = None) -> str:
    if kind == "dashboard":
        return f"{APP_BASE_URL}/l/dashboard"
    return f"{APP_BASE_URL}/l/{kind}/{entity_id}"


# ── Message composers ────────────────────────────────────────────────
def _compose_morning(events: list[dict], tasks: list[dict], now: datetime) -> str:
    lines: list[str] = ["🤖 [AI 助理] 早安 Briefing", ""]

    # Today's events (filtered by caller)
    if events:
        lines.append("📅 今日焦點行程：")
        for e in events[:4]:
            start = _parse_dt(e.get("start"))
            t = start.strftime("%H:%M") if start else "--:--"
            title = e.get("title") or e.get("summary") or "Event"
            loc = f" ({e.get('location')})" if e.get("location") else ""
            lines.append(f"• {t} - {title}{loc}")
        lines.append(f"📎 AI 會議準備卡：{_deep_link('m', str(events[0].get('id')))}")
        lines.append("")

    # Deadlines: overdue first, then due today
    if tasks:
        lines.append("✅ 待處理死線：")
        for i, t in enumerate(tasks[:5], 1):
            due = _parse_dt(t.get("due_date"))
            if due and due.date() < now.date():
                tag = "昨日逾期"
            else:
                tag = "今日到期"
            lines.append(f"{i}. {t.get('title', '')} ({tag})")
            lines.append(f"👉 立即處理或推遲：{_deep_link('t', str(t.get('id')))}")
        lines.append("")

    lines.append(f"🌐 完整簡報：{_deep_link('dashboard')}")
    return "\n".join(lines)


def _compose_noon(events: list[dict], tasks: list[dict], now: datetime) -> str:
    """Noon slot — afternoon focus: remaining events + today's pending deadlines."""
    lines: list[str] = ["🤖 [AI 助理] 午間 Briefing", ""]

    # Remaining events this afternoon
    if events:
        lines.append("🌤 下午行程：")
        for e in events[:4]:
            start = _parse_dt(e.get("start"))
            t = start.strftime("%H:%M") if start else "--:--"
            title = e.get("title") or e.get("summary") or "Event"
            loc = f" ({e.get('location')})" if e.get("location") else ""
            lines.append(f"• {t} - {title}{loc}")
        lines.append("")

    # Pending deadlines due today
    if tasks:
        lines.append("⏳ 今日到期未完成：")
        for i, t in enumerate(tasks[:5], 1):
            lines.append(f"{i}. {t.get('title', '')}")
            lines.append(f"👉 完成或推遲：{_deep_link('t', str(t.get('id')))}")
        lines.append("")
    elif events:
        lines.append("✅ 今日無到期死線，專注下午行程！")

    lines.append(f"🌐 完整簡報：{_deep_link('dashboard')}")
    return "\n".join(lines)


def _compose_evening(
    now: datetime,
    done_count: int,
    remaining: list[dict],
    tomorrow_events: list[dict],
    tomorrow_tasks: list[dict],
) -> str:
    """Evening slot — wrap-up review + tomorrow preview."""
    lines: list[str] = ["🤖 [AI 助理] 傍晚 Briefing", ""]

    if done_count:
        lines.append(f"🎉 今日完成 {done_count} 項任務！")
    else:
        lines.append("📝 今日未標記任何完成任務。")

    if remaining:
        lines.append("")
        lines.append("📋 未完成（聽日繼續）：")
        for i, t in enumerate(remaining[:5], 1):
            due = _parse_dt(t.get("due_date"))
            tag = "  ⚠️已逾期" if due and due.date() < now.date() else ""
            lines.append(f"{i}. {t.get('title', '')}{tag}")
            lines.append(f"👉 處理：{_deep_link('t', str(t.get('id')))}")

    if tomorrow_events or tomorrow_tasks:
        lines.append("")
        lines.append("🔮 聽日預告：")
        for e in tomorrow_events[:4]:
            start = _parse_dt(e.get("start"))
            t = start.strftime("%H:%M") if start else "全天"
            title = e.get("title") or e.get("summary") or "Event"
            lines.append(f"• {t} - {title}")
        if tomorrow_tasks:
            lines.append(f"• ⏰ {len(tomorrow_tasks)} 項任務到期")
            lines.append(f"👉 聽日任務：{_deep_link('t', str(tomorrow_tasks[0].get('id')))}")

    lines.append("")
    lines.append(f"🌐 完整簡報：{_deep_link('dashboard')}")
    return "\n".join(lines)


# ── Endpoints ────────────────────────────────────────────────────────
@router.get("/im-push/prefs", response_model=PrefsResponse)
async def get_prefs(
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    """Read delivery prefs; auto-create Default-ON row for connected channels."""
    tenant_id = _tid(request)
    user_id = _uid(request)

    # channels actually connected
    wa = (
        await db.execute(
            select(WhatsAppMapping).where(
                WhatsAppMapping.tenant_id == tenant_id,
                WhatsAppMapping.user_id == user_id,
                WhatsAppMapping.status == "active",
            )
        )
    ).scalar_one_or_none()

    connected = ["whatsapp"] if wa else []
    channels: dict[str, PrefItem] = {}

    for ch in connected + ["telegram"]:
        pref = (
            await db.execute(
                select(IMDeliveryPref).where(
                    IMDeliveryPref.tenant_id == tenant_id,
                    IMDeliveryPref.user_id == user_id,
                    IMDeliveryPref.channel == ch,
                )
            )
        ).scalar_one_or_none()
        if pref is None:
            pref = IMDeliveryPref(tenant_id=tenant_id, user_id=user_id, channel=ch)
            db.add(pref)
            await db.flush()
        channels[ch] = PrefItem(
            channel=pref.channel,
            enabled=pref.enabled,
            slots=pref.slots or dict(DEFAULT_SLOTS),
            weekend_mute=pref.weekend_mute,
            quiet_hours=pref.quiet_hours or {"start": "22:00", "end": "08:00"},
            tz=pref.tz,
        )
    await db.commit()
    return PrefsResponse(channels=channels)


@router.put("/im-push/prefs", response_model=PrefsResponse)
async def put_prefs(
    request: Request,
    body: PrefItem,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _tid(request)
    user_id = _uid(request)

    pref = (
        await db.execute(
            select(IMDeliveryPref).where(
                IMDeliveryPref.tenant_id == tenant_id,
                IMDeliveryPref.user_id == user_id,
                IMDeliveryPref.channel == body.channel,
            )
        )
    ).scalar_one_or_none()
    if pref is None:
        pref = IMDeliveryPref(tenant_id=tenant_id, user_id=user_id, channel=body.channel)
        db.add(pref)

    pref.enabled = body.enabled
    pref.slots = {k: bool(v) for k, v in body.slots.items()}
    pref.weekend_mute = body.weekend_mute
    pref.quiet_hours = body.quiet_hours
    pref.tz = body.tz
    await db.commit()

    return await get_prefs(request, db)


@router.post("/im-push/test")
async def test_push(
    request: Request,
    body: TestPushRequest,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _tid(request)
    user_id = _uid(request)

    mapping = (
        await db.execute(
            select(WhatsAppMapping).where(
                WhatsAppMapping.tenant_id == tenant_id,
                WhatsAppMapping.user_id == user_id,
                WhatsAppMapping.status == "active",
            )
        )
    ).scalar_one_or_none()
    if not mapping:
        raise HTTPException(400, "WhatsApp not connected")

    msg = (
        "🤖 [AI 助理] 測試推送成功！\n\n"
        "你已開啟 AI 每日簡報（早安 / 午間 / 傍晚）。\n"
        "你可以隨時在 CRM 設定 > AI 助理設定 > 通知與整合 調整時段或關閉。\n\n"
        f"🌐 進入 Dashboard：{_deep_link('dashboard')}"
    )
    result = await whatsapp_service.send_text(mapping.wa_id, msg)
    if isinstance(result, dict) and result.get("error"):
        # Meta rejected the send (e.g. expired token / 24h window) — surface as failure
        err = str(result.get("error"))[:200]
        raise HTTPException(502, f"WhatsApp delivery failed: {err}")
    return {"status": "sent", "detail": result}


@router.post("/im-push/briefing")
async def run_briefing(
    request: Request,
    slot: str = "morning",
    content: str = "",
    db: AsyncSession = Depends(get_tenant_session),
):
    """Cron endpoint — compose + fan-out Tri-Daily Briefing for all opted-in users.

    Auth: Cron-Api-Key header (same pattern as /ai/daily-summary).
    `content` (optional): pre-generated message text from an external LLM
    pipeline (Hermes briefing_cache). When provided, it overrides the
    built-in composers — the gating logic (prefs enabled / slots /
    weekend_mute / quiet_hours / wa mapping) still applies.
    """
    cron_key = request.headers.get("Cron-Api-Key", "")
    expected = os.environ.get("NEXUS_CRON_API_KEY", "") or settings.cron_api_key
    if not expected or cron_key != expected:
        raise HTTPException(403, "Invalid or missing Cron-Api-Key")

    if slot not in SLOTS:
        raise HTTPException(400, f"slot must be one of {SLOTS}")

    now = _now_hkt()
    weekend = now.weekday() >= 5
    stats = {"attempted": 0, "sent": 0, "skipped": 0, "failed": 0}

    prefs = (
        await db.execute(
            select(IMDeliveryPref).where(
                IMDeliveryPref.channel == "whatsapp",
                IMDeliveryPref.enabled == True,  # noqa: E712
            )
        )
    ).scalars().all()

    for pref in prefs:
        slots = pref.slots or {}
        if not slots.get(slot):
            continue
        stats["attempted"] += 1

        # ── Skip logic: weekend mute / quiet hours ──
        if pref.weekend_mute and weekend:
            db.add(PushLog(tenant_id=pref.tenant_id, user_id=pref.user_id, channel="whatsapp", slot=slot, status="skipped", reason="weekend_mute"))
            stats["skipped"] += 1
            continue
        if _in_quiet_hours(pref, now):
            db.add(PushLog(tenant_id=pref.tenant_id, user_id=pref.user_id, channel="whatsapp", slot=slot, status="skipped", reason="quiet_hours"))
            stats["skipped"] += 1
            continue

        # ── Resolve wa_id ──
        mapping = (
            await db.execute(
                select(WhatsAppMapping).where(
                    WhatsAppMapping.tenant_id == pref.tenant_id,
                    WhatsAppMapping.user_id == pref.user_id,
                    WhatsAppMapping.status == "active",
                )
            )
        ).scalar_one_or_none()
        if not mapping:
            db.add(PushLog(tenant_id=pref.tenant_id, user_id=pref.user_id, channel="whatsapp", slot=slot, status="skipped", reason="no_mapping"))
            stats["skipped"] += 1
            continue

        # ── Build context + compose ──
        try:
            workspace_id = await _resolve_workspace(db, pref.tenant_id)
            ctx = _build_ctx(pref.tenant_id, pref.user_id, workspace_id)

            if content.strip():
                # External LLM-generated briefing (Hermes pipeline) — gating already passed above
                msg = content.strip()
            elif slot == "morning":
                events, tasks = await _compose_morning_data(ctx, db, now)
                msg = _compose_morning(events, tasks, now)
            elif slot == "noon":
                events, tasks = await _compose_noon_data(ctx, db, now)
                msg = _compose_noon(events, tasks, now)
            elif slot == "evening":
                data = await _compose_evening_data(ctx, db, now)
                msg = _compose_evening(now, **data)
            else:
                db.add(PushLog(tenant_id=pref.tenant_id, user_id=pref.user_id, channel="whatsapp", slot=slot, status="skipped", reason="slot_not_implemented"))
                stats["skipped"] += 1
                continue

            result = await whatsapp_service.send_text(mapping.wa_id, msg)
            ok = isinstance(result, dict) and result.get("messages")
            db.add(PushLog(tenant_id=pref.tenant_id, user_id=pref.user_id, channel="whatsapp", slot=slot, status="sent" if ok else "failed", error="" if ok else str(result)[:300]))
            if ok:
                stats["sent"] += 1
                # In-app notification (bell sync) — title varies by slot
                slot_title = {"morning": "☀️ 早安 Briefing", "noon": "🌤 午間 Briefing", "evening": "🌆 傍晚 Briefing"}.get(slot, "AI Briefing")
                db.add(Notification(
                    tenant_id=pref.tenant_id,
                    user_id=pref.user_id,
                    title=slot_title,
                    body=msg.split("\n")[0] if msg else "",
                    priority="NORMAL",
                    status="UNREAD",
                    group_key=f"im_push:{slot}",
                    is_ai_generated=True,
                    source_module="im_push",
                ))
            else:
                stats["failed"] += 1
        except Exception as e:  # noqa: BLE001 — per-user isolation; one failure must not kill the fan-out
            db.add(PushLog(tenant_id=pref.tenant_id, user_id=pref.user_id, channel="whatsapp", slot=slot, status="failed", error=str(e)[:300]))
            stats["failed"] += 1

    await db.commit()
    return {"slot": slot, "run_at": now.isoformat(), **stats}


async def _compose_morning_data(ctx: AISessionContext, db: AsyncSession, now: datetime) -> tuple[list[dict], list[dict]]:
    """Extract today's events + overdue/due-today tasks (morning slot)."""
    events: list[dict] = []
    try:
        evts = await _get_upcoming_events(ctx, {"days_ahead": 1, "limit": 20}, db)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        tomorrow = today_start + timedelta(days=1)
        for e in evts:
            start = _parse_dt(e.get("start"))
            if start and today_start <= start < tomorrow:
                events.append(e)
        events.sort(key=lambda e: _parse_dt(e.get("start")) or now)
    except Exception:
        pass

    tasks: list[dict] = []
    try:
        rows = await _list_tasks(ctx, {"status": "pending", "limit": 50}, db)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        tomorrow = today_start + timedelta(days=1)
        for t in rows:
            due = _parse_dt(t.get("due_date"))
            if due and due < tomorrow:  # overdue or due today
                tasks.append(t)
        # overdue first, then due-today, then by due date asc
        tasks.sort(key=lambda t: (_parse_dt(t.get("due_date")) or now).date() < now.date(), reverse=True)
        tasks.sort(key=lambda t: _parse_dt(t.get("due_date")) or now)
    except Exception:
        pass

    return events, tasks


async def _compose_noon_data(ctx: AISessionContext, db: AsyncSession, now: datetime) -> tuple[list[dict], list[dict]]:
    """Noon slot data — remaining events today (start >= now) + pending tasks due today."""
    events: list[dict] = []
    try:
        evts = await _get_upcoming_events(ctx, {"days_ahead": 1, "limit": 20}, db)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        tomorrow = today_start + timedelta(days=1)
        for e in evts:
            start = _parse_dt(e.get("start"))
            if start and today_start <= start < tomorrow and start >= now:
                events.append(e)
        events.sort(key=lambda e: _parse_dt(e.get("start")) or now)
    except Exception:
        pass

    tasks: list[dict] = []
    try:
        rows = await _list_tasks(ctx, {"status": "pending", "limit": 50}, db)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        tomorrow = today_start + timedelta(days=1)
        for t in rows:
            due = _parse_dt(t.get("due_date"))
            if due and today_start <= due < tomorrow:
                tasks.append(t)
        tasks.sort(key=lambda t: _parse_dt(t.get("due_date")) or now)
    except Exception:
        pass

    return events, tasks


async def _compose_evening_data(ctx: AISessionContext, db: AsyncSession, now: datetime) -> dict:
    """Evening slot data — completed count, remaining overdue/tomorrow, tomorrow preview."""
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow_start = today_start + timedelta(days=1)
    day_after = tomorrow_start + timedelta(days=1)

    done_count = 0
    remaining: list[dict] = []
    tomorrow_tasks: list[dict] = []
    try:
        done_rows = await _list_tasks(ctx, {"status": "completed", "limit": 100}, db)
        # completed today (updated_at proxy — no completed_at column on Task)
        for t in done_rows:
            upd = _parse_dt(t.get("updated_at"))
            if upd and upd >= today_start:
                done_count += 1

        pending = await _list_tasks(ctx, {"status": "pending", "limit": 100}, db)
        for t in pending:
            due = _parse_dt(t.get("due_date"))
            if due and due < tomorrow_start:
                remaining.append(t)
            elif due and tomorrow_start <= due < day_after:
                tomorrow_tasks.append(t)
        remaining.sort(key=lambda t: _parse_dt(t.get("due_date")) or now)
        tomorrow_tasks.sort(key=lambda t: _parse_dt(t.get("due_date")) or now)
    except Exception:
        pass

    tomorrow_events: list[dict] = []
    try:
        evts = await _get_upcoming_events(ctx, {"days_ahead": 2, "limit": 30}, db)
        for e in evts:
            start = _parse_dt(e.get("start"))
            if start and tomorrow_start <= start < day_after:
                tomorrow_events.append(e)
        tomorrow_events.sort(key=lambda e: _parse_dt(e.get("start")) or now)
    except Exception:
        pass

    return {
        "done_count": done_count,
        "remaining": remaining,
        "tomorrow_events": tomorrow_events,
        "tomorrow_tasks": tomorrow_tasks,
    }
