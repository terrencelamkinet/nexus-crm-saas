# NEXUS AI CRM — Product Overview

> **Status:** Draft v0.1 (2026-08-07) — for review
> **Base:** NEXUS CRM (G08) + Permission-Aware AI Module spec
> **Stack:** FastAPI + React/TS + PostgreSQL 16 (RLS) · Deploy: Vite static + systemd / Cloudflare Tunnel

---

## 1. Goal

**一句話:** 一個 AI-native CRM — AI 唔係加喺側邊嘅 chatbot，而係幫你「記住、回覆、跟進、寫入」嘅核心引擎，而且永遠喺權限界線之內運作。

**問題:** 傳統 CRM 係「輸入系統」— 銷售員要手動輸入 meeting notes、跟進事項、deal 進度。結果係 CRM 數據過期、團隊唔用、管理層睇唔到真相。

**承諾:** NEXUS AI CRM 令 CRM 由被動資料庫變成主動助理 — AI 自動捕捉對話、整理客戶記憶、起草跟進訊息、執行寫入 — 每一步都有 permission guard 同 audit trail。

**核心原則（不可妥協，來自 spec）:**
- **Default Deny + Least Privilege** — 任何資料表 / API / AI tool 預設不可存取
- **四層強制隔離:** DB RLS → API Middleware → AI Tool Guard → RAG Metadata Filter
- **AI 永不直連 DB** — 只能經白名單 tool
- **AI 寫入 = Draft → Preview → Confirm → Execute → Audit Log**（用戶確認先執行）
- AI 可改個人 dashboard/view 設定，但永遠改唔到 system config

**North Star Metric:** 由 meeting/訊息到 CRM 記錄嘅時間（目標 < 1 分鐘）＋ AI 執行嘅寫入動作每日被確認次數。

---

## 2. Who is this for

| Segment | 描述 | 痛點 |
|---------|------|------|
| **SMB 銷售團隊（5–50 人）** | 香港 / 亞太區優先 | 冇 IT 團隊、CRM 太複雜、Salesforce 太貴太難用 |
| **一人多職嘅 Founder / Operator** | 老闆自己見客、追數、覆 WhatsApp | 冇時間入 CRM，但需要記得每個客戶 |
| **銷售經理** | 要 pipeline 真相 + 自動化跟進 | 團隊唔入 data，report 靠估 |
| **服務型公司（物流 / 顧問 / 貿易）** | Kinetix 同類 | 跟進多、續約多、WhatsApp 係主要溝通渠道 |

**用戶唔係 IT 人。** 產品必須 5 分鐘內見到價值，唔使 training。

**亞太區 reality:** WhatsApp / Telegram 係銷售員嘅主要工作介面 — CRM 必須喺 IM 入面存在，唔係逼人開 browser。

---

## 3. MVP Key Features

**Phase 1 — 安全 CRM AI MVP**（來源: permission-aware spec §開發路線圖）

### 3.1 Core CRM（已有）
- Contacts / Companies / Deals / Projects / Tasks / Calendar / Touchpoints
- 多租戶 RLS 隔離 + JWT (access 15min / refresh 7d) + email MFA
- Dashboard widget system（可自訂 + 跨 browser 持久化）

### 3.2 AI Assistant（已有基礎 + 補權限層）
- **AI Chatbox**（portal 內 + WhatsApp/Telegram 跨渠道，記晒所有渠道歷史）
- 自然語言查詢 CRM：「總結今日重點」「邊個 deal 要跟進」
- **AI 寫入 = Draft → Preview → Confirm → Execute → Audit:** AI 提出動作（建 task、更新 deal stage、加 touchpoint），用戶喺 UI 確認先執行
- **AI Daily Briefing:** 每朝自動總結今日會議、續約、deadline

