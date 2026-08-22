"""Briefing Generator — AI-app-driven daily briefing pipeline.

Workflow (2026-08-01, Terrence spec):
1. 用戶喺 AI 應用揀 modules（SecretarySettings.modules）
2. 指定時間 program 觸發（早安/午安/晚安/深夜）→ 讀用戶選擇 → collect 對應
   modules data（全部 G08 自己 sources：briefing_sources + 自己 DB）
3. LLM（Nexus provider registry，deepseek）生成簡報內容（跟 tone/lang/slot）
4. 存入 PG `generated_briefings`
5. IM Push：用戶喺 AI 應用 enable 咗（IMDeliveryPref）→ WhatsApp 一同發送

G08 完全獨立 — 唔讀任何 Hermes data。
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, date, timezone, timedelta
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.session.context import AISessionContext
from app.ai.providers import get_provider
from app.models.ai.secretary_settings import (
    SecretarySettings,
    DEFAULT_MODULES,
    DEFAULT_MODULE_OPTIONS,
    normalize_modules,
)
from app.models.im_push import IMDeliveryPref, PushLog
from app.models.whatsapp import WhatsAppMapping

HKT = timezone(timedelta(hours=8))

DEFAULT_PROVIDER = "deepseek"
DEFAULT_MODEL = "deepseek-chat"

# slot key → 中文名 + emoji + 指示
SLOT_PROMPTS: dict[str, dict[str, str]] = {
    "morning": {"label": "早安", "emoji": "🌅",
                "instructions": "早晨簡報：天氣 + 今日行程 + 優先任務 + CRM 概覽。展望今日。"},
    "noon": {"label": "午安", "emoji": "☀️",
             "instructions": "午間簡報（輕量）：天氣 + 今日餘下行程 + 今日到期任務提醒。"},
    "evening": {"label": "晚安", "emoji": "🌆",
                "instructions": "收工簡報：今日回顧 + 聽日預告 + 未完任務。"},
    "night": {"label": "深夜", "emoji": "🌙",
              "instructions": "深夜回顧：今日總結 + 聽日預告 + 明日天氣。"},
}

SYSTEM_PROMPT = (
    "你係專業 AI 助理，負責生成每日簡報。\n"
    "硬性規則：\n"
    "- 用 {lang} 書面語/口語（廣東話語感），嚴禁英文敘述\n"
    "- 全部 bullet points，每行一個 fact，高密度，少空行\n"
    "- 有 data 就報 data（具體數字/時間/名稱），冇 data 就 skip 該 section，唔好出空泛句\n"
    "- 嚴禁「一切安好」「暫無特別需要跟進」呢類 AI 腔空泛句\n"
    "- 唔好加 commentary、感想、尾句、encouragement\n"
    "- 語氣：{tone}\n"
    "- 每個 event 標明來源 label（[Kinetix]/[Personal]/[敬拜隊] 等）\n"
    "- 用戶額外指示：{instructions}\n"
)


def _now_hkt() -> datetime:
    return datetime.now(HKT)


def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(HKT) if value.tzinfo else value.replace(tzinfo=HKT)
    s = str(value)
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.astimezone(HKT) if dt.tzinfo else dt.replace(tzinfo=HKT)
    except Exception:
        return None


async def _load_settings(db: AsyncSession, user_id: uuid.UUID) -> SecretarySettings | None:
    row = (
        await db.execute(
            select(SecretarySettings).where(SecretarySettings.user_id == user_id)
        )
    ).scalar_one_or_none()
    return row


def _enabled_modules(settings: SecretarySettings | None) -> dict[str, dict]:
    """Return {module_key: options_dict} for the user's enabled modules.

    Handles both legacy string[] storage and new dict-with-options format.
    """
    if settings is None:
        return {m: dict(DEFAULT_MODULE_OPTIONS.get(m, {})) for m in DEFAULT_MODULES}
    return normalize_modules(settings.modules or DEFAULT_MODULES)


async def _collect_modules(ctx: AISessionContext, db: AsyncSession, modules: dict[str, dict]) -> dict[str, Any]:
    """Collect data for the user's enabled modules — all G08's own sources.

    `modules` = {module_key: options_dict}（深層選項 per module）。每個
    source function 接收 options 做篩選；冇 options 嘅 module 用預設。
    """
    from app.ai import briefing_sources as bs
    from app.routers.ai import _build_crm_briefing

    # Force calendar sync before collecting schedule (mirror check — remote
    # updates land in project_calendar_events before the briefing reads them).
    try:
        from app.services.calendar_sync import sync_user_calendars
        await sync_user_calendars(db, ctx.tenant_id, ctx.user_id, force=True)
    except Exception:
        pass  # never block the briefing on sync failure

    out: dict[str, Any] = {}
    brief = await _build_crm_briefing(ctx, db)
    out["schedule"] = brief.get("schedule", [])
    out["tasks"] = brief.get("tasks", [])
    out["weather"] = brief.get("weather", {})

    # ── today_tasks 深層選項：scope（personal/work/both）+ sort ──
    task_opts = modules.get("today_tasks") or {}
    scope = task_opts.get("scope", "both")
    sort = task_opts.get("sort", "priority")
    tasks = out["tasks"]
    if scope in ("personal", "work"):
        tasks = [
            t for t in tasks
            if (t.get("area") or "").lower() == scope
            or (scope == "personal" and t.get("assignee_id") == str(ctx.user_id))
            or (scope == "work" and t.get("assignee_id") is not None and t.get("assignee_id") != str(ctx.user_id))
        ]
    sort_key = {"priority": lambda t: {"urgent": 0, "high": 1, "medium": 2, "low": 3}.get((t.get("priority") or "medium").lower(), 2),
                "deadline": lambda t: t.get("due_date") or "9999-12-31",
                "created_at": lambda t: t.get("created_at") or ""}.get(sort, lambda t: 0)
    out["tasks"] = sorted(tasks, key=sort_key)

    # ── meetings 深層選項：range（today/today_tomorrow/week）— schedule 已係 7 日，
    #    過濾今日/聽日；type 嘅 CRM 客戶 vs 內部暫以 title 關鍵字粗略分 ──
    meet_opts = modules.get("meetings") or {}
    mrange = meet_opts.get("range", "today_tomorrow")
    mtype = meet_opts.get("type", "all")
    today_hkt = datetime.now(HKT).strftime("%Y-%m-%d")
    tomorrow_hkt = (datetime.now(HKT) + timedelta(days=1)).strftime("%Y-%m-%d")
    if mrange == "today":
        out["schedule"] = [e for e in out["schedule"] if str(e.get("time", "")).startswith(today_hkt)]
    elif mrange == "today_tomorrow":
        out["schedule"] = [e for e in out["schedule"]
                           if str(e.get("time", "")).startswith(today_hkt)
                           or str(e.get("time", "")).startswith(tomorrow_hkt)]
    # mrange == 'week' → 保留全部（7 日內）
    if mtype == "customer":
        out["schedule"] = [e for e in out["schedule"] if any(k in str(e.get("title", "")) for k in ("客戶", "client", "customer", "會議", "meeting"))]
    elif mtype == "internal":
        out["schedule"] = [e for e in out["schedule"] if not any(k in str(e.get("title", "")) for k in ("客戶", "client", "customer"))]

    fn_map = {
        "project_status": bs.project_status,
        "stale_deals": bs.stale_deals,
        "quote_tracking": bs.quote_tracking,
        "overdue_followup": bs.overdue_followup,
        "birthday_reminders": bs.birthday_reminders,
        "hot_leads": bs.hot_leads,
        "sales_kpi": bs.sales_kpi,
        "team_updates": bs.team_updates,
        "invoice_reminders": bs.invoice_reminders,
        "unread_messages": bs.unread_messages,
        "calendar_conflicts": bs.calendar_conflicts,
        "news_industry": bs.news_industry,
        "traffic_commute": bs.traffic_commute,
        "email_draft_review": bs.email_draft_review,
        "customer_sentiment": bs.customer_sentiment,
        "expense_reminders": bs.expense_reminders,
        "personal_reminders": bs.personal_reminders,
        "bible_reading": bs.bible_reading,
    }
    for key, opts in modules.items():
        fn = fn_map.get(key)
        if fn is None:
            continue
        try:
            out[key] = await fn(ctx, db, opts or {})
        except Exception:
            out[key] = []

    # 日期 label 輔助：schedule item 帶 calendar label（如有）
    return out


def _build_prompt(slot: str, settings: SecretarySettings, data: dict[str, Any]) -> list[dict[str, str]]:
    slot_meta = SLOT_PROMPTS.get(slot, SLOT_PROMPTS["morning"])
    lang = settings.lang_pref or "zh-HK"
    lang_name = {"zh-HK": "廣東話/繁體中文", "zh-TW": "繁體中文", "en": "English"}.get(lang, "廣東話/繁體中文")
    tone = settings.tone or "professional"
    user_extra = settings.instructions or "無"

    system = SYSTEM_PROMPT.format(lang=lang_name, tone=tone, instructions=user_extra)

    # 壓縮 data：tasks/schedule 用精簡 list；modules data 原樣（但截斷長 list）
    tasks = data.get("tasks", [])[:15]
    schedule = data.get("schedule", [])[:10]
    modules_summary = {k: v for k, v in data.items() if k not in ("tasks", "schedule", "weather")}
    for k in modules_summary:
        if isinstance(modules_summary[k], list):
            modules_summary[k] = modules_summary[k][:8]

    payload = {
        "date": _now_hkt().strftime("%Y-%m-%d %A"),
        "slot": slot,
        "slot_label": f"{slot_meta['emoji']} {slot_meta['label']}",
        "weather": data.get("weather", {}),
        "schedule": schedule,
        "tasks": tasks,
        "modules": modules_summary,
    }

    user = (
        f"請生成 {slot_meta['emoji']} {slot_meta['label']} 簡報（{_now_hkt().strftime('%Y-%m-%d %A')}）。\n\n"
        f"今日指示：{slot_meta['instructions']}\n\n"
        f"以下係已收集嘅數據（用戶喺 AI 應用揀咗 modules：{', '.join(list(modules_summary.keys()) + ['schedule', 'tasks', 'weather']) if modules_summary else 'default'}）：\n"
        f"```json\n{json.dumps(payload, ensure_ascii=False, default=str, indent=1)}\n```\n\n"
        "輸出：只有簡報內容（以 emoji title 開頭），唔好加任何 metadata 或解釋。"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


async def _im_push_if_enabled(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    slot: str,
    content: str,
) -> str:
    """IM push gated by AI-app user prefs (IMDeliveryPref). Returns 'sent'/'skipped'/'disabled'."""
    now = _now_hkt()
    weekend = now.weekday() >= 5
    try:
        pref = (
            await db.execute(
                select(IMDeliveryPref).where(
                    IMDeliveryPref.tenant_id == tenant_id,
                    IMDeliveryPref.user_id == user_id,
                    IMDeliveryPref.channel == "whatsapp",
                )
            )
        ).scalar_one_or_none()
    except Exception:
        return "disabled"
    if pref is None or not pref.enabled:
        return "disabled"
    slots = pref.slots or {}
    if not slots.get(slot):
        db.add(PushLog(tenant_id=tenant_id, user_id=user_id, channel="whatsapp",
                       slot=slot, status="skipped", reason="slot_off"))
        return "skipped"
    if pref.weekend_mute and weekend:
        db.add(PushLog(tenant_id=tenant_id, user_id=user_id, channel="whatsapp",
                       slot=slot, status="skipped", reason="weekend_mute"))
        return "skipped"
    # quiet hours
    try:
        start_s, end_s = (pref.quiet_hours or {}).get("start", "22:00"), (pref.quiet_hours or {}).get("end", "08:00")
        start = datetime.strptime(start_s, "%H:%M").time()
        end = datetime.strptime(end_s, "%H:%M").time()
        t = now.time()
        in_quiet = (start <= t <= end) if start <= end else (t >= start or t <= end)
        if in_quiet:
            db.add(PushLog(tenant_id=tenant_id, user_id=user_id, channel="whatsapp",
                           slot=slot, status="skipped", reason="quiet_hours"))
            return "skipped"
    except Exception:
        pass

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
        db.add(PushLog(tenant_id=tenant_id, user_id=user_id, channel="whatsapp",
                       slot=slot, status="skipped", reason="no_mapping"))
        return "skipped"

    from app.services import whatsapp_service
    try:
        result = await whatsapp_service.send_text(mapping.wa_id, content)
        ok = isinstance(result, dict) and result.get("messages")
        db.add(PushLog(tenant_id=tenant_id, user_id=user_id, channel="whatsapp", slot=slot,
                       status="sent" if ok else "failed", error="" if ok else str(result)[:300]))
        return "sent" if ok else "failed"
    except Exception as e:  # noqa: BLE001
        db.add(PushLog(tenant_id=tenant_id, user_id=user_id, channel="whatsapp", slot=slot,
                       status="failed", error=str(e)[:300]))
        return "failed"


async def generate_briefing(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    slot: str,
) -> dict[str, Any]:
    """Full pipeline for one user: settings → collect → LLM → store → IM push."""
    settings = await _load_settings(db, user_id)
    modules = _enabled_modules(settings)  # {module_key: options_dict} — 深層選項
    if not modules:
        modules = {m: dict(DEFAULT_MODULE_OPTIONS.get(m, {})) for m in DEFAULT_MODULES}

    from app.ai.session.context import AISessionContext
    ctx = AISessionContext(
        session_id=uuid.uuid4(),
        tenant_id=tenant_id,
        workspace_id=uuid.UUID(int=0),
        user_id=user_id,
        membership_id=uuid.UUID(int=0),
        plan_type="chat",
    )

    data = await _collect_modules(ctx, db, modules)

    # LLM generate
    from app.routers.ai import _default_adapter
    adapter = _default_adapter()
    try:
        content, usage = await adapter.chat(
            messages=_build_prompt(slot, settings or SecretarySettings(user_id=user_id, tenant_id=tenant_id), data),
            model=DEFAULT_MODEL,
            temperature=0.7,
            max_tokens=2048,
        )
    finally:
        await adapter.close()

    # ── Record usage event (briefing module) — central token collection ──
    try:
        from app.models.ai.usage import UsageEvent
        db.add(UsageEvent(
            session_id=None,  # briefing has no chat session
            user_id=user_id,
            tenant_id=tenant_id,
            provider=usage.provider or "deepseek",
            model=usage.model or DEFAULT_MODEL,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cost_estimate=float(usage.cost_usd) if usage.cost_usd else None,
            result_status="success",
            module="briefing",
            currency="USD",
        ))
    except Exception:
        pass  # usage recording is best-effort

    content = (content or "").strip()
    if not content:
        return {"user_id": str(user_id), "slot": slot, "status": "empty_content", "im": "disabled"}

    # store to PG (raw SQL — no model boilerplate)
    from sqlalchemy import text as sql_text
    await db.execute(
        sql_text(
            "INSERT INTO nexus_crm.generated_briefings "
            "(tenant_id, user_id, slot, briefing_date, content, data_snapshot, modules) "
            "VALUES (:tid, :uid, :slot, :d, :content, CAST(:snapshot AS jsonb), :modules)"
        ),
        {
            "tid": tenant_id, "uid": user_id, "slot": slot,
            "d": _now_hkt().date(),
            "content": content,
            "snapshot": json.dumps({k: v for k, v in data.items() if k in ("weather", "schedule", "tasks")},
                                   ensure_ascii=False, default=str),
            "modules": modules,
        },
    )

    # IM push (gated)
    im = await _im_push_if_enabled(db, tenant_id, user_id, slot, content)
    await db.commit()

    return {"user_id": str(user_id), "slot": slot, "status": "published", "im": im, "content": content, "content_len": len(content)}


async def run_for_all_users(db: AsyncSession, slot: str) -> dict[str, Any]:
    """Generate briefings for members of tenants that have CRM data.

    Gate: per-member 檢查 tenant 有冇 CRM data（set GUC → count companies）—
    避免對 debug/空 tenants 燒 LLM。用戶未開過 AI app settings → 用
    DEFAULT_MODULES。注意：db session 嘅 GUC 係 transaction-scoped，每
    member 都要重新 set_config。
    """
    members = (
        await db.execute(
            text(
                "SELECT tenant_id, user_id FROM nexus_auth.nexus_auth_tenant_members"
            )
        )
    ).all()
    stats = {"users": 0, "generated": 0, "im_sent": 0, "im_skipped": 0, "failed": []}
    for tenant_id, user_id in members:
        try:
            # RLS context (both GUCs — ai_secretary_settings policy casts
            # app.user_id/app.tenant_id to uuid; '' would raise)
            await db.execute(
                text(
                    "SELECT set_config('app.tenant_id', :tid, true), "
                    "set_config('app.user_id', :uid, true)"
                ),
                {"tid": str(tenant_id), "uid": str(user_id)},
            )
            cnt = (
                await db.execute(text("SELECT count(*) FROM nexus_crm.companies"))
            ).scalar() or 0
            if cnt == 0:
                continue
            stats["users"] += 1
            r = await generate_briefing(db, tenant_id, user_id, slot)
            if r.get("status") == "published":
                stats["generated"] += 1
            if r.get("im") == "sent":
                stats["im_sent"] += 1
            elif r.get("im") in ("skipped", "disabled"):
                stats["im_skipped"] += 1
        except Exception as e:  # noqa: BLE001 — per-user isolation
            stats["failed"].append(str(e)[:200])
            try:
                await db.rollback()
            except Exception:
                pass
    return stats
