# G08 NEXUS CRM — AI Briefing 系統完整 Export（真實數據版）

> **Export 日期：** 2026-09-03（23:45 HKT）
> **用途：** 拎去外部 AI 做系統優化分析
> **版本對照：** repo v7.29（briefing 相關 v7.20–v7.29 演進）
> **真實數據來源：** `nexus_crm.generated_briefings` / `nexus_crm.push_log` / `nexus_ai.ai_secretary_settings` / `nexus_crm.im_delivery_prefs`（DB live audit 2026-09-03 23:40 HKT，tenant = Kinetix / Terrence Lam）
> **檔案位置：** `backend/app/services/briefing_generator.py`（707 行）、`briefing_scheduler.py`（592 行）、`app/ai/briefing_sources.py`（1560 行）、`app/routers/ai_secretary.py`（944 行）

---

## §0 真實運行數據總覽（DB Audit 2026-09-03）⚠️ 最重要

### 生成量 — 嚴重過量（正常 4 條/日 vs 實際 29 條/日）

```
2026-09-03 全日生成 29 條 briefing（morning/noon/evening/night 各應 1 條）
  09-03: morning 2 條 | noon 2 條 | evening 13 條 | night 12 條
  08-28 → 09-03 每日: evening 恆定 13 條、night 12-13 條（morning/noon 2 條）
  8 月全月生成總數: 1,057 條（~34 條/日）
```

**重複生成 pattern（09-03 evening 為例）：**
```
18:00, 18:00, 18:15, 18:30, 18:45, 19:00, 19:15, 19:30,
19:46, 20:01, 20:06, 20:08, 20:09  ← 13 次，每次全新 LLM call
```

**Root cause 鏈（已 code-verified）：**
1. `run_scheduler` 每 15 分鐘 cron tick 掃描 slots（`DUE_WINDOW_MIN = 180`，即 slot start 後 3 小時內都當 due）
2. Dedup 靠 `_already_sent()`：查 push_log 有冇 **status='sent'**
3. 但只要 push 被 gate 擋（slot_off / quiet_hours / weekend_mute），push_log 只寫 `skipped` → `_already_sent` 永遠 False → **下一個 tick 又 regenerate**
4. 結果：任何被擋嘅 slot 喺 due window 內每 15 分鐘 regenerate 一次（evening 18:00-21:00 window = 12-13 次 LLM call）

**成本影響：** 每條 briefing LLM call（deepseek，input ~3-5k tokens + output ~1.5-2k）→ 被擋 slot 一日燒 12-13 次 ≈ 正常 1 次嘅 12 倍。8 月 1,057 條 ≈ 假設 60% 係重複生成 ≈ ~600 次浪費 LLM call。

### Push 統計（2026-08-28 → 09-03，7 日）

```
status   | reason       | count
---------+--------------+------
skipped  | slot_off     |  218   ← prefs slots off / key mismatch
skipped  | (無 reason)  |  213   ← whatsapp fallback 靜默 skip（冇寫 reason）
skipped  | weekend_mute |  150   ← 8/29-30 週末 2 日 × 4 slot × 2 channel × ~4 tick
skipped  | quiet_hours  |   78   ← 非工作時段（work_end 22:00 前後）
failed   |              |   12
sent     |              |   11
```

**Sent 記錄（7 日內成功推送 11 次 — 全部 Telegram）：**
```
08-28 05:00 morning ✅ | 08-28 12:01 afternoon ✅
08-31 05:00 morning ✅ | 08-31 12:00 afternoon ✅   （週日有推？weekend_mute 例外待查）
09-01 05:00 morning ✅ | 09-01 12:01 afternoon ✅
09-02 05:00 morning ✅ | 09-02 12:00 afternoon ✅
09-03 05:01 morning ✅ | 09-03 12:01 afternoon ✅
09-03 20:08 evening ✅ ← im_delivery_prefs 修復後第一次 evening 成功
```

**Pattern 分析：**
- morning 05:00 + afternoon 12:00 每日穩定 sent ✅
- **evening 18:00 由 8/28 起從未自動 sent**（slot_off ×13/日 + quiet_hours 擋）→ 9/3 20:08 修復 prefs 後先成功一次
- **lateNight 23:00 由 8/28 起從未 sent**（全部 slot_off — 見 §9.5 slot key mismatch）
- WhatsApp 全軍覆沒（slot_off / 無 reason）— 8 月至今 whatsapp sent = 0