### 3.3 權限與安全（MVP 必須，唔係後話）
- 身份模型: `Platform → Tenant → Workspace → Team → User → Personal`
- 四層強制隔離 + 18 項驗收測試（tenant isolation、prompt injection、vector search isolation、quota、audit completeness）
- **Quota / Subscription** — Free / Pro 用量限制
- Provider 抽象層（LLM provider failover，API key 唔入 frontend）

### 3.4 IM 整合（MVP 核心差異化）
- WhatsApp / Telegram 對話自動入 CRM（webhook + STT + dedup）
- IM 內直接問 AI + 確認寫入動作

---

## 4. Nice-to-Have Features

| Feature | 描述 | Phase |
|---------|------|-------|
| **Meeting → Task 自動轉換** | 會議記錄入 CRM，AI 抽出 action items 自動開 task | P2 |
| **RAG Knowledge Base** | 公司文件/email 入 vector store，AI 答嘢有根據 + metadata filter 隔離 | P2 |
| **Email 自動草稿** | AI 起草回覆，用戶一鍵確認 | P2 |
| **Renewal Radar** | 續約倒數 + 自動提醒 + 建議動作 | P2 |
| **Voice Notes → Touchpoint** | Telegram voice message 自動 STT 入 CRM | P2 |
| **Team Assistant** | 團隊共享 AI 視圖（嚴格按權限） | P2 |
| **AI 小工具市集** | Marketplace 第三方 widget / integration | P2–3 |
| **SSO / SCIM / BYOK / DLP** | Enterprise 客戶要求 | P3 |
| **White-label** | 經銷商用自己 brand | P3 |

---

## 5. Roadmap

```
Phase 1 (MVP)          Phase 2 (AI 工作流)        Phase 3 (Enterprise)
─────────────          ─────────────────         ───────────────────
權限模型 + Chatbox      Daily Briefing 進化        SSO / SCIM
Quota + Subscription    Meeting → Task            BYOK（自帶 LLM key）
Preview/Confirm 流程    RAG + 文件知識庫           DLP + 審計報告
18 項驗收測試           Team Assistant            Data residency (HK/JP)
IM 渠道 (WA/TG)         Pro plan                  Admin governance
```

- **P1 (2026 Q3–Q4):** 安全 MVP + 10 個設計夥伴 beta
- **P2 (2027 Q1–Q2):** AI 工作流 + Pro plan 收費
- **P3 (2027 Q3+):** Enterprise 功能 + 經銷渠道

**原則:** 每個 phase 有 gate — 驗證上一 phase 嘅 adoption 先開下一 phase。唔做「功能堆疊」。

---

## 6. Competitor Analysis

| 產品 | 定位 | 強項 | 弱點（我哋嘅機會） |
|------|------|------|-------------------|
| **Salesforce Einstein / Agentforce** | Enterprise CRM + AI agent | 生態龐大、信任、功能齊 | 貴（$150+/seat）、設定以月計、SMB 用唔起 |
| **HubSpot + Breeze AI** | Mid-market 全端 CRM | UX 好、免費 tier、AI 融入 CRM | 每 seat 計價、IM 渠道支援弱、AI 寫入唔係 permission-first |
| **Zoho CRM + Zia** | SMB 平價 | 平、功能多 | UI 老舊、AI 深度有限、support 一般 |
| **Pipedrive AI** | Sales-first SMB | Pipeline 清晰、易上手 | 功能淺、AI 係 add-on 唔係核心 |
| **Attio** | Startup 數據優先 CRM | 靈活 record model、API/automation 強 | 冇 IM-native 場景、亞太區本地化弱 |
| **Folk** | SMB 關係管理 | 輕量、AI 補全資料 | 唔係完整 CRM、團隊協作弱 |

