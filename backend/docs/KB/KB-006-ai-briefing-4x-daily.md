# KB-006 — AI Briefing 跟 AI 應用時間表預生成，唔係即時更新（2026-08-24 確立）

## 規則

**G08 AI briefing（summary + content + layers）全部係預生成**（slot：morning / noon /
evening / night → 存 `nexus_crm.generated_briefings` cache），**唔係即時更新**。

- 生成時間表 = 用戶喺 **AI 應用**設定嘅 `greeting_slots`（`ai_secretary_settings`，
  每用戶唔同，default morning/noon/evening/night）— 唔係 hardcode 次數
- ❌ Dashboard **唔可以**標「即時更新」（v6.92 犯過 — 用戶 correction）
- ❌ Dashboard **唔好明示次數**（v6.96 用「每日 4 次更新」→ 用戶 correction：
  「每天 4 次不用明示，要跟 AI app 嘅時間表就可以」）
- ✅ 用「🕐 HH:MM」顯示最後生成時間（`generated_at` — 反映 AI app 時間表實際生成時刻）
- v6.97 起 dashboard badge 已改

## IM Push（用戶設定咗 IM 就同步發送）

- 用戶喺 AI 應用設定好嘅 channel（`IMDeliveryPref` enabled + mapping active）→
  briefing 生成後同步推送（Telegram primary → WhatsApp fallback，各自 channel gate：
  enabled / slots / weekend_mute / quiet_hours）
- **推送內容必須轉換該 IM 嘅 style**（`briefing_scheduler._style_for_channel`）：
  - Telegram：時間放最前 header（`🕐 HH:MM · 🌅 早安`）、剝走重複 title、
    壓縮空行（高密度）、`|` table 轉 bullet、截斷 4000 chars
  - WhatsApp：壓空行 + 截斷（寬鬆啲，保留原文）
- **按類別分開發送（v7.00 確立 — 用戶：「message 一次過太長睇唔到，請按類別做
  分類發送」）**：LLM 輸出用 `<<<category:XXX>>>` tags 分節（notifications /
  reminders / info / bible）→ `generate_briefing` parse 成 `categories` jsonb
  存 DB → scheduler 每類一條 message 推送（`🕐 HH:MM · 🔔 通知 / ⏰ 提醒 /
  📰 資訊 / 📖 聖經`）。Dashboard 讀完整 content（tags 剝走、保留 section headers）。
- **每個模組都有 tag（v7.01 確立 — 用戶：「每個模組都加個 tag 容易啲區分」）**：
  `MODULE_TAGS` 定義 module → emoji+短名（🌦️ 天氣 / 📅 行程 / ✅ 任務 / 📰 新聞 /
  ⏰ 跟進 / 💰 費用 / 🧾 發票 / ⚠️ 衝突…），LLM 輸出每行 `- {tag} {內容}`；
  `MODULE_CATEGORY` 固定 module → 4 大類別歸屬（分類唔靠 LLM 估）
- **聖經唔列經文內文（v7.00 確立）**：只提供 reference + 今日經文連結
  （bible.com / 微讀）— 用戶會自己開 Bible app 睇
- scheduler 統一控制推送（`skip_im_push=True` 傳俾 generator）— 避免 double push

## 成本控制（5 萬人考量）

- Summary 併入 briefing 嘅**同一 LLM call**（prompt 要求 `<summary>...</summary>` tag → parsing 抽走）
- `adapter.chat` 全檔只有 1 次 call — summary 邊際成本 = 0
- LLM calls/日 = 用戶數 × 活躍 slots 數（跟 greeting_slots，唔係硬性 4 次）
- Dashboard 讀 cache（DB read），任何情況都唔可以喺 request 路徑觸發 LLM

## 架構

```
briefing_scheduler（跟 greeting_slots 時間表）→ generate_briefing(skip_im_push=True)
  → _build_prompt（要求 <summary> 1-2 句整合摘要，跟 lang_pref）
  → adapter.chat（1 次 LLM call → summary + content）
  → parse <summary> tag → 存 generated_briefings(summary, content)
  → scheduler 統一 push：_style_for_channel(channel style 轉換) → Telegram/WhatsApp
Dashboard GET /api/v1/ai/briefing → 讀 cache → summary + layers + content
```

## 語言

- AI Summary 跟用戶 `lang_pref`（ai_secretary_settings）— zh-HK / zh-TW / en
- Language 設定喺 **AI Apps 頁面**（`AIAppsPage.tsx` lang_pref 選擇器）— 唔可以移去其他地方