### 用戶真實 Config（DB 讀出，2026-09-03）

```json
modules: {
  weather: {unit: celsius, region: [all_hk, nt_east, nt_west]},
  meetings: {type: all, range: today_tomorrow},
  today_tasks: {sort: priority, scope: both},
  team_updates: {scope: my_teams, task_status: all},
  bible_reading: {plan: custom_pace, translation: cuv, time_of_day: morning,
                  push_time_mode: greeting, chapters_per_push: "1",
                  start_book: 但以理書, end_book: 啟示錄, start_chapter: 3},
  news_industry: {lang: zh, topics: [tech, finance, logistics, retail]},
  project_status: {count: "5", ownership: all},
  traffic_commute: {mode: driving, origin: 錦田, destination: 觀塘},
  overdue_followup: {days: "7", contact_type: all},
  calendar_conflicts: {range: today}
}
tone: professional | lang_pref: zh-HK | detail_level: 2
work_start: 04:30 | work_end: 22:00   ← 注意：真實 DB 係 04:30，唔係 09:00 default
channels: telegram {enabled: true, connected: true} | whatsapp {enabled: true, connected: true}
greeting_slots: morning 05:00 / afternoon 12:00 / evening 18:00 / lateNight 23:00
```

---

## §1 SLOT_PROMPTS — 時段指示

### 功用
定義 4 個時段嘅生成指示（emoji + label + instructions），決定每個 briefing 嘅「今日焦點」。用戶喺 AI App UI 可以自訂 greeting_slots 時間，但指示文字係 hardcode。

### Coding（`briefing_generator.py:40-49`）
```python
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
```

### Results（真實）
- evening 18:00 實際輸出（9/3 20:08 sent 版）含：衝突通知×2、逾期跟進×2、天氣、聽日行程、交通來回（29/30 min + 龍翔道意外）、Tasks Summary、5 項目、新聞 Digest — 符合「今日回顧 + 聽日預告 + 未完任務」
- **greeting key 同 briefing slot key 唔一致**：greeting_slots 用 `afternoon`/`lateNight`，generator slot 用 `noon`/`night`，靠 `SLOT_MAP` 轉換（scheduler.py:59-64）— 轉換鏈多一環就多一個 bug 位（見 §9.5）

---

## §2 SYSTEM_PROMPT — 全局硬性規則

### 功用
每次生成嘅 system message。控制：語言（廣東話/書面語）、格式（bullet points 高密度）、數據紀律（有 data 就報，冇就 skip）、語氣、module tag 格式、event 來源 label。

### Coding（`briefing_generator.py:51-64`）
```python
SYSTEM_PROMPT = (
    "你係專業 AI 助理，負責生成每日簡報。\n"
    "硬性規則：\n"
    "用 {lang} 書面語/口語（廣東話語感），嚴禁英文敘述\n"
    "全部 bullet points，每行一個 fact，高密度，少空行\n"
    "有 data 就報 data（具體數字/時間/名稱），冇 data 就 skip 該 section，唔好出空泛句\n"
    "嚴禁「一切安好」「暫無特別需要跟進」呢類 AI 腔空泛句\n"
    "唔好加 commentary、感想、尾句、encouragement\n"
    "語氣：{tone}\n"
    "每個 module 嘅內容每行必須以對應 module tag 開頭（格式 `- {tag} {內容}`，tag 表見 user message）\n"
    "每個 event 標明來源 label（[Kinetix]/[Personal]/[敬拜隊] 等）\n"
    "用戶額外指示：{instructions}\n"
)
```

### Results（真實）
- 真實輸出（9/3 兩份樣本）：廣東話語感 ✅、bullet 高密度 ✅、冇 AI 腔 ✅
- **瑕疵實證**：任務區出現 `💭` commentary（Tasks Summary 格式本身要求 💭 建議，但同「唔好加 commentary」有少少衝突 — LLM 對 Tasks Summary 嘅 💭 同 system 規則點取捨要 clarifiy）
- **task emoji 雙重實證**：`📚 返還圖書` module tag + task 內文 `📚` 疊加（見 9/3 樣本 `- ⏰ 跟進｜📚 返還圖書` 出現 📚 兩次）