**我哋嘅 differentiation（唔係「又多一個 AI chatbot」）:**
1. **Permission-Aware AI 寫入** — AI 可以做嘢，但每一步 Draft → Confirm → Audit。企業客戶最怕 AI 亂寫 data；呢個係信任核心。
2. **IM-native** — WhatsApp/Telegram 係 first-class channel（記錄、查詢、確認動作全部喺 IM 完成）。香港/亞太 reality，對手全部當 IM 係 afterthought。
3. **四層隔離做 enterprise-ready 賣點** — 由第一天就 security-first，上 P3 唔使重寫。
4. **SMB 價錢 + 5 分鐘上手** — 對準 Salesforce 下面成個空白市場。

---

## 7. Brand Guidelines

### 定位
> 「信任嘅 AI CRM」— AI 幫你做嘢，但永遠喺你畫嘅界線內。

### 名稱
- **NEXUS AI CRM**（產品）— NEXUS 語意: 連接人、對話、data 嘅中心點

### 視覺（跟 NEXUS Design Guide 2026）
- **Primary:** `#146EF5`（信任藍）— 主動作、連結、AI 相關強調
- **Accent:** 紫色 `#7C5CFC` + 青色 `#22D3EE` — 限 AI 元素（glow、AI 卡片邊框），**唔可以做 action color**（teal trap — 青色唔夠對比，唔可以做按鈕）
- **Danger:** `#FF3B30` · **Success:** `#22C55E`
- **字型:** SF Pro / Inter 系 — 數字用 tabular figures
- **圓角:** `--radius-md 8px` / `--radius-lg 12px` / `--radius-xl 16px`
- **Dark/Light:** 兩套 theme 都支援，dark 優先

### 設計原則
1. **AI 要有視覺身份** — AI 內容（glow、avatar、badge）一眼認出，但唔會搶走用戶 data 嘅視覺層級
2. **確認永遠清楚** — 任何 AI 寫入動作，Confirm UI 必須列出「改咗咩、邊個做、幾時」
3. **Mobile-first** — 390px 寬度為基準，44px touch target（Apple HIG）

### Voice
- 簡潔、直接、專業。唔扮 human，但唔機械。
- 用戶寫粵語/English 都得 — AI 跟用戶語言回覆。
- 永遠講清楚「呢個係 AI 建議」— 唔好假裝係系統自動。

---

## 8. Wireframes & Features

### 8.1 Dashboard（widget grid + AI 入口）
```
┌─────────────────────────────────────────────┐
│ 早安，Terrence 👋   [Create] [⚙編輯] [AI助手◉] │  ← FAB 常駐
│ 2026年8月7日星期五                            │
├──────────┬──────────┬──────────┬───────────┤
│ 累計客戶  │ 公司總數  │ 進行中交易│ 待辦任務  │  ← KPI widgets
│   10     │   5      │   4      │   6       │
├──────────┴──────────┴──────────┴───────────┤
│ 🤖 AI 簡報: 今日 3 個會議 · 旭輝空運 7 日後續約 │  ← AI briefing
├─────────────────────────────────────────────┤
│ 今日待辦 ▸ 待跟進 ▸ 續約提醒 ▸ 最近活動        │  ← 可自訂 widget
└─────────────────────────────────────────────┘
```
- 編輯模式: drag / ↑↓ 排序、＋新增小工具（drawer）、×移除 — 自動持久化

### 8.2 AI Chat Panel（portal overlay）
```
┌──────────────────────┐
│ NEXUS AI        [＋][×]│
│ CRM Assistant         │
├──────────────────────┤
│ 你: 旭輝空運而家咩情況？│
│ AI: 旭輝空運有限公司    │
│   • 續約: 7 日後 (P0)  │
│   • 上次互動: 8月2日  │
│   • 建議: 今日打去 offer│
│     renewal discount  │
├──────────────────────┤
│ [輸入…          ] [↑] │  ← send 鍵 46×46 hit area
└──────────────────────┘
```
- Desktop: 400px 右側 overlay（背景 scroll lock）；Mobile: 底部 sheet（keyboard-aware）

