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
    "用 {lang} 書面語/口語（廣東話語感），嚴禁英文敘述\n"
    "全部 bullet points，每行一個 fact，高密度，少空行\n"
    "有 data 就報 data（具體數字/時間/名稱），冇 data 就 skip 該 section，唔好出空泛句\n"
    "嚴禁「一切安好」「暫無特別需要跟進」呢類 AI 腔空泛句\n"
    "唔好加 commentary、感想、尾句、encouragement\n"
    "語氣：{tone}\n"
    "每個 module 嘅內容每行必須以對應 module tag 開頭（格式 `- {{tag}} {{內容}}`，tag 表見 user message）\n"
    "每個 event 標明來源 label（[Kinetix]/[Personal]/[敬拜隊] 等）\n"
    "用戶額外指示：{instructions}\n"
)

# module key → emoji + 短名 tag（用戶 2026-08-24：「每個模組都加個 tag 容易啲區分」）
MODULE_TAGS: dict[str, str] = {
    "weather": "🌦️ 天氣",
    "meetings": "📅 行程",
    "today_tasks": "✅ 任務",
    "team_updates": "👥 團隊",
    "bible_reading": "📖 聖經",
    "news_industry": "📰 新聞",
    "quote_tracking": "📑 報價",
    "traffic_commute": "🚗 交通",
    "overdue_followup": "⏰ 跟進",
    "expense_reminders": "💰 費用",
    "invoice_reminders": "🧾 發票",
    "calendar_conflicts": "⚠️ 衝突",
    "email_draft_review": "📧 電郵",
    "project_status": "📊 項目",
    "stale_deals": "📉 商機",
    "birthday_reminders": "🎂 生日",
    "hot_leads": "🔥 潛在",
    "sales_kpi": "📈 KPI",
    "unread_messages": "💬 訊息",
    "customer_sentiment": "🎯 情緒",
    "personal_reminders": "🏠 個人",
}