---

## §3 MODULE_TAGS + MODULE_CATEGORY — Module 標籤同分類歸屬

### 功用
- **MODULE_TAGS**：每個 module → emoji + 短名（用戶 2026-08-24：「每個模組都加個 tag 容易啲區分」）
- **MODULE_CATEGORY**：module → 4 大類別嘅**固定歸屬表**（唔靠 LLM 估），連 prompt 一齊傳。改分類 = 改 dict + prompt 描述同步（v7.26/v7.27 教訓）

### Coding（`briefing_generator.py:66-122`）
```python
MODULE_TAGS: dict[str, str] = {
    "weather": "🌦️ 天氣", "meetings": "📅 行程", "today_tasks": "✅ 任務",
    "team_updates": "👥 團隊", "bible_reading": "📖 聖經", "news_industry": "📰 新聞",
    "quote_tracking": "📑 報價", "traffic_commute": "🚗 交通", "overdue_followup": "⏰ 跟進",
    "expense_reminders": "💰 費用", "invoice_reminders": "🧾 發票", "calendar_conflicts": "⚠️ 衝突",
    "email_draft_review": "📧 電郵", "project_status": "📊 項目", "stale_deals": "📉 商機",
    "birthday_reminders": "🎂 生日", "hot_leads": "🔥 潛在", "sales_kpi": "📈 KPI",
    "unread_messages": "💬 訊息", "customer_sentiment": "🎯 情緒", "personal_reminders": "🏠 個人",
}

MODULE_CATEGORY: dict[str, str] = {
    "calendar_conflicts": "notifications", "overdue_followup": "notifications",
    "today_tasks": "reminders", "expense_reminders": "reminders", "invoice_reminders": "reminders",
    "email_draft_review": "reminders", "birthday_reminders": "reminders", "personal_reminders": "reminders",
    "weather": "reminders", "meetings": "reminders", "project_status": "reminders",
    "traffic_commute": "reminders",          # v7.27: 交通歸提醒
    "news_industry": "info", "quote_tracking": "info", "team_updates": "info",
    "sales_kpi": "info", "stale_deals": "info", "hot_leads": "info",
    "unread_messages": "info", "customer_sentiment": "info",
    "bible_reading": "bible",
}
```

### Results（真實）
- 9/3 morning briefing categories：notifications + reminders + info + **bible**（4 類齊）
- 9/3 evening briefing categories：notifications + reminders + info（**冇 bible** — bible time_of_day=morning，evening 唔出，符合設定）
- 用戶實際收 3-4 條分類 message（🔔通知/⏰提醒/📰資訊[/📖聖經]），每條獨立 header ✅
- 分類歸屬正確：衝突→通知、天氣/行程/交通→提醒、新聞/項目→資訊、讀經→聖經 ✅

---

## §4 完整 User Prompt 模板（_build_prompt）— 最核心，優化重點

### 功用
組裝 user message：payload JSON（數據）+ module tag/category 表 + 各 module 專屬格式規則（bible/news/traffic/project）+ Display 原則 + Tasks Summary 固定格式 + 4 分類輸出指示。**呢個係 LLM 生成質素嘅最大槓桿。**

### Coding（`briefing_generator.py:278-448`，精簡關鍵規則）

**Payload 結構（壓縮後餵 LLM）：**
```python
payload = {
    "date": ..., "slot": slot, "slot_label": "🌆 晚安",
    "weather": {...}, "schedule": [...10], "tasks": [...15],
    "completed_today": [...10], "modules": {...每 module 最多 8 條},
}
```

**Bible 專屬格式（有 bible data 時）** — 只提供 reference + 連結，唔列經文（用戶 2026-08-24）：
```
🙏 靈修 · {date}
⛪ {season} · {day}
📖 {reference}（{translation}）
💡 2-3 句總結核心教導
─── 讀經 ───
📖 打開和合本修訂版（{link}）
📱 用微讀細讀經文（{link}）
❌ 嚴禁列出經文內文
```

