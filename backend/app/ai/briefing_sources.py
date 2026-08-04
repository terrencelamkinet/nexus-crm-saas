"""AI Secretary briefing module data sources.

Each enabled module maps to one async function here. Functions receive
the AI session context + DB session and return serializable dicts ready
for the briefing response. RLS (app.tenant_id GUC set by
get_tenant_session) enforces per-tenant isolation at the DB layer.

Convention: return [] / {} on any failure — a module data source must
never crash the whole briefing.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.session.context import AISessionContext
from app.ai.tool_registry import _row_to_dict
from app.models.crm import Company, Project, Touchpoint
from app.models.crm_module_b import Deal, Quote

_UTC = timezone.utc


async def project_status(ctx: AISessionContext, db: AsyncSession) -> list[dict[str, Any]]:
    """Active projects (not done/cancelled), nearest deadline first."""
    rows = (
        await db.execute(
            select(Project, Company.name)
            .join(Company, Company.id == Project.company_id, isouter=True)
            .where(
                Project.tenant_id == ctx.tenant_id,
                Project.status.notin_(["done", "cancelled", "archived"]),
            )
            .order_by(Project.deadline.asc().nulls_last())
            .limit(8)
        )
    ).all()

    items = []
    for r, company_name in rows:
        d = _row_to_dict(r)
        d["company_name"] = company_name
        items.append(d)
    return items


async def stale_deals(ctx: AISessionContext, db: AsyncSession, days: int = 14) -> list[dict[str, Any]]:
    """Open deals with no activity for `days` — stalled opportunities."""
    cutoff = datetime.now(_UTC) - timedelta(days=days)
    rows = (
        await db.execute(
            select(Deal, Company.name)
            .join(Company, Company.id == Deal.company_id, isouter=True)
            .where(
                Deal.tenant_id == ctx.tenant_id,
                Deal.status == "open",
                Deal.updated_at < cutoff,
            )
            .order_by(Deal.updated_at.asc())
            .limit(8)
        )
    ).all()

    items = []
    for r, company_name in rows:
        d = _row_to_dict(r)
        d["company_name"] = company_name
        items.append(d)
    return items


async def quote_tracking(ctx: AISessionContext, db: AsyncSession) -> list[dict[str, Any]]:
    """Pending quotes (sent / draft), expiring soonest first."""
    rows = (
        await db.execute(
            select(Quote, Deal.name)
            .join(Deal, Deal.id == Quote.deal_id, isouter=True)
            .where(
                Quote.tenant_id == ctx.tenant_id,
                Quote.status.in_(["draft", "sent"]),
            )
            .order_by(Quote.valid_until.asc().nulls_last())
            .limit(8)
        )
    ).all()

    items = []
    for r, deal_name in rows:
        d = _row_to_dict(r)
        d["deal_name"] = deal_name
        items.append(d)
    return items


async def overdue_followup(ctx: AISessionContext, db: AsyncSession, days: int = 7) -> list[dict[str, Any]]:
    """Contacts with no touchpoint in the last `days` — follow-up due."""
    cutoff = datetime.now(_UTC) - timedelta(days=days)
    rows = (
        await db.execute(
            select(Touchpoint)
            .where(
                Touchpoint.tenant_id == ctx.tenant_id,
                Touchpoint.date >= cutoff,
            )
            .order_by(Touchpoint.date.desc())
            .limit(200)
        )
    ).scalars().all()

    # contacts who HAVE had activity — invert to find who's been quiet
    active_contact_ids = {str(t.contact_id) for t in rows if t.contact_id is not None}
    from app.models.crm import Contact

    contacts = (
        await db.execute(
            select(Contact, Company.name)
            .join(Company, Company.id == Contact.company_id, isouter=True)
            .where(
                Contact.tenant_id == ctx.tenant_id,
                Contact.status.notin_(["churned", "other"]),
            )
            .order_by(Contact.updated_at.asc())
            .limit(50)
        )
    ).all()

    items = []
    for c, company_name in contacts:
        if str(c.id) in active_contact_ids:
            continue
        d = _row_to_dict(c)
        d["company_name"] = company_name
        items.append(d)
        if len(items) >= 8:
            break
    return items


async def birthday_reminders(ctx: AISessionContext, db: AsyncSession) -> list[dict[str, Any]]:
    """Contacts with a birthday in the current HKT month (custom field `birthday_month`, 1-12)."""
    from zoneinfo import ZoneInfo
    from app.models.crm import Contact

    month = datetime.now(ZoneInfo("Asia/Hong_Kong")).month
    rows = (
        await db.execute(
            select(Contact, Company.name)
            .join(Company, Company.id == Contact.company_id, isouter=True)
            .where(
                Contact.tenant_id == ctx.tenant_id,
                Contact.status.notin_(["churned", "other"]),
                Contact.custom_fields.op("->>")("birthday_month") == str(month),
            )
            .order_by(Contact.updated_at.desc())
            .limit(20)
        )
    ).all()

    items = []
    for c, company_name in rows:
        d = _row_to_dict(c)
        d["company_name"] = company_name
        d["birthday_month"] = month
        items.append(d)
    return items


async def hot_leads(ctx: AISessionContext, db: AsyncSession) -> list[dict[str, Any]]:
    """High-intent deals: open deals with probability >= 70, biggest first."""
    rows = (
        await db.execute(
            select(Deal, Company.name)
            .join(Company, Company.id == Deal.company_id, isouter=True)
            .where(
                Deal.tenant_id == ctx.tenant_id,
                Deal.status == "open",
                Deal.probability >= 70,
            )
            .order_by(Deal.probability.desc(), Deal.amount.desc().nulls_last())
            .limit(8)
        )
    ).all()

    items = []
    for r, company_name in rows:
        d = _row_to_dict(r)
        d["company_name"] = company_name
        items.append(d)
    return items


async def sales_kpi(ctx: AISessionContext, db: AsyncSession) -> list[dict[str, Any]]:
    """Sales target progress: won deals value vs the user's current-period target."""
    from app.models.crm_module_c import UserTarget

    # user_targets.period_start/end are offset-naive TIMESTAMP (HKT wall-clock)
    from zoneinfo import ZoneInfo
    now = datetime.now(ZoneInfo("Asia/Hong_Kong")).replace(tzinfo=None)
    rows = (
        await db.execute(
            select(UserTarget)
            .where(
                UserTarget.tenant_id == ctx.tenant_id,
                UserTarget.user_id == ctx.user_id,
                UserTarget.period_start <= now,
                UserTarget.period_end >= now,
            )
            .order_by(UserTarget.period_end.desc())
            .limit(3)
        )
    ).scalars().all()

    items = []
    for t in rows:
        d = _row_to_dict(t)
        # actual: sum of won deals in the period
        won = await db.execute(
            select(func.coalesce(func.sum(Deal.amount), 0))
            .where(
                Deal.tenant_id == ctx.tenant_id,
                Deal.status == "won",
                Deal.won_at >= t.period_start,
                Deal.won_at <= t.period_end,
            )
        )
        d["won_amount"] = float(won.scalar() or 0)
        tv = float(t.target_value or 0)
        d["progress_pct"] = round(d["won_amount"] / tv * 100, 1) if tv else 0
        items.append(d)
    return items