# module → 4 大發送類別歸屬（LLM 分類準確性 — 固定歸屬，唔靠 LLM 自己估）
MODULE_CATEGORY: dict[str, str] = {
    # 通知：衝突、逾期、需要立即處理
    "calendar_conflicts": "notifications",
    "overdue_followup": "notifications",
    # 提醒：任務、費用、發票、電郵、生日、個人 + 天氣、行程（用戶 2026-09-01：
    # 「天氣/行程應該放到提醒那一邊」— 唔係資訊）
    "today_tasks": "reminders",
    "expense_reminders": "reminders",
    "invoice_reminders": "reminders",
    "email_draft_review": "reminders",
    "birthday_reminders": "reminders",
    "personal_reminders": "reminders",
    "weather": "reminders",
    "meetings": "reminders",
    # v7.27: 項目都歸提醒 — deadline 係 actionable（用戶 2026-09-01：「P仔
    # 建議：先重要後次要，項目放提醒」）
    "project_status": "reminders",
    "traffic_commute": "reminders",
    # 資訊：新聞、報價、團隊、KPI、商機、潛在、訊息、情緒
    "news_industry": "info",
    "quote_tracking": "info",
    "team_updates": "info",
    "sales_kpi": "info",
    "stale_deals": "info",
    "hot_leads": "info",
    "unread_messages": "info",
    "customer_sentiment": "info",
    # 聖經
    "bible_reading": "bible",
}


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
        async with db.begin_nested():
            from app.services.calendar_sync import sync_user_calendars
            await sync_user_calendars(db, ctx.tenant_id, ctx.user_id, force=True)
    except Exception:
        pass  # never block the briefing on sync failure (savepoint rollback only)

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

    # ── 今日完成 tasks（用戶提醒格式：✅ 今日完成 section）──
    completed_today: list[dict] = []
    try:
        from app.ai.tool_registry import _list_tasks as _lt
        done_rows = await _lt(ctx, {"status": "completed", "limit": 50}, db)
        today_start = datetime.now(HKT).replace(hour=0, minute=0, second=0, microsecond=0)
        for t in done_rows:
            ca = _parse_dt(t.get("completed_at")) or _parse_dt(t.get("updated_at"))
            if ca and ca >= today_start:
                completed_today.append(t)
        completed_today.sort(
            key=lambda t: _parse_dt(t.get("completed_at")) or _parse_dt(t.get("updated_at")) or today_start,
            reverse=True,
        )
    except Exception:
        pass
    out["completed_today"] = completed_today

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
        # v7.27: traffic_commute signature 係 (ctx, db, lang_pref, options) —
        # 通用 fn(ctx, db, opts) 會將 opts 綁去 lang_pref → AttributeError →
        # savepoint 靜默吞 → 通勤永遠空（實測 debug 到）
        "traffic_commute": lambda ctx, db, opts: bs.traffic_commute(ctx, db, "zh-HK", opts or {}),
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
            # savepoint per module — 任何 module 內部 DB error 只 rollback
            # 自己個 savepoint，主 transaction 保持可用（直接 rollback 會
            # expired 之前 load 嘅 ORM objects → MissingGreenlet，而且令
            # 後續 INSERT generated_briefings InFailedSQLTransaction）
            async with db.begin_nested():
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
    completed = data.get("completed_today", [])[:10]
    schedule = data.get("schedule", [])[:10]
    modules_summary = {k: v for k, v in data.items() if k not in ("tasks", "schedule", "weather", "completed_today")}
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
        "completed_today": completed,
        "modules": modules_summary,
    }

    user = (
        f"請生成 {slot_meta['emoji']} {slot_meta['label']} 簡報（{_now_hkt().strftime('%Y-%m-%d %A')}）。\n\n"
        f"今日指示：{slot_meta['instructions']}\n\n"
        f"以下係已收集嘅數據（用戶喺 AI 應用揀咗 modules：{', '.join(list(modules_summary.keys()) + ['schedule', 'tasks', 'weather']) if modules_summary else 'default'}）：\n"
        f"```json\n{json.dumps(payload, ensure_ascii=False, default=str, indent=1)}\n```\n\n"
    )
    # v7.01: module tag 表 — 每個 module 內容每行用 tag 開頭，容易區分
    tag_lines = "\n".join(f"- {k}: {v}" for k, v in MODULE_TAGS.items())
    cat_lines = "\n".join(f"- {k} → {v}" for k, v in MODULE_CATEGORY.items())
    user += (
        "Module tag 表（每個 module 嘅內容每行必須以對應 tag 開頭，格式 `- {tag} {內容}`）：\n"
        f"{tag_lines}\n\n"
        "Module 類別歸屬（module → 4 大類別，分類時跟呢個表）：\n"
        f"{cat_lines}\n\n"
    )
    # Bible 專屬格式規則（有 bible_reading data 時）— 只提供 reference + 連結，
    # 唔列經文內文（用戶 2026-08-24 明確要求：「經文不需要 list，只要提供
    # 連結同今日要讀嘅經文」）
    bible_data = data.get("bible_reading") or []
    if bible_data:
        b0 = bible_data[0]
        season = b0.get("liturgical_season", "常年期")
        sday = b0.get("liturgical_day", "第1日")
        links = b0.get("links") or {}
        bc = links.get("bible_com", "")
        wd = links.get("we_devote", "")
        bible_rule = (
            "📖 靈修 section 必須用以下格式（唔好加減）：\n"
            f"🙏 靈修 · {_now_hkt().strftime('%Y-%m-%d')}\n"
            f"⛪ {season} · {sday}\n"
            "📖 {reference}（{translation_label}）\n"
            "💡 用 2-3 句總結今日經文嘅核心教導（要具體、基於經文內容）\n"
            "⏳ 📖 未讀\n"
            "─── 讀經 ───\n"
            f"📖 打開和合本修訂版（{bc}）\n"
            f"📱 用微讀細讀經文（{wd}）\n"
            "❌ 嚴禁列出經文內文（text 欄位）—— 用戶會自己開 Bible app 睇，"
            "只需要 reference + 連結\n"
            "─── Jesus Soaking Worship ───\n"
            "🎵 平靜安穩親近神 1hr（https://www.youtube.com/results?search_query=jesus+soaking+worship+1+hour）\n"
            "🎵 敬拜讚美浸泡 1hr（https://www.youtube.com/results?search_query=worship+music+1+hour）\n"
            "願神的話語成為你今日的力量 ❤️\n"
        )
        user += bible_rule + "\n"
    # 新聞專屬格式規則（用戶 2026-09-01：「新聞 module 格式唔好，參考晨早
    # 新聞 Digest」）— 分類 + 來源標記 + 分隔線
    news_data = data.get("news_industry") or []
    if news_data:
        _wd = ["一", "二", "三", "四", "五", "六", "日"][_now_hkt().weekday()]
        news_rule = (
            "📰 新聞 section 必須用以下格式（用戶指定，唔好加減）：\n"
            f"📰 晨早新聞 Digest · {_now_hkt().strftime('%-m月%-d日')}（{_wd}）\n"
            "（空行）\n"
            "🏙 香港要聞\n"
            "• {標題}（{來源}）\n"
            "（空行）\n"
            "💼 科技/商業\n"
            "• {標題}（{來源}）\n"
            "（空行）\n"
            "🌍 國際\n"
            "• {標題}（{來源}）\n"
            "（空行）\n"
            "───────\n"
            "規則：\n"
            "• 分類由標題內容判斷（香港本地/社會 = 香港要聞；科技、金融、商業、企業業績 = 科技/商業；"
            "外國/兩岸/國際事件 = 國際），category_hint 只係參考，唔係鐵律\n"
            "• 每條 bullet 必須以（來源）結尾，來源用 data 嘅 source 欄位（Yahoo／Yahoo財經／SCMP／BBC）\n"
            "• 標題保持原文，唔好翻譯、唔好改寫\n"
            "• 每類 2-5 條，冇嗰類內容就省略該 section\n"
            "• 最後一條之後出 ─────── 分隔線收尾\n"
        )
        user += news_rule + "\n"
    # 交通專屬格式規則（v7.27：去程 + 回程，用戶 2026-09-01：「交通應該可以做到來回」）
    traffic_data = data.get("traffic_commute") or []
    if any(i.get("type") == "commute_route" for i in traffic_data):
        traffic_rule = (
            "🚗 交通 section 格式（來回）：\n"
            "去程同回程各一行，格式：\n"
            "🚗 去程 {origin} → {destination}：{duration} 分鐘（{distance} km）\n"
            "🚗 回程 {destination} → {origin}：{duration} 分鐘（{distance} km）\n"
            "如果 data 冇 return_duration_min 就淨係顯示去程。每行 20 字內。\n"
        )
        user += traffic_rule + "\n"
    # 項目專屬格式規則（v7.27：project_status module 新開）
    project_data = data.get("project_status") or []
    if project_data:
        project_rule = (
            "📊 項目 section 格式（每個項目一行，20-30 字）：\n"
            "• 🏗 {項目名} — {公司}（{狀態}，{deadline 剩 N 日／已逾期}）\n"
            "最多 5 個，按 deadline 由近至遠排。\n"
        )
        user += project_rule + "\n"
    # Display 原則（v7.27：小P UX 建議，用戶 2026-09-01：「整理而方便閱讀」）
    user += (
        "Display 原則（必須跟）：\n"
        "1. 先重要後次要：通知（衝突/逾期）→ 提醒（天氣→行程→交通→任務→項目）→ 資訊（團隊→新聞）→ 聖經\n"
        "2. 一條一個意思：每條 bullet 只講一件事，唔好一條塞三個訊息\n"
        "3. 一致格式：`對象｜狀態｜建議動作`，用清楚動詞（改期/出門/回覆/確認）\n"
        "4. 精簡上限：每個 module 最多 3-5 條（行程 5 條 +「+X 個」、項目 5 個、新聞每類 2-5 條、團隊 3-5 條、交通 2 行）\n"
        "5. 冇內容嘅 module 完全省略，唔好出「暫無」除非係任務 section 嘅固定格式\n"
        "6. 每個 module 內容每行以 module tag 開頭（`- {tag} {內容}`）\n"
    )

    user += (
        "輸出格式：第一行用 <summary>...</summary> 包住一段 1-2 句嘅全日整合摘要"
        "（用上述語言，簡短精煉，整合下面所有數據嘅重點），跟住將完整簡報內容"
        "按以下 4 個類別分節輸出，每個類別用 <<<category:XXX>>> 開頭標記，"
        "XXX 只可以係 notifications / reminders / info / bible：\n"
        "<<<category:notifications>>> 通知（行程衝突、逾期任務、需要立即處理嘅警報）\n"
        "<<<category:reminders>>> 提醒 — 今日天氣 + 今日/未來行程 + 今日任務（用戶 2026-09-01：天氣同行程屬於提醒，唔係資訊）：\n"
        "🌦️ 天氣 section 放最前（有 weather data 先用 module tag 格式）\n"
        "📅 行程 section（有 meetings data 時，列出今日及聽日嘅行程，每個 event 標明來源 label [Kinetix]/[Personal] 等）\n"
        "之後先到今日任務部分，必須用以下固定格式（用戶 2026-09-01 指定，唔好加減）：\n"
        "✅ 今日完成\n"
        "• {今日完成嘅任務 title，逐項}（完全冇就用「• 今日暫無 task 標記完成」）\n"
        "（空行）\n"
        "📋 Tasks Summary · {今日日期 YYYY-MM-DD}\n"
        "（空行）\n"
        "🔴 優先（有 deadline 或 overdue）\n"
        "• {emoji} {title} — {已逾期 (M/D) ／ M/D 到期 ／ 今日到期}（{狀態}）\n"
        "（空行）\n"
        "📌 進行中\n"
        "• {emoji} {title}（冇 deadline 但 status = 進行中/in_progress 嘅任務）\n"
        "（空行）\n"
        "⚪ 其他（未有日期）\n"
        "• {emoji} {title}（冇 deadline 嘅任務，逐項列出）\n"
        "（空行）\n"
        "💭 {1-2 句整合建議：逾期/臨近死線優先、前置關係、今日安排，用廣東話語感}\n"
        "（空行）\n"
        "其他提醒（費用/發票/電郵草稿/生日/個人）繼續用 module tag 格式，放喺 Tasks Summary 之後。\n"
        "每個任務配相關 emoji 分類：📚 書/考試/溫書、💼 工作/客戶/報價/會議、💰 費用/發票、🏠 個人/家庭、📋 其他。\n"
        "<<<category:info>>> 資訊（新聞、CRM 概覽等一般資訊 — 天氣同行程已經歸提醒，唔好放喺呢度）\n"
        "<<<category:bible>>> 聖經（靈修內容）\n"
        "冇內容嘅類別就省略該 tag。每個類別內用 bullet points，高密度。\n"
        "唔好加任何 metadata 或解釋。"
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
    only_modules: list[str] | None = None,
    skip_im_push: bool = False,
) -> dict[str, Any]:
    """Full pipeline for one user: settings → collect → LLM → store → IM push.

    only_modules: 指定只生成呢啲 module（例：bible custom push time 只推 bible_reading）。
    skip_im_push: True 時唔做 IM push（scheduler 自己控制 channel 推送，避免 double push）。
    """
    # ── T0.1 dedup guard（2026-09-04）：同一 briefing_date 同一 slot 已生成過
    # full briefing（modules > 1）→ 直接 return，唔燒 LLM。
    # 背景：run.sh（07/12/18/00）+ scheduler（*/15）雙入口 + _already_sent 只認
    # push_log sent → gate skip 後每 15 min regenerate（9/3 實測 29 條/日）。
    # Bible-only row（modules = [bible_reading]）唔當 full briefing，唔誤擋。
    if only_modules is None:
        try:
            _dup = (
                await db.execute(
                    text(
                        "SELECT 1 FROM nexus_crm.generated_briefings "
                        "WHERE tenant_id = :t AND user_id = :u AND slot = :s "
                        "AND briefing_date = :d AND cardinality(modules) > 1 LIMIT 1"
                    ),
                    {"t": tenant_id, "u": user_id, "s": slot, "d": _now_hkt().date()},
                )
            ).scalar_one_or_none()
            if _dup:
                return {"user_id": str(user_id), "slot": slot,
                        "status": "already_exists", "im": "skipped",
                        "content": "", "content_len": 0, "categories": {}}
        except Exception:
            pass  # guard 失敗（RLS GUC 未 set 等）→ 照生成，保守唔擋
    settings = await _load_settings(db, user_id)
    modules = _enabled_modules(settings)  # {module_key: options_dict} — 深層選項
    if not modules:
        modules = {m: dict(DEFAULT_MODULE_OPTIONS.get(m, {})) for m in DEFAULT_MODULES}
    if only_modules:
        modules = {k: v for k, v in modules.items() if k in only_modules}
        if not modules:
            return {"user_id": str(user_id), "slot": slot, "status": "empty_content", "im": "disabled"}

    from app.ai.session.context import AISessionContext
    ctx = AISessionContext(
        session_id=uuid.uuid4(),
        tenant_id=tenant_id,
        workspace_id=uuid.UUID(int=0),
        user_id=user_id,
        membership_id=uuid.UUID(int=0),
        plan_type="chat",
        slot=slot,
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

    # v6.95: AI summary — 抽 <summary> tag（同一 LLM call，零額外成本）
    import re as _re
    _m = _re.search(r"<summary>(.*?)</summary>", content, _re.S)
    summary = _m.group(1).strip() if _m else ""
    if _m:
        content = _re.sub(r"<summary>.*?</summary>\s*", "", content, flags=_re.S).strip()

    # v7.00: 按類別拆 section（<<<category:XXX>>> tags）— 每類獨立推送用。
    # Dashboard 讀完整 content（剝走 tags 嘅版本）；categories dict 存 DB 俾
    # scheduler 分開發送（通知/提醒/資訊/聖經）。
    CATEGORY_LABELS = {
        "notifications": "🔔 通知",
        "reminders": "⏰ 提醒",
        "info": "📰 資訊",
        "bible": "📖 聖經",
    }
    categories: dict[str, str] = {}
    cat_m = list(_re.finditer(r"<<<category:(\w+)>>>", content))
    if cat_m:
        clean_parts: list[str] = []
        for i, m in enumerate(cat_m):
            cat = m.group(1)
            end = cat_m[i + 1].start() if i + 1 < len(cat_m) else len(content)
            body = content[m.end():end].strip()
            # 清走 LLM 偶爾輸出嘅 close-tag artifact（`</<category:xxx>`）—
            # 唔屬於任何 category 內容（v7.27 實測出現）
            body = _re.sub(r"</?<category:\w+>\s*$", "", body).strip()
            if cat in CATEGORY_LABELS and body:
                categories[cat] = body
        # content 剝走 category tags → 保留 section headers（dashboard
        # parseBriefing 用 markdown headers 拆 sections — 唔可以淨刪 tag）
        content = _re.sub(
            r"<<<category:(\w+)>>>\s*",
            lambda m: f"\n### {CATEGORY_LABELS.get(m.group(1), m.group(1))}\n",
            content,
        ).strip()

    # store to PG (raw SQL — no model boilerplate)
    from sqlalchemy import text as sql_text
    await db.execute(
        sql_text(
            "INSERT INTO nexus_crm.generated_briefings "
            "(tenant_id, user_id, slot, briefing_date, content, summary, categories, data_snapshot, modules) "
            "VALUES (:tid, :uid, :slot, :d, :content, :summary, CAST(:categories AS jsonb), CAST(:snapshot AS jsonb), :modules)"
        ),
        {
            "tid": tenant_id, "uid": user_id, "slot": slot,
            "d": _now_hkt().date(),
            "content": content,
            "summary": summary or None,
            "categories": json.dumps(categories, ensure_ascii=False) if categories else None,
            "snapshot": json.dumps({k: v for k, v in data.items() if k in ("weather", "schedule", "tasks")},
                                   ensure_ascii=False, default=str),
            "modules": list(modules.keys()),  # text[] column — module keys
        },
    )

    # IM push (gated) — scheduler 自訂 bible push 用 skip_im_push 避免 double push
    im = "disabled"
    if not skip_im_push:
        im = await _im_push_if_enabled(db, tenant_id, user_id, slot, content)
    await db.commit()

    return {"user_id": str(user_id), "slot": slot, "status": "published", "im": im,
            "content": content, "content_len": len(content), "categories": categories}


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