**新聞 Digest 格式（用戶 2026-09-01）：**
```
📰 晨早新聞 Digest · 9月3日（四）
🏙 香港要聞 → 💼 科技/商業 → 🌍 國際
• {標題}（{來源}）    每類 2-5 條，來源必標
─────── 分隔線收尾
```

**交通來回格式（v7.27）：**
```
🚗 去程 {origin} → {destination}：{duration} 分鐘（{distance} km）
🚗 回程 {destination} → {origin}：{duration} 分鐘（{distance} km）
```

**Display 原則（v7.27 小P UX 建議）：**
```
1. 先重要後次要：通知 → 提醒（天氣→行程→交通→任務→項目）→ 資訊 → 聖經
2. 一條一個意思
3. 一致格式：`對象｜狀態｜建議動作`
4. 精簡上限：行程 5 條 +「+X 個」、項目 5 個、新聞每類 2-5 條、交通 2 行
5. 冇內容 module 完全省略
6. 每行以 module tag 開頭
```

**Tasks Summary 固定格式（用戶 2026-09-01 指定，唔好加減）：**
```
✅ 今日完成
• {完成任務 title}

📋 Tasks Summary · {date}
🔴 優先（有 deadline 或 overdue）
• {emoji} {title} — {已逾期 (M/D)／M/D 到期／今日到期}（{status}）
📌 進行中
• {emoji} {title}
⚪ 其他（未有日期）
• {emoji} {title}
💭 {1-2 句整合建議，廣東話語感}
```

**輸出分類指示：** `<summary>...</summary>` 全日整合摘要 + `<<<category:XXX>>>` 分 4 節，XXX 只可以係 notifications/reminders/info/bible。

### Results（真實）
- 格式跟足：✅今日完成 / 🔴優先 / 📌進行中 / ⚪其他 / 💭建議 全部齊（見 §10 真實樣本）
- **瑕疵實證（9/3 樣本逐項對照）：**
  - `- 📚 返還圖書 (5本) — 已逾期 (8/22)（pending）` 同 Tasks Summary 內 `📚 返還圖書` — 同一 task 喺「跟進」同「任務」出現兩次（overdue_followup module + today_tasks module 數據重疊，prompt 冇去重指示）
  - 項目區 morning 版有 deadline 資訊（`12/30 到期，剩 118 日`）但 evening 版淨係得逾期日數（`已逾期 132 日`）— 兩個 slot 嘅 project module 輸出格式唔一致
  - 行程 `[Place Holder] HPE Appreciation Dinner` + `Canceled: [Place Holder] HPE Appreciation Dinner` 兩條並列（cancel 嘅 event 冇 filter 走）— 數據層要 filter canceled

---

## §5 Data Collection（_collect_modules + 20 個 sources）

### 功用
讀用戶 settings modules → 逐個 call source function 收集真實數據 → 組成 dict 俾 LLM。每個 source 有 deep options（用戶可喺 UI 自訂範圍）。

### Coding
- `_collect_modules`（`briefing_generator.py:159-276`）：先 force calendar sync → `_build_crm_briefing` 攞 schedule/tasks/weather → 按 options 過濾 → fn_map 逐個 call
- **⚠️ fn_map 用 lambda wrapper 修正 signature**（v7.27 bug）：
  ```python
  # traffic_commute signature 係 (ctx, db, lang_pref, options) — 其他係 (ctx, db, options)
  "traffic_commute": lambda ctx, db, opts: bs.traffic_commute(ctx, db, "zh-HK", opts or {}),
  ```

### Sources 清單（`briefing_sources.py`）— 功用一覽
| Module | 功用 | Data source |
|---|---|---|
| project_status | Active projects 最近 deadline 先 | nexus_crm.projects |
| stale_deals | 冇活動嘅 open deals | nexus_crm.deals |
| quote_tracking | Pending quotes 最快到期先 | quotes |
| overdue_followup | N 日冇 touchpoint 嘅 contacts | contacts + touchpoints |
| birthday_reminders | 今個月生日 contacts | contacts custom field |
| hot_leads | 高 probability deals | deals |
| sales_kpi | Won deals vs 目標 | deals |
| team_updates | 團隊最近 task 活動 | tasks |
| invoice_reminders | 未找數 quotations | quotations |
| weather | HKO 即時天氣 | data.gov.hk rhrread |
| unread_messages | 未讀 inbox | Gmail/Outlook |
| calendar_conflicts | Calendar 重疊偵測 | project_calendar_events |
| news_industry | HK + 商業 RSS 頭條 | Yahoo/SCMP/BBC RSS |
| traffic_commute | 通勤路線 + HK MTR ETA + TD 意外 | OSRM/Photon/data.gov.hk |
| email_draft_review | AI 草稿待審 | drafts |
| customer_sentiment | 客戶訊息情緒（keyword，無 LLM） | messages |
| expense_reminders | Pending 費用 | expenses |
| personal_reminders | 個人提醒 | reminders |
| bible_reading | 讀經進度（custom pace） | bible_reading_progress |

