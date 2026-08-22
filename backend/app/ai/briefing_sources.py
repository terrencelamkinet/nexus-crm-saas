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

from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.session.context import AISessionContext
from app.ai.tool_registry import _row_to_dict
from app.models.crm import Company, Project, Touchpoint
from app.models.crm_module_b import Deal, Quote

_UTC = timezone.utc
HKT = timezone(timedelta(hours=8))


def _hkt_iso(dt: Any) -> str:
    """Serialize a datetime as HKT wall-clock ISO ('YYYY-MM-DDTHH:MM:SS')."""
    if dt.tzinfo:
        dt = dt.astimezone(HKT)
    else:
        dt = dt.replace(tzinfo=HKT)
    return dt.isoformat()


async def project_status(ctx: AISessionContext, db: AsyncSession, options: dict | None = None) -> list[dict[str, Any]]:
    """Active projects (not done/cancelled), nearest deadline first.

    Deep options:
      - ownership: 'mine' (project_manager_id == user) / 'all'
      - count: '3' | '5' | '8' | '10' (limit)
    """
    opts = options or {}
    ownership = opts.get("ownership", "mine")
    limit = int(opts.get("count", 8) or 8)

    q = (
        select(Project, Company.name)
        .join(Company, Company.id == Project.company_id, isouter=True)
        .where(
            Project.tenant_id == ctx.tenant_id,
            Project.status.notin_(["done", "cancelled", "archived"]),
        )
        .order_by(Project.deadline.asc().nulls_last())
        .limit(limit)
    )
    if ownership == "mine":
        q = q.where(Project.project_manager_id == ctx.user_id)
    rows = (await db.execute(q)).all()

    items = []
    for r, company_name in rows:
        d = _row_to_dict(r)
        d["company_name"] = company_name
        items.append(d)
    return items


async def stale_deals(ctx: AISessionContext, db: AsyncSession, days: int = 14, options: dict | None = None) -> list[dict[str, Any]]:
    """Open deals with no activity for `days` — stalled opportunities.

    Deep options:
      - days: '7' | '14' | '30' (staleness cutoff; overrides positional days)
      - sort: 'amount' | 'staleness' (updated_at asc)
    """
    opts = options or {}
    days = int(opts.get("days", days) or days)
    sort = opts.get("sort", "staleness")
    cutoff = datetime.now(_UTC) - timedelta(days=days)
    order_col = Deal.amount.desc().nulls_last() if sort == "amount" else Deal.updated_at.asc()
    rows = (
        await db.execute(
            select(Deal, Company.name)
            .join(Company, Company.id == Deal.company_id, isouter=True)
            .where(
                Deal.tenant_id == ctx.tenant_id,
                Deal.status == "open",
                Deal.updated_at < cutoff,
            )
            .order_by(order_col)
            .limit(8)
        )
    ).all()

    items = []
    for r, company_name in rows:
        d = _row_to_dict(r)
        d["company_name"] = company_name
        items.append(d)
    return items


async def quote_tracking(ctx: AISessionContext, db: AsyncSession, options: dict | None = None) -> list[dict[str, Any]]:
    """Pending quotes (sent / draft), expiring soonest first.

    Deep options:
      - statuses: subset of ['draft','sent','expiring'] or 'all'
      - sort: 'valid_until' | 'amount'
    """
    opts = options or {}
    statuses = opts.get("statuses")
    if statuses in (None, "all", ["all"]):
        statuses = ["draft", "sent", "expiring"]
    sort = opts.get("sort", "valid_until")
    order_col = Quote.total.desc().nulls_last() if sort == "amount" else Quote.valid_until.asc().nulls_last()
    rows = (
        await db.execute(
            select(Quote, Deal.name)
            .join(Deal, Deal.id == Quote.deal_id, isouter=True)
            .where(
                Quote.tenant_id == ctx.tenant_id,
                Quote.status.in_(statuses),
            )
            .order_by(order_col)
            .limit(8)
        )
    ).all()

    items = []
    for r, deal_name in rows:
        d = _row_to_dict(r)
        d["deal_name"] = deal_name
        items.append(d)
    return items