async def team_updates(ctx: AISessionContext, db: AsyncSession) -> list[dict[str, Any]]:
    """Recent task activity from the user's teams."""
    from app.models.crm import Task
    from app.models.crm_module_c import Team, TeamMember

    # teams the current user belongs to
    team_rows = (
        await db.execute(
            select(TeamMember.team_id)
            .where(TeamMember.user_id == ctx.user_id)
            .limit(10)
        )
    ).scalars().all()
    if not team_rows:
        return []

    team_ids = list(team_rows)
    teams = {
        t.id: t.name
        for t in (
            await db.execute(select(Team).where(Team.id.in_(team_ids)))
        ).scalars().all()
    }

    # members of those teams
    member_ids = (
        await db.execute(
            select(TeamMember.user_id).where(TeamMember.team_id.in_(team_ids))
        )
    ).scalars().all()

    # recent open tasks assigned to any team member
    rows = (
        await db.execute(
            select(Task)
            .where(
                Task.tenant_id == ctx.tenant_id,
                Task.assignee_id.in_(member_ids),
                Task.status.in_(["pending", "in_progress"]),
            )
            .order_by(Task.updated_at.desc())
            .limit(10)
        )
    ).scalars().all()

    items = []
    for r in rows:
        d = _row_to_dict(r)
        d["team_names"] = list(teams.values())
        items.append(d)
    return items


async def invoice_reminders(ctx: AISessionContext, db: AsyncSession) -> list[dict[str, Any]]:
    """Outstanding quotations (DRAFT/PENDING) — invoice module proxy."""
    from app.models.crm_module_c import Quotation

    rows = (
        await db.execute(
            select(Quotation)
            .where(
                Quotation.tenant_id == ctx.tenant_id,
                Quotation.status.in_(["DRAFT", "PENDING", "SENT"]),
            )
            .order_by(Quotation.valid_until.asc().nulls_last())
            .limit(8)
        )
    ).scalars().all()

    items = []
    for r in rows:
        d = _row_to_dict(r)
        items.append(d)
    return items


