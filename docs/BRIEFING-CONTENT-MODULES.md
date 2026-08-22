# NEXUS CRM — Briefing Content Modules 完整參考文檔

> 版本：2026-08-22 · 用途：升級 Briefing Content Modules 前嘅 source code + workflow 總覽
> 涵蓋：20 個 content module 嘅數據源、生成 pipeline、web layout、IM push、擴展方法

---

## 1. 架構總覽

```
┌─────────────────────────── 前端 (Vite React + TS) ───────────────────────────┐
│  DashboardV2.tsx ──► briefingRoutes.ts（section → page 映射）                 │
│  AIBriefingDrawer.tsx ──► /api/v1/ai/briefing + /api/v1/ai-secretary/briefing │
│  DailyBriefingCard.tsx ──► /api/v1/ai/briefing（dashboard 卡片）               │
│  useSecretarySettings.ts（module 清單 + settings 快取）                        │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │ REST (JWT RS256)
┌──────────────────────────────────▼───────────────────────────────────────────┐
│ 後端 (FastAPI)                                                               │
│  GET  /api/v1/ai/briefing            → _build_crm_briefing（CRM core）       │
│  GET  /api/v1/ai-secretary/briefing  → 20-module 數據源（working-hours gate）│
│  GET/PATCH /api/v1/ai-secretary/settings → module 啟用/停用                   │
│  POST /api/v1/ai-secretary/...                                                │
│  briefing_generator.py ──► LLM (deepseek) ──► generated_briefings 表          │
│  briefing_scheduler.py ──► cron ──► run_for_all_users()                       │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │ IM push（WhatsApp / Telegram）
                                   ▼
                          push_log 表 + Telegram bot / WhatsApp API
```

**核心原則（Terrence spec 2026-08-01）：**
- G08 完全獨立 — 所有 module 數據源都係 G08 自己 DB 表或公開 API，唔讀 Hermes data
- 一個 briefing 內容同時服務：Telegram/WhatsApp push + Portal 渲染（同一段 generated text）
- Module 數據源 failure 必須 graceful（return `[]`），唔可以 crash 成個 briefing

---

## 2. Module Registry（20 個 content modules）

### 2.1 後端 Registry — `backend/app/routers/ai_secretary.py`

```python
KNOWN_MODULES = {
    "weather", "today_tasks", "meetings", "project_status", "hot_leads",
    "stale_deals", "overdue_followup", "unread_messages", "birthday_reminders",
    "quote_tracking", "invoice_reminders", "team_updates", "calendar_conflicts",
    "news_industry", "traffic_commute", "email_draft_review", "sales_kpi",
    "customer_sentiment", "expense_reminders", "personal_reminders",
}

# True = briefing data source implemented & tested。False = UI 灰咗（揀唔到）
MODULE_CONNECTED: dict[str, bool] = {
    "weather": True,             # ✅ HKO Open Data API (briefing_sources)
    "today_tasks": True,         # ✅ tasks 表
    "meetings": True,            # ✅ Google Calendar
    "project_status": True,      # ✅ projects 表
    "hot_leads": True,           # ✅ deals probability>=70
    "stale_deals": True,         # ✅ deals 表
    "overdue_followup": True,    # ✅ touchpoints 表
    "unread_messages": True,     # ✅ Gmail/Outlook OAuth token
    "birthday_reminders": True,  # ✅ contacts custom_fields
    "quote_tracking": True,      # ✅ quotes 表
    "invoice_reminders": True,   # ✅ quotations 表
    "team_updates": True,        # ✅ teams + tasks
    "calendar_conflicts": True,  # ✅ project_calendar_events 重疊邏輯
    "news_industry": True,       # ✅ RSS fetch
    "traffic_commute": True,     # ✅ 運輸署 API
    "email_draft_review": True,  # ✅ ai_drafts 表
    "sales_kpi": True,           # ✅ user_targets + deals
    "customer_sentiment": True,  # ✅ ai_messages 分析
    "expense_reminders": True,   # ✅ expenses 表
    "personal_reminders": True,  # ✅ personal_notes 表
}
```

### 2.2 前端 Module 清單 — `src/hooks/useSecretarySettings.ts`