### Results（真實）
- 用戶開啟 10 modules：weather, meetings, today_tasks, team_updates, bible_reading, news_industry, project_status, traffic_commute, overdue_followup, calendar_conflicts（9/3 DB 確認）
- 每條 briefing `modules` array 記錄實際收集 module：9/3 全部 29 條都係 10 個 module 齊（即使 bible 淨係 morning 出）
- traffic 實測有 data：去程 29min/30.5km + 回程 30min/30.8km + 龍翔道車輛故障意外 ✅（9/3 兩份樣本都見到）
- **weather 有雨提示實證**：`🌦️ 天氣｜今日有雨，26°C，濕度 69%，記得帶遮`（morning）vs `28°C，濕度73%，有雨（🌦️）｜出門帶遮`（evening）— 溫度數字 morning/evening 唔同（正常，HKO 實時）

---

## §6 Scheduler + Push 鏈路（briefing_scheduler.py）

### 功用
每 15 分鐘 cron 掃描所有 users × greeting_slots，slot due（3h window）就 generate + push。Telegram primary → WhatsApp fallback。Dedup 靠 push_log status='sent'。

### Coding — style conversion（`briefing_scheduler.py:87-127`）
```python
def _style_for_channel(content, channel, slot, now, header=None):
    # 壓縮連續空行 → 1 個；strip 每行
    # Telegram: header 第一行「🕐 HH:MM · 🌅 早安」（時間放最前）
    #   剝走 content 開頭重複 emoji title
    #   `|` 分隔 table 行 → bullet（Telegram 唔 support table）
    #   截斷 4000 chars（Telegram 4096 limit）
    # WhatsApp: 淨壓空行 + 截斷
```

### Coding — 分類推送（`briefing_scheduler.py:310-395`）
```python
async def _push_telegram(db, user, slot, content, categories):
    # 重新 set GUC（caller commit 後 transaction-local GUC 消失 — v7.28 bug）
    # gate: _channel_gate → enabled/slots/weekend_mute/quiet_hours
    #   有 categories → 逐類 send：for cat in (notifications, reminders, info, bible)
    #     header=f"🕐 HH:MM · 🔔 通知"  ← 每類一條 message
    #   fallback: 無 categories → 成個 content 一條
```

### Coding — quiet hours 跟 Working Hours（用戶 2026-08-25）
```python
# 靜音窗 = Working Hours 以外（work_start/work_end from ai_secretary_settings）
# morning slot 豁免；strict_silence=False → ignore quiet time
```

### Results（真實 + 新發現嘅 dedup bug）
- **⚠️ Dedup 失效 bug（§0 root cause）**：`_already_sent()` 只認 `status='sent'`；被 gate 擋（skipped）→ 每 15 分鐘 tick regenerate + 再 push。9/3 evening 13 次 generate 全因 prefs evening gate 擋住，9/3 20:08 prefs 修復後第一次 sent → 20:09 之後先停（即 sent 後 dedup 生效，證明 root cause 判斷正確）
- 修復後 20:08 telegram evening **sent** ✅（用戶實際收到 3 條分類 message）
- **gate 檢查順序**：enabled → slots[slot] → weekend_mute → quiet_hours。slots key 用 greeting key（morning/afternoon/evening/lateNight），但 im_delivery_prefs.slots 真實值 keys 係 `{noon, evening, morning, afternoon}` — **`lateNight` 冇對應 key → 23:00 slot 永遠 slot_off**（§9.5）

---

## §7 DB Schema + Router