# ═══════════════════════════════════════════════════════════════
# Batch B/C — external API + new-table sources (2026-08-01)
# ═══════════════════════════════════════════════════════════════
import asyncio
import xml.etree.ElementTree as ET

import httpx

_HTTP_TIMEOUT = httpx.Timeout(8.0)
_USER_AGENT = "Mozilla/5.0 (compatible; NexusCRM/1.0)"


async def weather(ctx: AISessionContext, db: AsyncSession) -> list[dict[str, Any]]:
    """Current HK weather from HKO Open Data (rhrread)."""
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT, headers={"User-Agent": _USER_AGENT}) as client:
            r = await client.get(
                "https://data.weather.gov.hk/weatherAPI/opendata/weather.php",
                params={"dataType": "rhrread", "lang": "en"},
            )
            r.raise_for_status()
            data = r.json()
    except Exception:
        return []

    items: list[dict[str, Any]] = []
    try:
        icon_raw = data.get("icon") or [0]
        icon = icon_raw[0] if isinstance(icon_raw, list) else icon_raw
        temp = data.get("temperature", {}).get("data", [{}])[0]
        humidity = data.get("humidity", {}).get("data", [{}])[0]
        items.append({
            "place": temp.get("place", "Hong Kong"),
            "temperature": temp.get("value"),
            "humidity": humidity.get("value"),
            "icon": icon,
            "updated_at": data.get("updateTime", ""),
        })
        # rainfall at HKO main station
        for s in data.get("rainfall", {}).get("data", []):
            if s.get("main") == "TRUE":
                items[0]["rainfall_mm"] = s.get("max")
                break
    except Exception:
        return []
    return items


async def unread_messages(ctx: AISessionContext, db: AsyncSession) -> list[dict[str, Any]]:
    """Unread inbox messages from connected mail providers (Gmail/Outlook).
    Returns [] when no mail integration is connected — graceful no-op."""
    from app.models.integration import Integration

    rows = (
        await db.execute(
            select(Integration).where(
                Integration.tenant_id == ctx.tenant_id,
                Integration.user_id == ctx.user_id,
                Integration.status == "active",
                Integration.provider.in_(["gmail", "outlook_mail"]),
            )
        )
    ).scalars().all()

    items: list[dict[str, Any]] = []
    for integ in rows:
        cfg = integ.config or {}
        token = cfg.get("access_token")
        if not token:
            continue
        try:
            if integ.provider == "gmail":
                async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
                    r = await client.get(
                        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
                        params={"q": "is:unread", "maxResults": 8},
                        headers={"Authorization": f"Bearer {token}"},
                    )
                    if r.status_code != 200:
                        continue
                    msg_list = r.json().get("messages", [])
                    for m in msg_list[:8]:
                        md = await client.get(
                            f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{m['id']}",
                            params={"format": "metadata", "metadataHeaders": "From,Subject"},
                            headers={"Authorization": f"Bearer {token}"},
                        )
                        if md.status_code != 200:
                            continue
                        payload = md.json().get("payload", {})
                        headers = {h["name"].lower(): h["value"] for h in payload.get("headers", [])}
                        items.append({
                            "provider": "gmail",
                            "id": m["id"],
                            "from": headers.get("from", ""),
                            "subject": headers.get("subject", ""),
                            "snippet": md.json().get("snippet", ""),
                        })
        except Exception:
            continue
    return items


async def calendar_conflicts(ctx: AISessionContext, db: AsyncSession) -> list[dict[str, Any]]:
    """Overlapping calendar events today — schedule clash detection."""
    from zoneinfo import ZoneInfo
    from app.models.crm import ProjectCalendarEvent

    hkt = ZoneInfo("Asia/Hong_Kong")
    day_start = datetime.now(hkt).replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)

    rows = (
        await db.execute(
            select(ProjectCalendarEvent)
            .where(
                ProjectCalendarEvent.tenant_id == ctx.tenant_id,
                ProjectCalendarEvent.start >= day_start,
                ProjectCalendarEvent.start < day_end,
                ProjectCalendarEvent.is_all_day.is_(False),
            )
            .order_by(ProjectCalendarEvent.start.asc())
        )
    ).scalars().all()

    conflicts: list[dict[str, Any]] = []
    for i in range(len(rows) - 1):
        a, b = rows[i], rows[i + 1]
        a_end = a.end if a.end else a.start
        if b.start < a_end:
            conflicts.append({
                "event_a": a.title,
                "event_b": b.title,
                "overlap_start": b.start.isoformat(),
                "event_a_end": a_end.isoformat(),
            })
    return conflicts