```typescript
export interface SecretaryModule {
  id: string;
  icon: string;
  nameKey: string;   // i18n key，例如 'settings.aiApps.modWeather'
  descKey: string;   // i18n key，例如 'settings.aiApps.modWeatherDesc'
  default: boolean;  // 新用戶預設啟用？
}

export const MODULES: SecretaryModule[] = [
  { id: 'weather', icon: '🌤️', nameKey: 'settings.aiApps.modWeather', descKey: 'settings.aiApps.modWeatherDesc', default: true },
  { id: 'today_tasks', icon: '✅', nameKey: 'settings.aiApps.modTasks', descKey: 'settings.aiApps.modTasksDesc', default: true },
  { id: 'meetings', icon: '📅', nameKey: 'settings.aiApps.modMeetings', descKey: 'settings.aiApps.modMeetingsDesc', default: true },
  { id: 'project_status', icon: '📊', nameKey: 'settings.aiApps.modProjects', descKey: 'settings.aiApps.modProjectsDesc', default: true },
  { id: 'hot_leads', icon: '🔥', nameKey: 'settings.aiApps.modHotLeads', descKey: 'settings.aiApps.modHotLeadsDesc', default: true },
  { id: 'stale_deals', icon: '⚠️', nameKey: 'settings.aiApps.modStaleDeals', descKey: 'settings.aiApps.modStaleDealsDesc', default: true },
  { id: 'overdue_followup', icon: '⏰', nameKey: 'settings.aiApps.modOverdue', descKey: 'settings.aiApps.modOverdueDesc', default: false },
  { id: 'unread_messages', icon: '💬', nameKey: 'settings.aiApps.modUnread', descKey: 'settings.aiApps.modUnreadDesc', default: false },
  { id: 'birthday_reminders', icon: '🎂', nameKey: 'settings.aiApps.modBirthday', descKey: 'settings.aiApps.modBirthdayDesc', default: false },
  { id: 'quote_tracking', icon: '💰', nameKey: 'settings.aiApps.modQuotes', descKey: 'settings.aiApps.modQuotesDesc', default: false },
  { id: 'invoice_reminders', icon: '🧾', nameKey: 'settings.aiApps.modInvoices', descKey: 'settings.aiApps.modInvoicesDesc', default: false },
  { id: 'team_updates', icon: '👥', nameKey: 'settings.aiApps.modTeam', descKey: 'settings.aiApps.modTeamDesc', default: false },
  { id: 'calendar_conflicts', icon: '🚨', nameKey: 'settings.aiApps.modConflicts', descKey: 'settings.aiApps.modConflictsDesc', default: false },
  { id: 'news_industry', icon: '📰', nameKey: 'settings.aiApps.modNews', descKey: 'settings.aiApps.modNewsDesc', default: false },
  { id: 'traffic_commute', icon: '🚗', nameKey: 'settings.aiApps.modTraffic', descKey: 'settings.aiApps.modTrafficDesc', default: false },
  { id: 'email_draft_review', icon: '✉️', nameKey: 'settings.aiApps.modDrafts', descKey: 'settings.aiApps.modDraftsDesc', default: false },
  { id: 'sales_kpi', icon: '🎯', nameKey: 'settings.aiApps.modKpi', descKey: 'settings.aiApps.modKpiDesc', default: false },
  { id: 'customer_sentiment', icon: '🙂', nameKey: 'settings.aiApps.modSentiment', descKey: 'settings.aiApps.modSentimentDesc', default: false },
  { id: 'expense_reminders', icon: '🧮', nameKey: 'settings.aiApps.modExpenses', descKey: 'settings.aiApps.modExpensesDesc', default: false },
  { id: 'personal_reminders', icon: '📌', nameKey: 'settings.aiApps.modPersonal', descKey: 'settings.aiApps.modPersonalDesc', default: false },
];

export const DEFAULT_MODULES = MODULES.filter(m => m.default).map(m => m.id);
// → ['weather', 'today_tasks', 'meetings', 'project_status', 'hot_leads', 'stale_deals']
```