### 功用
生成結果存 DB（dashboard 讀 + push dedup），router 提供 API。

### Coding
- **generated_briefings 表**（`nexus_crm`）：tenant_id, user_id, slot, briefing_date, content, summary, categories(jsonb), data_snapshot(jsonb), modules(text[]), created_at
- **push_log 表**：channel, slot, status(sent/skipped/failed), reason, sent_at
- **Router**（`ai_secretary.py`）：
  - `GET /settings` + `POST /settings/reset` — AI App 設定
  - `GET /briefing` — dashboard 讀當日最新（冇就 `_build_crm_briefing` fallback）
  - `POST /briefing/run?slot=X` — Cron-Api-Key 保護，generate for all users
  - `GET /llm-usage` — token 用量

### Results（真實）
- **generated_briefings 容量**：8/1 至今 1,150 條（8 月 1,057 + 9 月 93）— 每條 content ~1.4-2.1k chars + data_snapshot jsonb（full payload），表增長 ~500KB/月，暫冇容量壓力但重複生成令 7 倍無謂寫入
- **push_log 容量**：7 日 682 條（sent 11 / skipped 659 / failed 12）— skipped 記錄佔 97%，每 tick 每 user 每 channel 都寫一條
- RLS：兩表都 FORCE row security，靠 `app.tenant_id` + `app.user_id` GUC（scheduler 每 member 重新 set — v7.28 修復）

---

## §8 用戶 Config vs Default（優化基準）

| 項目 | Default | Terrence 真實值 |
|---|---|---|
| modules | 6 個 | 10 個（+team_updates, bible_reading, news_industry, traffic_commute, overdue_followup, calendar_conflicts）|
| tone | professional | professional |
| lang_pref | zh-HK | zh-HK |
| detail_level | 2 | 2 |
| work_start/work_end | 09:00/18:00 | **04:30/22:00** |
| weekend_mute | true | true |
| strict_silence | true | true |
| channels | 全 disabled | telegram ✅ + whatsapp ✅ |
| greeting_slots | morning/afternoon/evening/lateNight | 同 default |

---

## §9 已知問題 / 優化熱點（俾 AI 參考）— 真實數據版

1. **【P0】Scheduler dedup 失效 → 7-13× 重複生成（§0）**：`_already_sent` 只認 sent；任何 gate skip 令 slot 喺 3h due window 內每 15 min regenerate。修復方向：a) skipped 都要寫入去 dedup（但要小心修復後當日唔會漏 push）b) generate 前 check generated_briefings 當日該 slot 已有 row 就 skip c) 兩者並用。**8 月 1,057 條生成 ≈ 600+ 次浪費 LLM call**
2. **【P1】im_delivery_prefs.slots key mismatch（§6 Results）**：prefs slots 真實值 `{noon, evening, morning, afternoon}` vs greeting key `{morning, afternoon, evening, lateNight}` — `noon` 係舊 key（v7.2x 前），`lateNight` 缺失 → **23:00 深夜 briefing 永遠 slot_off**。修復：DB migration 將 prefs slots keys 對齊 greeting keys（noon→afternoon 已存在？prefs 同時有 noon + afternoon 兩個 key — 需要 audit 邊個啱）
3. **【P1】WhatsApp 全軍覆沒 + 無 reason skip**：7 日 whatsapp sent=0，213 條 skipped 冇 reason（fallback path 冇寫 reason）+ 150 weekend_mute。要查 whatsapp gateway credential/fallback 鏈路
4. **【P2】Task emoji 雙重**：`📚 📚 返還圖書` — module tag 同 task 分類 emoji 疊加（prompt 規則衝突）
5. **【P2】Canceled events 冇 filter**：`Canceled: [Place Holder] HPE Appreciation Dinner` 照出街（9/3 evening 樣本實證）
6. **【P2】同一 task 雙 module 重複**：overdue_followup + today_tasks 數據重疊 → 同一 task 喺「通知」同「任務」區各出一次（9/3 樣本實證）
7. **【P2】Section 順序漂移**：交通/項目偶爾甩位（Display 原則 vs LLM 自由發揮）— 9/3 morning 樣本項目區出現喺 Tasks Summary 下面而唔係獨立區
8. **【P2】Traffic 係 driving mode**：用戶實際搭 MTR 60min，CRM 出 driving 29min — 數值對用戶意義有限（用戶已知，接受；MTR real-time ETA module 已提議未做）
9. **【P3】LLM close-tag artifact**：偶爾 `</<category:xxx>` 殘留（已有 cleanup，可再加強）— 9/3 樣本未見，歷史問題
10. **【P3】categories 存 DB 但 dashboard 只 render content**：分類資訊冇喺 dashboard 用盡
11. **【P3】news 每 slot 都重新 fetch**：morning/noon/evening 新聞一樣但 refetch 3 次