async def news_industry(ctx: AISessionContext, db: AsyncSession) -> list[dict[str, Any]]:
    """Latest business/industry headlines from public RSS feeds."""
    feeds = [
        "https://www.scmp.com/rss/91/feed",
        "https://feeds.bbci.co.uk/news/business/rss.xml",
    ]
    items: list[dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT, headers={"User-Agent": _USER_AGENT}, follow_redirects=True) as client:
            for url in feeds:
                try:
                    r = await client.get(url)
                    if r.status_code != 200:
                        continue
                    root = ET.fromstring(r.text)
                    for item in root.iter("item"):
                        title = item.findtext("title") or ""
                        link = item.findtext("link") or ""
                        pub = item.findtext("pubDate") or ""
                        items.append({
                            "feed": url.split("/")[2],
                            "title": title.strip(),
                            "link": link.strip(),
                            "published": pub.strip(),
                        })
                        if len(items) >= 10:
                            break
                except Exception:
                    continue
                if len(items) >= 10:
                    break
    except Exception:
        return []
    return items


def _simplify_traffic(text: str, is_en: bool) -> str:
    """壓縮交通消息成「地點：事件」重點格式；無法分析時 fallback 用原文。"""
    t = (text or "").strip()
    if not t:
        return t
    if is_en:
        # e.g. "Due to a traffic accident, some lanes at the junction of Canton
        #       Road and Austin Road are now closed."
        m = re.match(
            r"(?:due to|owing to|because of)\s+(.+?)[,;]\s*(.+?)\s+(?:are|is|have been|has been)\s+(.+?)[.]?$",
            t,
            re.IGNORECASE,
        )
        if m:
            event = m.group(1).strip()
            loc = m.group(2).strip()
            cons = m.group(3).strip()
            mm = re.search(r"\b(?:at|on|near|along)\s+(.+)$", loc, re.IGNORECASE)
            if mm:
                loc = mm.group(1).strip()
            action = ""
            for kw in ("reopened", "resumed", "cleared", "closed", "blocked", "suspended", "flooded"):
                if kw in cons.lower():
                    action = f", {kw}"
                    break
            return f"{loc}: {event}{action}"
        return t

    # zh-HK / zh-TW：因/由於/因為 <事件>，<地點> 的 <結果>
    m = re.match(r"(?:因|由於|因為)(.+?)[，,]\s*([^，。]+?)(?:的|嘅)(.+?)[。]?$", t)
    if m:
        event = m.group(1).strip()
        loc = m.group(2).strip()
        result = m.group(3).strip()
        action = ""
        for kw in ("封閉", "封路", "受阻", "暫停", "改道", "擠塞", "關閉", "封鎖"):
            if kw in result:
                action = kw
                break
        if not action:
            for kw in ("重開", "恢復", "解封"):
                if kw in result:
                    action = kw
                    break
        return f"{loc}：{event}{action}"
    # 「較早前因 <事件> 而 <動作> 的 <地點> 已重開」類
    m2 = re.match(r"較?早前?因(.+?)而(.+?)的(.+?)(?:已|經)?(重開|恢復|解封)[。]?$", t)
    if m2:
        return f"{m2.group(3).strip()}：{m2.group(1).strip()}{m2.group(4)}"
    return t


async def traffic_commute(
    ctx: AISessionContext,
    db: AsyncSession,
    lang_pref: str = "zh-HK",
) -> list[dict[str, Any]]:
    """Live HK traffic incidents from Transport Department (data.gov.hk).

    用 ChinShort/EngShort 短版 + 分析壓縮成「地點：事件」重點，只保留
    status 1/3，limit 5。`lang_pref` 控制語言（zh-HK → 中文，en → 英文）。
    """
    items: list[dict[str, Any]] = []
    is_en = lang_pref.startswith("en")
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT, headers={"User-Agent": _USER_AGENT}) as client:
            r = await client.get("https://resource.data.one.gov.hk/td/en/specialtrafficnews.xml")
            if r.status_code != 200:
                return []
            root = ET.fromstring(r.text)
            for msg in root.iter("{http://data.one.gov.hk/td}message"):
                status = msg.findtext("{http://data.one.gov.hk/td}CurrentStatus") or ""
                if status not in ("1", "3"):  # 1 = active incident, 3 = special arrangement (2 = resolved)
                    continue
                if is_en:
                    raw = (
                        msg.findtext("{http://data.one.gov.hk/td}EngShort")
                        or msg.findtext("{http://data.one.gov.hk/td}EngText")
                        or ""
                    )
                else:
                    raw = (
                        msg.findtext("{http://data.one.gov.hk/td}ChinShort")
                        or msg.findtext("{http://data.one.gov.hk/td}ChinText")
                        or ""
                    )
                items.append({
                    "id": msg.findtext("{http://data.one.gov.hk/td}msgID") or "",
                    "text": _simplify_traffic(raw, is_en),
                })
    except Exception:
        return []
    return items[:5]