**注意：** 前端 `MODULES` 同後端 `KNOWN_MODULES` 必須同步 — 加新 module 要兩邊一齊加。

---

## 3. 後端 Core Workflow

### 3.1 數據源 — `backend/app/ai/briefing_sources.py`

每個 module 對應一個 async function，簽名統一：

```python
async def <module_name>(ctx: AISessionContext, db: AsyncSession) -> list[dict[str, Any]]:
```

**約定（file docstring 明文規定）：**
- 任何 failure return `[]` / `{}` — module 數據源永遠唔可以 crash 成個 briefing
- RLS 由 `get_tenant_session` set 嘅 `app.tenant_id` GUC 保證 tenant 隔離
- 所有查詢都要 `WHERE tenant_id == ctx.tenant_id`（app-layer 雙保險）

#### Module → Source 對照表

| Module | Function | 數據來源 | 邏輯 |
|---|---|---|---|
| `project_status` | `project_status()` | `projects` + `companies` | 非 done/cancelled/archived，deadline 最近優先，limit 8 |
| `stale_deals` | `stale_deals(days=14)` | `deals` + `companies` | open + `updated_at` > 14 日冇郁，limit 8 |
| `quote_tracking` | `quote_tracking()` | `quotes` + `deals` | draft/sent，`valid_until` 最近到期優先，limit 8 |
| `overdue_followup` | `overdue_followup(days=7)` | `touchpoints` + `contacts` | 7 日內冇 touchpoint 嘅 contact（invert active set），limit 8 |
| `birthday_reminders` | `birthday_reminders()` | `contacts` custom_fields | `birthday_month` == 當前 HKT 月份，limit 20 |
| `hot_leads` | `hot_leads()` | `deals` + `companies` | open + probability ≥ 70，金額大優先，limit 8 |
| `sales_kpi` | `sales_kpi()` | `user_targets` + `deals` | 當前週期 target vs won 金額總和 → `progress_pct` |
| `team_updates` | `team_updates()` | `team_members` + `teams` + `tasks` | 用戶所屬 team 成員嘅 pending/in_progress tasks，limit 10 |
| `invoice_reminders` | `invoice_reminders()` | `quotations` | DRAFT/PENDING/SENT，`valid_until` 優先，limit 8 |
| `weather` | `weather()` | HKO Open Data API | `rhrread` endpoint，溫度/濕度/icon/降雨量 |
| `unread_messages` | `unread_messages()` | Gmail/Outlook OAuth | `is:unread`，每 provider 最多 8 封 metadata |
| `calendar_conflicts` | `calendar_conflicts()` | `project_calendar_events` | 今日 event 重疊偵測（`b.start < a_end`），per-user 隔離 |
| `news_industry` | `news_industry()` | SCMP + BBC RSS | 每 feed 最多 10 條 headline |
| `traffic_commute` | `traffic_commute(lang_pref)` | 運輸署 data.gov.hk | status 1/3，`_simplify_traffic()` 壓縮成「地點：事件」，limit 5 |
| `email_draft_review` | `email_draft_review()` | `ai_drafts` | `pending_review` 狀態，limit 8 |
| `customer_sentiment` | `customer_sentiment()` | `ai_messages` + `ai_sessions` | 30 日 user messages，關鍵字正負面計分 + 樣本 |
| `expense_reminders` | `expense_reminders()` | `expenses` | pending 狀態，金額 float，limit 8 |
| `personal_reminders` | `personal_reminders()` | `personal_notes` | 未 done + remind_at 喺 1 小時內，limit 8 |

**新增 module 嘅標準 function 模板：**

```python
async def my_new_module(ctx: AISessionContext, db: AsyncSession) -> list[dict[str, Any]]:
    """Describe what this module surfaces and from which table/API."""
    try:
        rows = (
            await db.execute(
                select(MyModel)
                .where(
                    MyModel.tenant_id == ctx.tenant_id,   # ← 必備 tenant 隔離
                    MyModel.user_id == ctx.user_id,        # ← 個人數據再加 user
                    # ... filters
                )
                .order_by(MyModel.created_at.desc())
                .limit(8)
            )
        ).scalars().all()
    except Exception:
        return []                                          # ← graceful failure
    return [_row_to_dict(r) for r in rows]
```

