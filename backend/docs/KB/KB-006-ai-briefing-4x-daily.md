# KB-006 — AI Briefing 係一天 4 次預生成，唔係即時更新（2026-08-24 確立）

## 規則

**G08 AI briefing（summary + content + layers）全部係一天 4 次預生成**
（slot：morning / noon / evening / night → 存 `nexus_crm.generated_briefings` cache）。

- ❌ Dashboard **唔可以**標「即時更新」（v6.92 犯過 — 用戶 correction）
- ✅ 用「每日 4 次更新」+ 最後生成時間（`generated_at` → `每日 4 次更新 · 08:00`）
- v6.96 起 dashboard hero badge 已改

## 成本控制（5 萬人考量）

- Summary 併入 briefing 嘅**同一 LLM call**（prompt 要求 `<summary>...</summary>` tag → parsing 抽走）
- `adapter.chat` 全檔只有 1 次 call — summary 邊際成本 = 0
- 5 萬用戶 × 4 次/日 = 20 萬 LLM calls/日，呢個係 briefing 本身嘅成本，summary 唔加價
- Dashboard 讀 cache（DB read），任何情況都唔可以喺 request 路徑觸發 LLM

## 架構

```
briefing_scheduler（4 次/日）→ generate_briefing()
  → _build_prompt（要求 <summary> 1-2 句整合摘要，跟 lang_pref）
  → adapter.chat（1 次 LLM call → summary + content）
  → parse <summary> tag → 存 generated_briefings(summary, content)
  → IM push（content 已剝 tag，唔影響）
Dashboard GET /api/v1/ai/briefing → 讀 cache → summary + layers + content
```

## 語言

- AI Summary 跟用戶 `lang_pref`（ai_secretary_settings）— zh-HK / zh-TW / en
- Language 設定喺 **AI Apps 頁面**（`AIAppsPage.tsx` lang_pref 選擇器）— 唔可以移去其他地方