async def email_draft_review(ctx: AISessionContext, db: AsyncSession) -> list[dict[str, Any]]:
    """AI-generated drafts awaiting user review."""
    from app.models.crm_module_c import AiDraft

    rows = (
        await db.execute(
            select(AiDraft)
            .where(
                AiDraft.tenant_id == ctx.tenant_id,
                AiDraft.user_id == ctx.user_id,
                AiDraft.status == "pending_review",
            )
            .order_by(AiDraft.created_at.desc())
            .limit(8)
        )
    ).scalars().all()
    return [_row_to_dict(r) for r in rows]


async def customer_sentiment(ctx: AISessionContext, db: AsyncSession) -> list[dict[str, Any]]:
    """Recent customer-message sentiment summary (keyword-based, no LLM call)."""
    from sqlalchemy import text as sa_text

    # ai_messages is partitioned; Message model may point at `messages` (legacy).
    # Query the partitioned parent directly with tenant isolation via ai_sessions.
    since = datetime.now(_UTC) - timedelta(days=30)
    try:
        rows = (
            await db.execute(
                sa_text(
                    """
                    SELECT m.content, m.created_at
                    FROM nexus_ai.ai_messages m
                    JOIN nexus_ai.ai_sessions s ON s.id = m.session_id
                    WHERE s.tenant_id = :tid
                      AND s.user_id = :uid
                      AND m.role = 'user'
                      AND m.created_at >= :since
                    ORDER BY m.created_at DESC
                    LIMIT 100
                    """
                ),
                {"tid": str(ctx.tenant_id), "uid": str(ctx.user_id), "since": since},
            )
        ).all()
    except Exception:
        return []

    pos_words = ["great", "excellent", "happy", "thanks", "thank", "good", "love", "perfect", "satisfied", "awesome"]
    neg_words = ["bad", "terrible", "unhappy", "angry", "frustrated", "delay", "slow", "broken", "issue", "complaint", "disappointed", "poor", "wrong", "fail", "error"]

    total = len(rows)
    pos = sum(1 for r in rows if any(w in (r[0] or "").lower() for w in pos_words))
    neg = sum(1 for r in rows if any(w in (r[0] or "").lower() for w in neg_words))
    if total == 0:
        return []

    samples = [
        {"content": r[0][:200], "created_at": r[1].isoformat() if r[1] else ""}
        for r in rows[:5]
    ]
    return [{
        "total_messages": total,
        "positive": pos,
        "negative": neg,
        "neutral": total - pos - neg,
        "positive_pct": round(pos / total * 100, 1),
        "negative_pct": round(neg / total * 100, 1),
        "samples": samples,
    }]


async def expense_reminders(ctx: AISessionContext, db: AsyncSession) -> list[dict[str, Any]]:
    """Pending expenses awaiting approval/reimbursement."""
    from app.models.crm_module_c import Expense

    rows = (
        await db.execute(
            select(Expense)
            .where(
                Expense.tenant_id == ctx.tenant_id,
                Expense.user_id == ctx.user_id,
                Expense.status == "pending",
            )
            .order_by(Expense.expense_date.asc().nulls_last(), Expense.created_at.desc())
            .limit(8)
        )
    ).scalars().all()

    items = []
    for r in rows:
        d = _row_to_dict(r)
        d["amount"] = float(r.amount or 0)
        items.append(d)
    return items


async def personal_reminders(ctx: AISessionContext, db: AsyncSession) -> list[dict[str, Any]]:
    """Upcoming personal reminders/memos not yet done."""
    from app.models.crm_module_c import PersonalNote

    rows = (
        await db.execute(
            select(PersonalNote)
            .where(
                PersonalNote.tenant_id == ctx.tenant_id,
                PersonalNote.user_id == ctx.user_id,
                PersonalNote.done.is_(False),
                PersonalNote.remind_at >= datetime.now(_UTC) - timedelta(hours=1),
            )
            .order_by(PersonalNote.remind_at.asc().nulls_last())
            .limit(8)
        )
    ).scalars().all()
    return [_row_to_dict(r) for r in rows]