### 8.3 AI 寫入 → Confirm Flow（信任核心）
```
AI 建議: 為旭輝空運建立 Task
┌────────────────────────────────┐
│ ✏️ AI 建議動作 (待你確認)        │
│   Task: 跟進續約 - offer 95折   │
│   Deal: 旭輝空運 → Negotiation  │
│   Touchpoint: call + 備註       │
│  ─────────────────────────────  │
│  [ ✕ 拒絕 ]        [ ✓ 確認執行 ] │
└────────────────────────────────┘
→ 執行後寫入 audit log（who/when/what）
```

### 8.4 IM Channel（WhatsApp/Telegram 內完成一切）
```
WhatsApp:
  客戶: 續約嘅 95 折 OK 呀
  AI:   已記錄 ✅
        • Touchpoint 已加（今日 14:32）
        • Deal 更新為 Negotiation
        • 要唔要我幫你 schedule 簽約 meeting?
        [要] [唔使住]
```

### 8.5 Settings / 權限
- Profile / Team / Modules / Billing / Preferences
- (Integrations 已移除 — Marketplace 統一處理)
- AI 權限設定: 每個角色可俾 AI 做咩（read-only / draft / confirm-only）

---

## 9. Documentation & Resources

| 資源 | 位置 | 用途 |
|------|------|------|
| Architecture | `ARCHITECTURE.md`（repo root） | 系統設計、模組邊界 |
| Production 架構 | `G08-PRODUCTION-ARCHITECTURE.md` | deploy / tunnel / systemd |
| Schema | `G08_SCHEMA.md` | DB 結構 + migration 目標 |
| Program Details | `G08_PROGRAM_DETAILS.md` | 功能清單 + 對外說明 |
| 問題知識庫 | `backend/docs/KB/` (KB-001, KB-002) | 已知問題/修復/預防 |
| Project Context | `CONTEXT.md` | 狀態、決定、下一步 |
| AI 權限 Spec | `~/.hermes/skills/terrence/permission-aware-ai-crm-spec/` | 四層隔離 + 18 驗收測試 |
| 設計系統 | `nexus-design-guide-2026` skill | 斷點/字型/icon/色彩 tokens |

**開發工作流:** backend (schema → API) 先 → frontend 後；每次改動 commit + VERSION bump；新 bug 解決後寫 KB entry。

---

## 10. Launch & Beyond

### Launch（P1 尾）
- **Beta:** Kinetix 內部 + 10 個設計夥伴（物流/貿易/顧問行業），免費 3 個月換 feedback
- **Distribution:** 先由 WhatsApp 社群 + 行業圈子口碑（HK 市場唔靠 paid ads 起家）
- **Launch 條件:** 18 項驗收測試全過 + 5 個 beta 客戶連續 30 日使用 + 0 權限事故

### Pricing（預設，P2 定案）
| Tier | 價錢 | 內容 |
|------|------|------|
| **Free** | $0 | 1 user · 50 contacts · 100 AI queries/月 · 2 integrations |
| **Pro** | ~HK$98/user/月 | 無限 CRM · AI 寫入 + 確認 · IM 渠道 · Daily Briefing |
| **Enterprise** | 報價 | SSO/SCIM · BYOK · DLP · data residency · SLA |

### Beyond
- **AI Agent Marketplace** — 第三方 agent / widget 上架，收入分成
- **BYOK / 私有化** — 大客戶自帶 LLM key 或自部署（Mac Mini / on-prem）
- **Geo expansion** — 台灣 / 新加坡（i18n 已就緒）
- **White-label 經銷** — 物流、保險、地產行業版
- **10 年 stack 承諾** — Python/FastAPI + React + PostgreSQL + Redis；Mac Mini 部署 $28/月（vs 雲端 $70/月）

---

*Draft for review — sections 6 (competitor) 同 10 (pricing) 嘅數字係預設值，確認後先入正式 PRD。*