### 3.2 生成 Pipeline — `backend/app/services/briefing_generator.py`

```python
async def generate_briefing(db, tenant_id, user_id, slot) -> dict:
    """Full pipeline for one user: settings → collect → LLM → store → IM push."""
```

**步驟（file docstring 記錄嘅 5-step workflow）：**

```
1. _load_settings(db, user_id)                    → SecretarySettings.modules
   （冇 settings → 用 DEFAULT_MODULES）
2. _collect_modules(ctx, db, modules)             → 逐個 module call briefing_sources fn
   （先 force sync_user_calendars → 再 _build_crm_briefing 攞 schedule/tasks/weather
    → 再行 fn_map 嘅 17 個 module sources）
3. LLM 生成（deepseek / deepseek-chat, temp 0.7, max_tokens 2048）
   _build_prompt(slot, settings, data) ：
     - SYSTEM_PROMPT 硬性規則：
       「用 {lang} 書面語/口語，全部 bullet points，有 data 就報 data，
        冇 data 就 skip section，嚴禁「一切安好」AI 腔空泛句，
        每個 event 標明來源 label（[Kinetix]/[Personal]/[敬拜隊]）」
     - SLOT_PROMPTS：morning 🌅 / noon ☀️ / evening 🌆 / night 🌙
       （每 slot 有唔同指示，例如 morning = 天氣+行程+任務+CRM 概覽）
4. 存入 PG `generated_briefings`（raw SQL INSERT）
   + UsageEvent（provider/model/tokens/cost，module='briefing'）
5. _im_push_if_enabled(db, tenant_id, user_id, slot, content)
   → WhatsApp push（gated by IMDeliveryPref：enabled / slots / weekend_mute / quiet_hours）
   → 全部 outcome 寫 push_log
```

**LLM prompt 核心（`SYSTEM_PROMPT`）：**

```python
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
```

**Slot 設定（`SLOT_PROMPTS`）：**

```python
SLOT_PROMPTS = {
    "morning": {"label": "早安", "emoji": "🌅",
                "instructions": "早晨簡報：天氣 + 今日行程 + 優先任務 + CRM 概覽。展望今日。"},
    "noon":    {"label": "午安", "emoji": "☀️",
                "instructions": "午間簡報（輕量）：天氣 + 今日餘下行程 + 今日到期任務提醒。"},
    "evening": {"label": "晚安", "emoji": "🌆",
                "instructions": "收工簡報：今日回顧 + 聽日預告 + 未完任務。"},
    "night":   {"label": "深夜", "emoji": "🌙",
                "instructions": "深夜回顧：今日總結 + 聽日預告 + 明日天氣。"},
}
```

### 3.3 Scheduler — `backend/app/services/briefing_scheduler.py`

```python
async def run_scheduler(dry_run=False) -> dict:
    """Loop all tenant/user members → set RLS GUCs → generate_briefing per user."""

async def run_for_all_users(db, slot) -> dict:
    """briefing_generator 版 — per-member 檢查 tenant 有冇 CRM data 先燒 LLM。"""
```

**RLS 重點（2026-08-22 加固後）：**
- `ai_secretary_settings` 用 `user_isolation_settings` policy（user_id + tenant_id 兩個 GUC，FORCE RLS）
- Scheduler 一定要 per-member `set_config('app.tenant_id') + set_config('app.user_id')`
- 冇 set → silent 0 rows（之前 bug：scanned=0，修復後 scanned=9）
- `run_for_all_users` 有 CRM-data gate：`count(companies) == 0` → skip（慳 LLM tokens）

### 3.4 REST Endpoints — `backend/app/routers/ai_secretary.py`

| Endpoint | 用途 | Gate |
|---|---|---|
| `GET /api/v1/ai-secretary/settings` | 讀用戶 secretary settings | JWT |
| `PATCH /api/v1/ai-secretary/settings` | 更新 modules/workdays/tone/lang/channels | JWT（modules 必須 ∈ MODULE_CONNECTED 且 connected） |
| `POST /api/v1/ai-secretary/settings/reset` | 還原 DEFAULT_MODULES | JWT |
| `GET /api/v1/ai-secretary/briefing` | 20-module 數據（working-hours aware） | JWT |
| `GET /api/v1/ai/briefing` | CRM core（schedule/tasks/weather/ai_tip + LLM content） | JWT |