---

## §10 真實 Briefing 樣本（2026-09-03）

### Morning 05:00（id 13803，categories 4 類齊）

```
### 🔔 通知
- ⚠️ 衝突｜HKMA PoC 同 CS1466433 重疊｜HKMA 10:00 開始、CS1466433 11:30 開始，建議將 CS1466433 改期或提早結束 HKMA 會議 [Kinetix]

### ⏰ 提醒
- 🌦️ 天氣｜今日有雨，26°C，濕度 69%，記得帶遮 [Kinetix]
- 📅 行程｜10:00 HKMA - HCL AppScan PoC [Kinetix]
- 📅 行程｜11:30 CS1466433（Google Meet: meet.google.com/csb-shez-kgk）[Kinetix]
- 📅 行程｜聽日 18:00 [Place Holder] HPE Appreciation Dinner（客戶公司）[Kinetix]
- 🚗 去程 錦田 → 觀塘：29 分鐘（30.5 km）
- 🚗 回程 觀塘 → 錦田：30 分鐘（30.8 km）

✅ 今日完成
• 今日暫無 task 標記完成

📋 Tasks Summary · 2026-09-03
🔴 優先（有 deadline 或 overdue）
- 📚 返還圖書 (5本) — 已逾期 (8/22)（pending）
- 💼 HPE Exam - ATP/ASE Storage/ASE Compute (Sep) — 已逾期 (9/1)（pending）
- 🏠 Book 睇醫生 — 10/1 到期（pending）
📌 進行中
• （今日冇進行中任務）
⚪ 其他（未有日期）
- 🏠 買拖板（P1，pending）
- 📚 Prepare H3C exam（P1，pending）

💭 還書已經逾期成兩個禮拜，今日順路去還咗佢；HPE Exam 已過死線，要盡快約時間考。聽日有 HPE Appreciation Dinner，今日可以順便準備吓。

- 📊 項目｜🏗 Queen Mary SAN Storage — 醫院管理局（pending，12/30 到期，剩 118 日）
- 📊 項目｜🏗 HKADC infrastructure revamp — 香港藝術發展局（in_progress，4/24 到期，已逾期）
- 📊 項目｜🏗 IWS Network revamp — IWS group holdings（planning，11/12 到期，已逾期）
- 📊 項目｜🏗 REO 新伺服器及軟件採購 — 選舉事務處（in_progress，2/28 到期，已逾期）
- 📊 項目｜🏗 Windows EA License Renew — Kinetix（pending，12/3 到期，已逾期）

### 📰 資訊
- 👥 團隊｜今日冇團隊更新
📰 晨早新聞 Digest · 9月3日（四）
🏙 香港要聞
• 香港出生Quantum Fintech創辦人巴拉圭全裸墮樓亡（Yahoo）
💼 科技/商業
• OpenAI 指 Astra 為迄今最危險模型　鏈式思考監控面臨挑戰（Yahoo）
• Acer 推出 Swift Blade 14　比 MacBook Air 更輕巧一點（Yahoo）
• 市占率登頂，新賽道盈利，協鑫科技2026年中報穿越週期迎來拐點（Yahoo財經）
• AIA推出「財富恆裕」人壽保險計劃3　助高淨值客戶守護摯愛、規劃未來、綿延下一代（Yahoo財經）
🌍 國際
• Sadie Sink 演繹 Calvin Klein 經典「90s Straight」牛仔褲的現代態度（Yahoo）
• Peezy 預覽 Denim Tears x Billionaire Boys Club 聯乘系列（Yahoo）
• Carlos Sainz 與 New Era 推出首個「TEAM FIFTY5」帽款及服飾系列（Yahoo）
───────
```