async def overdue_followup(ctx: AISessionContext, db: AsyncSession, days: int = 7, options: dict | None = None) -> list[dict[str, Any]]:
    """Contacts with no touchpoint in the last `days` — follow-up due.

    Deep options:
      - days: '3' | '7' | '14' (inactivity cutoff)
      - contact_type: 'all' | 'vip' | 'lead' (contact status filter)
    """
    opts = options or {}
    days = int(opts.get("days", days) or days)
    contact_type = opts.get("contact_type", "all")
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
                *(
                    [Contact.status == "lead"]
                    if contact_type == "lead"
                    else [Contact.status.in_(["customer", "active", "vip"])]
                    if contact_type == "vip"
                    else []
                ),
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


async def birthday_reminders(ctx: AISessionContext, db: AsyncSession, options: dict | None = None) -> list[dict[str, Any]]:
    """Contacts with a birthday in the current HKT month (custom field `birthday_month`, 1-12).

    Deep options:
      - range: 'today' | 'week' | 'month' (default month — backward compatible)
      - type: 'all' | 'customer' | 'colleague' (contact status / category filter)
    """
    from zoneinfo import ZoneInfo
    from app.models.crm import Contact

    opts = options or {}
    range_sel = opts.get("range", "month")
    ctype = opts.get("type", "all")
    hkt_now = datetime.now(ZoneInfo("Asia/Hong_Kong"))
    month = hkt_now.month
    day = hkt_now.day

    type_filters = []
    if ctype == "customer":
        type_filters.append(Contact.status.notin_(["lead", "other"]))
    elif ctype == "colleague":
        type_filters.append(Contact.status.in_(["lead", "other"]))  # 非客戶當同事（寬鬆）

    # range 過濾：month 一定有；today 需要 birthday_day custom field
    # （week 暫用 month 行為 — birthday_day 未有正規化 data）
    range_filter = Contact.custom_fields.op("->>")("birthday_month") == str(month)
    if range_sel == "today":
        range_filter = Contact.custom_fields.op("->>")("birthday_day") == str(day)

    rows = (
        await db.execute(
            select(Contact, Company.name)
            .join(Company, Company.id == Contact.company_id, isouter=True)
            .where(
                Contact.tenant_id == ctx.tenant_id,
                Contact.status.notin_(["churned", "other"]) if ctype != "colleague" else Contact.tenant_id == ctx.tenant_id,
                range_filter,
                *type_filters,
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


async def hot_leads(ctx: AISessionContext, db: AsyncSession, options: dict | None = None) -> list[dict[str, Any]]:
    """High-intent deals: open deals with probability >= threshold, biggest first.

    Deep options:
      - threshold: '50' | '70' | '90' (probability %)
      - sort: 'amount' | 'probability' | 'updated' (updated_at desc)
    """
    opts = options or {}
    threshold = int(opts.get("threshold", 70) or 70)
    sort = opts.get("sort", "amount")
    order_map = {
        "amount": (Deal.amount.desc().nulls_last(),),
        "probability": (Deal.probability.desc(), Deal.amount.desc().nulls_last()),
        "updated": (Deal.updated_at.desc(),),
    }
    order_cols = order_map.get(sort, order_map["amount"])
    rows = (
        await db.execute(
            select(Deal, Company.name)
            .join(Company, Company.id == Deal.company_id, isouter=True)
            .where(
                Deal.tenant_id == ctx.tenant_id,
                Deal.status == "open",
                Deal.probability >= threshold,
            )
            .order_by(*order_cols)
            .limit(8)
        )
    ).all()

    items = []
    for r, company_name in rows:
        d = _row_to_dict(r)
        d["company_name"] = company_name
        items.append(d)
    return items


async def sales_kpi(ctx: AISessionContext, db: AsyncSession, options: dict | None = None) -> list[dict[str, Any]]:
    """Sales target progress: won deals value vs the user's current-period target.

    Deep options:
      - period: 'week' | 'month' | 'quarter' — 用嚟兜底揀 target
        （user_targets 本身有 period_start/end；冇 target 時唔會 fake data）
    """
    opts = options or {}
    period = opts.get("period", "month")
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


async def team_updates(ctx: AISessionContext, db: AsyncSession, options: dict | None = None) -> list[dict[str, Any]]:
    """Recent task activity from the user's teams.

    Deep options:
      - scope: 'my_teams' | 'all_company'（all_company 唔限 team — 全 tenant 開放 tasks）
      - task_status: 'in_progress' | 'pending' | 'all'
    """
    opts = options or {}
    scope = opts.get("scope", "my_teams")
    task_status = opts.get("task_status", "all")
    from app.models.crm import Task
    from app.models.crm_module_c import Team, TeamMember

    # teams the current user belongs to
    if scope == "all_company":
        # TeamMember 冇 tenant_id — join teams 攞全 tenant 成員
        team_ids: list = []
        member_ids = (
            await db.execute(
                select(TeamMember.user_id)
                .join(Team, Team.id == TeamMember.team_id)
                .where(Team.tenant_id == ctx.tenant_id)
            )
        ).scalars().all()
        teams: dict = {}
    else:
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

    status_filter = ["pending", "in_progress"]
    if task_status == "pending":
        status_filter = ["pending"]
    elif task_status == "in_progress":
        status_filter = ["in_progress"]

    # recent open tasks assigned to any team member
    rows = (
        await db.execute(
            select(Task)
            .where(
                Task.tenant_id == ctx.tenant_id,
                Task.assignee_id.in_(member_ids),
                Task.status.in_(status_filter),
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


async def invoice_reminders(ctx: AISessionContext, db: AsyncSession, options: dict | None = None) -> list[dict[str, Any]]:
    """Outstanding quotations (DRAFT/PENDING) — invoice module proxy.

    Deep options:
      - statuses: subset of ['pending','sent','overdue'] or 'all'
    """
    from app.models.crm_module_c import Quotation

    opts = options or {}
    statuses = opts.get("statuses")
    if statuses in (None, "all", ["all"]):
        statuses = ["DRAFT", "PENDING", "SENT"]
    else:
        mapping = {"pending": "PENDING", "sent": "SENT", "overdue": "DRAFT"}
        statuses = [mapping.get(s, s.upper()) for s in statuses]

    rows = (
        await db.execute(
            select(Quotation)
            .where(
                Quotation.tenant_id == ctx.tenant_id,
                Quotation.status.in_(statuses),
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


async def weather(ctx: AISessionContext, db: AsyncSession, options: dict | None = None) -> list[dict[str, Any]]:
    """Current HK weather from HKO Open Data (rhrread).

    Deep options:
      - region: ['hk_island'|'kowloon'|'nt_east'|'nt_west'|'all_hk'] —
        HKO rhrread 係全港 station 數據；region 用嚟揀最近 station（有 station 就先篩）
      - unit: 'celsius' | 'fahrenheit'（溫度轉換）
    """
    opts = options or {}
    unit = opts.get("unit", "celsius")
    regions = opts.get("region") or ["all_hk"]
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
        temp_value = temp.get("value")
        if unit == "fahrenheit" and temp_value is not None:
            temp_value = round(float(temp_value) * 9 / 5 + 32, 1)
        items.append({
            "place": temp.get("place", "Hong Kong"),
            "temperature": temp_value,
            "unit": unit,
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


async def unread_messages(ctx: AISessionContext, db: AsyncSession, options: dict | None = None) -> list[dict[str, Any]]:
    """Unread inbox messages from connected mail providers (Gmail/Outlook).
    Returns [] when no mail integration is connected — graceful no-op.

    Deep options:
      - sources: ['gmail'|'outlook_mail'] subset or 'all'
      - count: '3' | '5' | '8'（每 provider 上限）
    """
    opts = options or {}
    sources = opts.get("sources")
    if sources in (None, "all", ["all"]):
        sources = ["gmail", "outlook_mail"]
    count = int(opts.get("count", 8) or 8)
    from app.models.integration import Integration

    rows = (
        await db.execute(
            select(Integration).where(
                Integration.tenant_id == ctx.tenant_id,
                Integration.user_id == ctx.user_id,
                Integration.status == "active",
                Integration.provider.in_(sources),
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
                        params={"q": "is:unread", "maxResults": count},
                        headers={"Authorization": f"Bearer {token}"},
                    )
                    if r.status_code != 200:
                        continue
                    msg_list = r.json().get("messages", [])
                    for m in msg_list[:count]:
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


async def calendar_conflicts(ctx: AISessionContext, db: AsyncSession, options: dict | None = None) -> list[dict[str, Any]]:
    """Overlapping calendar events — schedule clash detection.

    Deep options:
      - range: 'today' | 'today_tomorrow'（檢測範圍）
    """
    from zoneinfo import ZoneInfo
    from app.models.crm import ProjectCalendarEvent

    opts = options or {}
    range_sel = opts.get("range", "today")

    hkt = ZoneInfo("Asia/Hong_Kong")
    day_start = datetime.now(hkt).replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=2 if range_sel == "today_tomorrow" else 1)

    rows = (
        await db.execute(
            select(ProjectCalendarEvent)
            .where(
                ProjectCalendarEvent.tenant_id == ctx.tenant_id,
                ProjectCalendarEvent.start >= day_start,
                ProjectCalendarEvent.start < day_end,
                ProjectCalendarEvent.is_all_day.is_(False),
                # per-user isolation — own + shared events only
                (ProjectCalendarEvent.owner_user_id == ctx.user_id)
                | (ProjectCalendarEvent.owner_user_id.is_(None)),
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
                "overlap_start": _hkt_iso(b.start),
                "event_a_end": _hkt_iso(a_end),
            })
    return conflicts


async def news_industry(ctx: AISessionContext, db: AsyncSession, options: dict | None = None) -> list[dict[str, Any]]:
    """Latest business/industry headlines from public RSS feeds.

    Deep options:
      - topics: subset of ['tech','finance','logistics','retail'] or 'all'
        （keyword 篩選 title；'all' = 唔篩）
      - lang: 'zh' | 'en' | 'both'（zh = SCMP，en = BBC，both = 兩個 feed）
    """
    opts = options or {}
    topics = opts.get("topics")
    if topics in (None, "all", ["all"]):
        topics = []
    lang = opts.get("lang", "both")
    feeds = []
    if lang in ("zh", "both"):
        feeds.append("https://www.scmp.com/rss/91/feed")
    if lang in ("en", "both"):
        feeds.append("https://feeds.bbci.co.uk/news/business/rss.xml")

    # topic keyword map（英文 + 中文 keyword 兜底）
    TOPIC_KEYWORDS = {
        "tech": ["tech", "ai", "software", "cloud", "digital", "科技", "人工智能", "軟件"],
        "finance": ["bank", "financ", "invest", "market", "stock", "金融", "銀行", "投資", "市場"],
        "logistics": ["shipping", "logistic", "supply", "cargo", "港口", "物流", "供應鏈", "貨運"],
        "retail": ["retail", "consumer", "shop", "e-commerce", "零售", "消費", "電商"],
    }
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
                        if topics:
                            tl = title.lower()
                            if not any(
                                kw.lower() in tl
                                for t in topics
                                for kw in TOPIC_KEYWORDS.get(t, [t])
                            ):
                                continue
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
    options: dict | None = None,
) -> list[dict[str, Any]]:
    """Live HK traffic incidents from Transport Department (data.gov.hk).

    用 ChinShort/EngShort 短版 + 分析壓縮成「地點：事件」重點，只保留
    status 1/3，limit 5。`lang_pref` 控制語言（zh-HK → 中文，en → 英文）。

    Deep options:
      - route: 'home_to_office' | 'office_to_home' | 'custom' — 暫時冇路線
        過濾數據（運輸署 API 唔提供），保留做未來 commute 設定
      - mode: 'driving' | 'public' — 同上，pass-through
    """
    opts = options or {}
    # route / mode 目前係 pass-through — 運輸署 specialtrafficnews 係全港數據
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


async def email_draft_review(ctx: AISessionContext, db: AsyncSession, options: dict | None = None) -> list[dict[str, Any]]:
    """AI-generated drafts awaiting user review.

    Deep options:
      - status: 'pending_review' | 'approved' | 'all'
    """
    opts = options or {}
    status = opts.get("status", "pending_review")
    statuses = ["pending_review"] if status == "pending_review" else (["approved"] if status == "approved" else None)
    from app.models.crm_module_c import AiDraft

    q = (
        select(AiDraft)
        .where(
            AiDraft.tenant_id == ctx.tenant_id,
            AiDraft.user_id == ctx.user_id,
        )
        .order_by(AiDraft.created_at.desc())
        .limit(8)
    )
    if statuses is not None:
        q = q.where(AiDraft.status.in_(statuses))
    rows = (await db.execute(q)).scalars().all()
    return [_row_to_dict(r) for r in rows]


async def customer_sentiment(ctx: AISessionContext, db: AsyncSession, options: dict | None = None) -> list[dict[str, Any]]:
    """Recent customer-message sentiment summary (keyword-based, no LLM call).

    Deep options:
      - days: '7' | '14' | '30'（分析窗口）
      - show: 'all' | 'negative_only'（返全部計分定只負面樣本）
    """
    opts = options or {}
    days = int(opts.get("days", 30) or 30)
    show = opts.get("show", "all")
    from sqlalchemy import text as sa_text

    # ai_messages is partitioned; Message model may point at `messages` (legacy).
    # Query the partitioned parent directly with tenant isolation via ai_sessions.
    since = datetime.now(_UTC) - timedelta(days=days)
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
        if show != "negative_only" or any(w in (r[0] or "").lower() for w in neg_words)
    ]
    return [{
        "total_messages": total,
        "positive": pos,
        "negative": neg,
        "neutral": total - pos - neg,
        "positive_pct": round(pos / total * 100, 1),
        "negative_pct": round(neg / total * 100, 1),
        "samples": samples[:5],
    }]


async def expense_reminders(ctx: AISessionContext, db: AsyncSession, options: dict | None = None) -> list[dict[str, Any]]:
    """Pending expenses awaiting approval/reimbursement.

    Deep options:
      - status: 'pending' | 'approved' | 'all'
    """
    opts = options or {}
    status = opts.get("status", "pending")
    statuses = [status] if status != "all" else None
    from app.models.crm_module_c import Expense

    q = (
        select(Expense)
        .where(
            Expense.tenant_id == ctx.tenant_id,
            Expense.user_id == ctx.user_id,
        )
        .order_by(Expense.expense_date.asc().nulls_last(), Expense.created_at.desc())
        .limit(8)
    )
    if statuses is not None:
        q = q.where(Expense.status.in_(statuses))
    rows = (await db.execute(q)).scalars().all()

    items = []
    for r in rows:
        d = _row_to_dict(r)
        d["amount"] = float(r.amount or 0)
        items.append(d)
    return items


async def personal_reminders(ctx: AISessionContext, db: AsyncSession, options: dict | None = None) -> list[dict[str, Any]]:
    """Upcoming personal reminders/memos not yet done.

    Deep options:
      - range: '1h' | 'today' | 'week'（remind_at 窗口）
    """
    opts = options or {}
    range_sel = opts.get("range", "1h")
    window_hours = {"1h": 1, "today": 24, "week": 168}.get(range_sel, 1)
    from app.models.crm_module_c import PersonalNote

    rows = (
        await db.execute(
            select(PersonalNote)
            .where(
                PersonalNote.tenant_id == ctx.tenant_id,
                PersonalNote.user_id == ctx.user_id,
                PersonalNote.done.is_(False),
                PersonalNote.remind_at >= datetime.now(_UTC) - timedelta(hours=window_hours),
            )
            .order_by(PersonalNote.remind_at.asc().nulls_last())
            .limit(8)
        )
    ).scalars().all()
    return [_row_to_dict(r) for r in rows]


# ═══════════════════════════════════════════════════════════════
# Bible Reading — 讀經進度 module（2026-08-22 spec）
# ═══════════════════════════════════════════════════════════════

BIBLE_PLAN_TOTAL_DAYS = {
    "one_year": 365,
    "ninety_days": 90,
    "thirty_days_topical": 30,
    "chronological": 365,
    "custom_pace": None,
}

# 譯本 → 中文名（display 用）
BIBLE_TRANSLATION_LABELS = {
    "cuvmp": "和合本", "cnvs": "新譯本", "esv": "ESV", "niv": "NIV", "kjv": "KJV",
}


def _resolve_passages_for_day(
    plan: str, book_selection: str, day_index: int, chapters_per_push: str,
) -> list[str]:
    """Map (plan, day_index) → list of scripture references.

    Static deterministic mapping — 唔 call 3rd-party API。以 365 日一年計劃
    為基準，簡單線性分配；90/30 日計劃壓縮比例。實際 verse 內容由
    bible_verses 表提供（seed 匯入），呢度只出 reference 範圍。
    """
    # 舊約 39 卷（粗略 929 章）／新約 27 卷（260 章）— 用簡化比例
    ot_chapters = 929
    nt_chapters = 260
    total_chapters = ot_chapters + nt_chapters

    ratio = {"one_year": 1.0, "ninety_days": 365 / 90, "thirty_days_topical": 365 / 30,
             "chronological": 1.0, "custom_pace": 1.0}.get(plan, 1.0)
    per_day = int(chapters_per_push) if chapters_per_push not in ("full_passage", None) else 1

    # 書卷順序（簡化 — 舊約 + 新約 canonical order，用 common book names）
    ot_books = ["創世記", "出埃及記", "利未記", "民數記", "申命記", "約書亞記", "士師記",
                "路得記", "撒母耳記上", "撒母耳記下", "列王紀上", "列王紀下", "歷代志上",
                "歷代志下", "以斯拉記", "尼希米記", "以斯帖記", "約伯記", "詩篇", "箴言",
                "傳道書", "雅歌", "以賽亞書", "耶利米書", "耶利米哀歌", "以西結書", "但以理書",
                "何西阿書", "約珥書", "阿摩司書", "俄巴底亞書", "約拿書", "彌迦書", "那鴻書",
                "哈巴谷書", "西番雅書", "哈該書", "撒迦利亞書", "瑪拉基書"]
    nt_books = ["馬太福音", "馬可福音", "路加福音", "約翰福音", "使徒行傳", "羅馬書",
                "哥林多前書", "哥林多後書", "加拉太書", "以弗所書", "腓立比書", "歌羅西書",
                "帖撒羅尼迦前書", "帖撒羅尼迦後書", "提摩太前書", "提摩太後書", "提多書",
                "腓利門書", "希伯來書", "雅各書", "彼得前書", "彼得後書", "約翰一書",
                "約翰二書", "約翰三書", "猶大書", "啟示錄"]

    # book_selection → 用邊啲書卷
    if book_selection == "ot_full":
        books = ot_books
    elif book_selection == "nt_full":
        books = nt_books
    elif book_selection == "psalms_proverbs":
        books = ["詩篇", "箴言"]
    elif book_selection == "gospels":
        books = ["馬太福音", "馬可福音", "路加福音", "約翰福音"]
    elif book_selection == "pentateuch":
        books = ot_books[:5]
    elif book_selection == "pauline_epistles":
        books = ["羅馬書", "哥林多前書", "哥林多後書", "加拉太書", "以弗所書",
                 "腓立比書", "歌羅西書", "帖撒羅尼迦前書", "帖撒羅尼迦後書",
                 "提摩太前書", "提摩太後書", "提多書", "腓利門書"]
    else:  # ot_nt_mixed / custom
        books = ot_books + nt_books

    # 簡化：每本書當 1 章/day 比例 — 用 day_index 對應書卷（循環）
    if not books:
        return []
    book = books[day_index % len(books)]
    ch = (day_index // len(books)) % 5 + 1  # 粗略 chapter 循環 1-5
    return [f"{book} {ch}"]


async def bible_reading(ctx: AISessionContext, db: AsyncSession, options: dict | None = None) -> list[dict[str, Any]]:
    """讀經進度：根據 book_selection + plan + chapters_per_push 計算今日經文。

    Deep options（6 個）:
      - book_selection: ot_full / nt_full / ot_nt_mixed / psalms_proverbs /
        gospels / pentateuch / pauline_epistles / custom
      - plan: one_year / ninety_days / thirty_days_topical / chronological / custom_pace
      - chapters_per_push: '1' | '2' | '3' | 'full_passage'
      - time_of_day: morning / noon / evening / night（對齊 SLOT_PROMPTS）
      - translation: cuvmp / cnvs / esv / niv / kjv
      - reminder: enabled / silent

    數據源：bible_reading_progress（進度）+ bible_verses（靜態經文）。
    經文必須逐字呈現 — 唔可以由 LLM 改寫（prompt 層另加硬性規則）。
    """
    opts = options or {}
    plan = opts.get("plan", "one_year")
    chapters = opts.get("chapters_per_push", "1")
    translation = opts.get("translation", "cuvmp")
    book_selection = opts.get("book_selection", "ot_nt_mixed")
    reminder = opts.get("reminder", "enabled")

    from app.models.bible_reading import BibleReadingProgress, BibleVerse

    try:
        progress = (
            await db.execute(
                select(BibleReadingProgress).where(
                    BibleReadingProgress.tenant_id == ctx.tenant_id,
                    BibleReadingProgress.user_id == ctx.user_id,
                    BibleReadingProgress.plan == plan,
                )
            )
        ).scalar_one_or_none()

        if progress is None:
            progress = BibleReadingProgress(
                tenant_id=ctx.tenant_id,
                user_id=ctx.user_id,
                plan=plan,
                book_selection=book_selection,
                day_index=0,
                started_at=datetime.now(_UTC),
            )
            db.add(progress)
            await db.flush()

        passages = _resolve_passages_for_day(
            plan=plan, book_selection=book_selection,
            day_index=progress.day_index, chapters_per_push=chapters,
        )
        if not passages:
            return []

        async def _fetch_verses(trans: str):
            # passage 格式係「馬太福音 1」（冇 verse number）— 用 prefix match
            # 先 match 到「馬太福音 1:1」…「馬太福音 1:25」全部 verses
            clause = [
                or_(*[BibleVerse.reference.like(f"{p}:%") for p in passages]),
            ]
            return (
                await db.execute(
                    select(BibleVerse).where(
                        BibleVerse.translation == trans,
                        *clause,
                    ).order_by(BibleVerse.reference.asc())
                )
            ).scalars().all()

        verses = await _fetch_verses(translation)

        if not verses:
            # 指定譯本未 seed → fallback 去 kjv（public-domain seed 齊全），
            # 再唔得先出 pending_seed 進度資訊
            fallback_translation = "kjv"
            verses = await _fetch_verses(fallback_translation)
            if verses:
                translation = fallback_translation
            else:
                return [{
                    "reference": passages[0], "text": "", "translation": translation,
                    "day_index": progress.day_index,
                    "total_days": BIBLE_PLAN_TOTAL_DAYS.get(plan),
                    "reminder": reminder,
                    "pending_seed": True,
                }]
    except Exception:
        return []

    return [
        {
            "reference": v.reference, "text": v.text, "translation": translation,
            "translation_label": BIBLE_TRANSLATION_LABELS.get(translation, translation),
            "day_index": progress.day_index,
            "total_days": BIBLE_PLAN_TOTAL_DAYS.get(plan),
            "reminder": reminder,
        }
        for v in verses
    ]