---

## 4. Web Layout Source Code

### 4.1 Dashboard 整合 — `src/components/v4/DashboardV2.tsx`

- Import：`import { sectionIcon, sectionRouteWithItemFallback } from './briefingRoutes'`
- AI insight 區：`apiClient.get('/api/v1/ai/briefing')` → 攞 generated content
  - 有 content → 用 portal style 渲染 section（`**header**` → 對應 page）
  - 冇 content（今日未 generate）→ Fallback：CRM-core mapping
- 每個 section item 可點擊 → `sectionRouteWithItemFallback(sec.header, it)` 決定跳邊頁

### 4.2 Section → Page 映射 — `src/components/v4/briefingRoutes.ts`（完整 source）

```typescript
export interface BriefingRouteGroup {
  route: string | null
  icon: string
  patterns: string[]
}

export const BRIEFING_ROUTE_MAP: BriefingRouteGroup[] = [
  {
    route: '/tasks',
    icon: 'tasks',
    patterns: ['任務', '優先', '未完', '到期', '死線', '提醒', 'todo', 'task', 'priority', 'overdue', 'deadline', 'reminder'],
  },
  {
    route: '/calendar',
    icon: 'calendar',
    patterns: ['行程', '會議', '活動', '預告', 'schedule', 'meeting', 'calendar', 'event', 'agenda'],
  },
  {
    route: '/contacts',
    icon: 'crm',
    patterns: ['crm', '客戶', '聯絡人', '生日', '人脈', 'lead', 'contact', 'customer', 'birthday', 'sentiment'],
  },
  {
    route: '/deals',
    icon: 'opp',
    patterns: ['交易', '報價', '商機', '停滯', '發票', '銷售', 'deal', 'quote', 'pipeline', 'invoice', 'sales', 'kpi', 'revenue', 'opportunit'],
  },
  { route: '/projects', icon: 'spark', patterns: ['項目', 'project'] },
  { route: '/team', icon: 'spark', patterns: ['團隊', 'team'] },
  { route: '/notifications', icon: 'spark', patterns: ['通知', 'notification'] },
]

/* Info-only sections — 故意唔可點擊 */
export const BRIEFING_INFO_SECTIONS = [
  '天氣', 'weather', '新聞', 'news', '行業', '交通', '通勤', 'traffic', 'commute',
  '電郵', '郵件', '草稿', 'email', 'draft', '開支', '支出', 'expense',
  '總結', '回顧', '展望', 'summary', 'review', 'outlook', '其他', 'other',
]

const EMOJI_RE = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu
const PAREN_RE = /（[^）]*）|\([^)]*\)/g

export function normalizeBriefingHeader(h: string): string {
  return h
    .replace(EMOJI_RE, '')          // 剝 emoji
    .replace(PAREN_RE, '')          // 剝 （日期）
    .replace(/[\s:：]+/g, '')
    .trim()
    .toLowerCase()
}

export function sectionRoute(header: string): string | null {
  const n = normalizeBriefingHeader(header)
  if (!n) return null
  for (const g of BRIEFING_ROUTE_MAP) {
    if (g.patterns.some(p => n.includes(p))) return g.route
  }
  return null
}

export function sectionIcon(header: string): string { /* 同上，返 icon */ }

/* Item-level fallback — header 冇 match 時用 item 內容強信號 */
const ITEM_SIGNALS: { route: string; patterns: string[] }[] = [
  { route: '/calendar', patterns: ['會議', 'meeting', 'teams', '📅', '📆'] },
  { route: '/tasks', patterns: ['死線', 'due', 'p1', 'p2', 'p3', '優先', '📚', '📖', '🖥', '⏰', '✅'] },
  { route: '/deals', patterns: ['報價', 'quote', '商機', '停滯'] },
  { route: '/contacts', patterns: ['生日', 'birthday', '客戶'] },
]

export function sectionRouteWithItemFallback(header: string, itemText: string): string | null {
  const direct = sectionRoute(header)
  if (direct) return direct
  const item = itemText.toLowerCase()
  for (const s of ITEM_SIGNALS) {
    if (s.patterns.some(p => item.includes(p))) return s.route
  }
  return null
}
```