（bible category 內容存在於 categories jsonb：`🙏 靈修 · 2026-09-03 ⛪ 聖靈降臨期 · 第102日 📖 但以理書 8:1-16（和合本）...` — 獨立 bible push）

### Evening 20:08（id 14205 — prefs 修復後首次成功 push 版本）

```
### 🔔 通知
- ⚠️ 衝突｜HKMA - HCL AppScan PoC 與 CS1466433 重疊（11:30-13:00）｜已過，留意會後跟進
- ⚠️ 衝突｜CS1466433 與 Lunch with Kinetix 重疊（12:15-13:30）｜已過，確認雙方備忘錄
- ⏰ 跟進｜📚 返還圖書 (5本) — 已逾期 (8/22)（P1）｜聽日盡快處理
- ⏰ 跟進｜HPE Exam - ATP/ASE Storage/ASE Compute — 已逾期 (9/1)（P1）｜需重新安排考試日期

### ⏰ 提醒
- 🌦️ 天氣｜28°C，濕度73%，有雨（🌦️）｜出門帶遮
- 📅 行程｜[Place Holder] HPE Appreciation Dinner — 聽日 9/4 18:00 @客戶公司 [Kinetix]
- 📅 行程｜Canceled: [Place Holder] HPE Appreciation Dinner — 聽日 9/4 18:00（已取消，確認日曆清除）
- 🚗 去程 錦田 → 觀塘：29 分鐘（30.5 km）
- 🚗 回程 觀塘 → 錦田：30 分鐘（30.8 km）
- 🚗 交通｜龍翔道(往觀塘方向)近澤安邨車輛故障，部分行車線封閉，交通繁忙

✅ 今日完成
• 今日暫無 task 標記完成

📋 Tasks Summary · 2026-09-03
🔴 優先（有 deadline 或 overdue）
• 📚 返還圖書 (5本) — 已逾期 (8/22)（pending）
• 💼 HPE Exam - ATP/ASE Storage/ASE Compute — 已逾期 (9/1)（pending）
• 🏠 Book 睇醫生 — 10/1 到期（pending）
📌 進行中
• （冇進行中任務）
⚪ 其他（未有日期）
• 📋 買拖板（P1，pending）
• 💼 Prepare H3C exam（P1，pending）

💭 圖書同HPE考試都已經過期，聽日順路還書先。H3C exam係HPE考試嘅前置，要排返溫書時間。睇醫生約10月頭，記得提早book。

### 📰 資訊
📊 項目
• 🏗 HKADC infrastructure revamp — 香港藝術發展局（進行中，已逾期 132 日）
• 🏗 REO - Procurement of new Server — 選舉事務處（進行中，已逾期 187 日）
• 🏗 Queen Mary - Upgrade SAN Storage — 醫管局（pending，已逾期 247 日）
• 🏗 IWS Network revamp — IWS group（規劃中，已逾期 295 日）
• 🏗 Windows EA License Renew — Kinetix（pending，已逾期 274 日）

📰 晨早新聞 Digest · 9月3日（四）
🏙 香港要聞
• 惠康與韓國CJ Foods簽署策略合作協議 引進100多款韓國人氣美食 滿足香港消費者多元飲食需求（Yahoo）
💼 科技/商業
• XTransfer獲阿聯酋央行「零售服務支付牌照」原則性批准（Yahoo）
• OpenAI 指 Astra 為迄今最危險模型 鏈式思考監控面臨挑戰（Yahoo）
• 市占率登頂，新賽道盈利，協鑫科技2026年中報穿越週期迎來拐點（Yahoo財經）
• AIA推出「財富恆裕」人壽保險計劃3 助高淨值客戶守護摯愛、規劃未來、綿延下一代（Yahoo財經）
• 平安數字銀行6周年慶典驚喜揭幕 「三重高息現金賞」及官方小紅書帳號重磅登場（Yahoo財經）
🌍 國際
• De Bethune 於 Geneva Watch Days 2026 發表無指針 DB25 Digitale（Yahoo）
───────
```

---

*Export 完成（真實數據版）— 建議 AI 優化時 focus §0（重複生成 P0）+ §4（prompt 模板）+ §9（11 項已知問題）*