**加新 section type 嘅方法：**
1. `BRIEFING_ROUTE_MAP` 加一組（route + icon + zh/en patterns）
2. Header normalization 會自動剝 emoji + （日期）suffix，patterns 用 bare keyword
3. 冇 match 嘅 section（天氣/新聞/交通/總結）保持純文字 — 列喺 `BRIEFING_INFO_SECTIONS` 記錄意圖

### 4.3 AIBriefingDrawer — `src/components/AIBriefingDrawer.tsx`（portal 主 UI，1000 lines）

**Data flow（`loadBriefing()`）：**

```
1. GET /api/v1/ai/briefing        → schedule / tasks / ai_tip / content / slot
2. GET /api/v1/crm/deals?status=open&limit=50      → open deals
3. GET /api/v1/crm/quotes?limit=100                → quotes
4. 本地聚合：RiskInsight[]（deal open + sent quote + idle ≥ 7 日）→ 按 daysIdle 排序
5. GET /api/v1/ai-secretary/briefing               → 20-module 數據（weather/news/traffic/...）
6. 組 greeting + summary（parts.join(' · ')）
```

**Greeting 邏輯（`currentGreetingSlot`）：**
- 從 backend `greeting_slots` 揀當前 slot（morning 07:00 / afternoon 12:00 / evening 18:00 / lateNight 00:00）
- `hktNow()` = `Date.now() + 8*3600*1000`（Asia/Hong_Kong 無 DST，直接 +8h）
- 每 60 秒 re-evaluate slot

**Typewriter 效果：**
- Drawer 展開 → greeting + aiTip 逐字打出（每 24ms +2 chars）
- 播完一次 → `animationPlayedRef` 記住，之後即時顯示

**Inline 風險處理（graduated autonomy）：**
- 每個 RiskInsight 有「跟進」button → `startDraft()` 模擬 AI 草擬追蹤電郵（中/英）
- `sendDraft()` 目前只係 local state（`sentOk`）— 未真正 send

**Weather emoji 映射（`hkoWeatherEmoji`）：**
```
≤50 ☀️ | 51 🌤️ | 52 🌥️ | 53-55 ☁️ | 60-65 🌦️ | 70-73 🌧️ | 74-79 ⛈️ | 80-88 🌫️ | ≥91 💨
```

### 4.4 DailyBriefingCard — `src/components/DailyBriefingCard.tsx`（dashboard 卡片）

- `GET /api/v1/ai/briefing` → weather / schedule(5) / tasks(5) / aiTip / content
- 有 `content` → 顯示「🤖 AI 簡報 · {slot}」區塊（紫色 highlight，`whiteSpace: pre-wrap`）
- Sections：Weather / Schedule / Tasks / AI Tip（`SectionRow` sub-component）
- Fallback：任何 error → mock data（唔 crash）
- 任何內容冇 → `t('pages.briefing.noEvents')` / `noTasks`

### 4.5 前端 settings — `src/pages/SettingsPage.tsx`

- Module 揀選 UI 用 `MODULES` 清單 render
- `connected_modules` 由 backend 返 — 未 connected 嘅 module 灰咗揀唔到
- PATCH 時 backend 再驗證一次（`unknown` / `not yet connected` → 422）

---

## 5. 升級 Briefing Content Modules — 檢查清單

加一個新 content module 要郁嘅地方（5 處）：

| # | 檔案 | 改咩 |
|---|---|---|
| 1 | `backend/app/ai/briefing_sources.py` | 加 `async def <module>()`（跟模板，tenant filter + graceful failure） |
| 2 | `backend/app/routers/ai_secretary.py` | `KNOWN_MODULES` 加 key + `MODULE_CONNECTED[key] = True` |
| 3 | `backend/app/services/briefing_generator.py` | `_collect_modules()` 嘅 `fn_map` 加 `"<key>": bs.<fn>` |
| 4 | `src/hooks/useSecretarySettings.ts` | `MODULES` 加 `{ id, icon, nameKey, descKey, default }` |
| 5 | `src/i18n/locales/zh-TW.json` + `en.json` | 加 `mod<Name>` / `mod<Name>Desc` 文案 |

**可選（視 module 類型）：**
- 要 portal 跳頁 → `src/components/v4/briefingRoutes.ts` 加 route group + patterns
- 要 dashboard 卡片顯示 → `AIBriefingDrawer.tsx` `loadBriefing()` 加 fetch + summary part
- 要 IM push → 唔使改（generate_briefing 自動包埋）

**驗證：**
```bash
# 1. settings 接受新 module
curl -X PATCH https://nexus-crm-api.kinet-poc.com/api/v1/ai-secretary/settings \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"modules": ["weather", "my_new_module", "..."]}'

# 2. briefing endpoint 有返數據
curl https://nexus-crm-api.kinet-poc.com/api/v1/ai-secretary/briefing \
  -H "Authorization: Bearer $TOKEN"

# 3. 生成 pipeline（dry run）
cd backend && PYTHONPATH=. ./venv/bin/python -c "
import asyncio
from app.services.briefing_scheduler import run_scheduler
asyncio.run(run_scheduler(dry_run=True))"

# 4. RLS 確認（新 module 有冇 set GUC 先查表）
sudo -u postgres psql -d nexus_crm -c \"SET app.tenant_id='<tenant>'; SELECT count(*) FROM <new_table>; RESET ALL;\"
```

---

## 6. 已知陷阱（2026-08-22 加固記錄）

1. **`ai_secretary_settings` 係 user_isolation policy** — 要 user_id + tenant_id 兩個 GUC，scheduler loop 必須兩個都 set，否則 silent 0 rows
2. **`generated_briefings` 有 FORCE RLS** — 寫入前必須 set GUC，否則 INSERT 被 WITH CHECK 擋
3. **`_build_crm_briefing` 喺 `app/routers/ai.py`** — `_collect_modules` 靠佢攞 schedule/tasks/weather；改 briefing 結構要同步改呢個
4. **`sync_user_calendars(force=True)` 喺 collect 前** — remote calendar 更新先落入 `project_calendar_events`，briefing 先讀到；sync failure 要 `except: pass` 唔好 block
5. **LLM 輸出直接入 `generated_briefings.content`** — portal 靠 `**section header**` markdown pattern 切 section；改 prompt 格式會影響 portal 渲染（`briefingRoutes.ts` 對應）
6. **IM push 係 WhatsApp 優先**，Telegram 係 scheduler 版 fallback（`_push_telegram` → `_push_whatsapp`）— `briefing_generator._im_push_if_enabled` 只做 WhatsApp
7. **前端 `hktNow()` 唔可以用 `toISOString()`**（嗰個係 UTC）— 所有日期判斷用 `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' })`

---

## 7. 相關檔案索引

```
後端：
  backend/app/ai/briefing_sources.py        ← 20 個 module 數據源（核心）
  backend/app/services/briefing_generator.py ← LLM 生成 pipeline
  backend/app/services/briefing_scheduler.py ← cron scheduler（RLS GUC loop）
  backend/app/routers/ai_secretary.py        ← settings + briefing REST API
  backend/app/routers/ai.py                  ← _build_crm_briefing + chat
  backend/app/models/ai/secretary_settings.py
  backend/app/models/im_push.py              ← IMDeliveryPref + PushLog

前端：
  src/components/AIBriefingDrawer.tsx        ← portal 主 briefing UI（1000 lines）
  src/components/DailyBriefingCard.tsx       ← dashboard 卡片
  src/components/v4/DashboardV2.tsx          ← dashboard 整合點
  src/components/v4/briefingRoutes.ts        ← section → page 映射（data-driven）
  src/hooks/useSecretarySettings.ts          ← module 清單 + settings 快取
  src/pages/SettingsPage.tsx                 ← module 揀選 UI
  src/i18n/locales/zh-TW.json / en.json      ← 文案
```
