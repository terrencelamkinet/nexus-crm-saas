# CRM AI Briefing v2（分類版）— 開發建議 Proposal

> **日期：** 2026-09-04（凌晨）
> **來源方案：** `CRM-Briefing-v2-分類版.md`（用戶提供）
> **對照現行：** repo v7.29 + DB live audit（2026-09-03）
> **狀態：** Grill 前草案 — 未寫 code，等你確認核心決定

---

## 一、v2 方案總評

### ✅ 方向正確（採納）
1. **分類骨架固定、module 只係填入內容** — 正正解決「module 開關影響成個 message 結構」嘅現行問題。現行 prompt 按 4 段固定格式生成，module 少時 LLM 會作空泛句填位
2. **Module→分類固定歸屬、唔靠 LLM 判斷** — 現行已有 MODULE_CATEGORY dict，方向一致，只係要重新設計歸屬
3. **To-do/Project 按 P 級分層顯示** — 用戶明確要求過，v2 範本（🔴spelt out / 🟡摺疊 / ⚪壓縮）好
4. **Canceled events 標示「已取消」唔另起一條** — 9/3 樣本實證現行 bug（Canceled 行程照出街）
5. **traffic 只喺出門前推** — 減少噪音，合理
6. **每分類獨立 message（最多 6 條分頭）** — 現行已係每類一條（4 類），擴到 6 類係增量

### ❌ 要修正（唔好照做）
1. **§七.2「每分類獨立 call 一次生成」= 災難**：
   - 成本 ×6（每 call 重新載入 context）
   - 我哋啱啱發現現行重複生成 bug 已經燒 7× tokens（8 月 1,057 條生成 vs 應該 ~124 條）
   - 喪失跨分類一致性（通知區「見 📅 行程」呢類 cross-reference 做唔到）
   - **保留現行單一 LLM call + categories 分拆，只改 prompt 骨架做 6 類**
2. **§七.1「DB 加 category 欄」= 冇實際好處**：
   - Module 係 code-defined（唔係 tenant-defined），MODULE_CATEGORY dict 已經 bind 死
   - 搬 DB = 多一層 sync + migration，仲要處理 tenant override 邏輯
   - **保留 code dict**，新增 MODULE_PRIORITY dict（default P 級）
3. **v2 完全冇提現行 P0/P1 bugs**（重複生成 dedup、lateNight slot key mismatch、WhatsApp sent=0）— 唔修直接起新架構 = 爛地基起樓。**Phase 0 前置修**
4. **§六 傍晚 18:00 只推通知+行程** — 砍走收工回顧（Tasks Summary/今日完成），同你 2026-08 要求「收工簡報：今日回顧+聽日預告+未完任務」**直接矛盾**。要 grill
5. **「可以個別靜音某一類」技術謬誤**：Telegram mute 係 per-chat 唔係 per-message-type — 做唔到淨 mute「📰 資訊」。分開 message 實際好處 = 個別跳讀/刪除/唔阻眼。要 grill 接唔接受 6 條

### ⚠️ v2 內部 inconsistency（要定案）
- 標題「五大分類」但表有 **6 行**（🔔⏰📅📋📰📖）→ 當 6 類
- §二「空內容時該分類唔存在」vs §五.1「分類永遠固定存在」矛盾 → 建議：prompt 骨架 6 類固定（LLM 知有呢個位），但內容空 → 唔 push 嗰條 message（現行行為）

---

## 二、建議目標架構

```
Layer 1: 分類骨架（固定 6 類，prompt 內永遠存在）
  🔔 通知 → ⏰ 提醒 → 📅 行程 → 📋 待辦/項目 → 📰 資訊 → 📖 靈修
Layer 2: Module 歸屬（code dict，module → 分類 + default P 級）
Layer 3: Item P 級（source function 規則計，唔靠 LLM）
Layer 4: Push（單一 LLM call 生成 → 按分類分拆 → 每類一條 message）
```

### Module → 分類歸屬表（v2 修訂版）

| Module | 分類 | Default P | 觸發 |
|---|---|---|---|
| calendar_conflicts | 🔔 通知 | P0 | 有衝突先出（現行）|
| overdue_followup | 🔔 通知 | P1 | 新增逾期即推（Phase 3）；每日摘要 |
| unread_messages | 🔔 通知 | P1 | 事件觸發（Phase 3）|
| customer_sentiment | 🔔 通知 | P2 | 僅負面觸發（Phase 3）|
| weather | ⏰ 提醒 | P2 | 晨早 1 次 |
| personal_reminders | ⏰ 提醒 | P2 | 晨早 1 次 |
| quote/invoice/expense | ⏰ 提醒 | P1 | 到期前 3 日升 P0 |
| email_draft_review | ⏰ 提醒 | P2 | 每日 1 次 |
| birthday_reminders | ⏰ 提醒 | P3 | 當日/前 3 日 |
| meetings | 📅 行程 | P1 | 晨早全覽 + 變動即推（Phase 3）|
| calendar changes | 📅 行程 | P0 | 即時推（Phase 3）|
| traffic_commute | 📅 行程 | P2 | 出門前 1 小時（Phase 2）|
| today_tasks | 📋 待辦/項目 | P1 | 晨早 + 到期即推 |
| project_status | 📋 待辦/項目 | P2 | 每日 1 次 |
| stale_deals/hot_leads/sales_kpi | 📋 待辦/項目 | P2 | 每日 1 次 |
| team_updates | 📰 資訊 | P3 | 每日 1 次（冇更新 skip）|
| news_industry | 📰 資訊 | P3 | 晨早 1 次（只 fetch 1 次）|
| bible_reading | 📖 靈修 | — | 晨早 1 次 |

### Item P 級 formula（source function 規則計）
```
Task:    overdue > 7日 → P0；overdue ≤ 7日 或 今日到期 → P1；有 deadline → P2；冇日期 → P3
Project: overdue > 90日 → P3（v2 自己提）；overdue ≤ 90日 → P2；今日/聽日 deadline → P1
Invoice: 到期前 ≤3日 → P0（v2 自己提）；其餘 → P1
```

### 分類 message 內容上限（防止爆版）
```
📅 行程：5 條 +「+X 個」
📋 待辦/項目：P0-P1 全列（≤8）；P2 摺疊一行；P3 壓縮一行
📰 資訊：每子類 2-5 條
📖 靈修：固定格式
```

---

## 三、分階段路線（每階段獨立可驗證）

### Phase 0 — 地基修復（唔做，一切白做）
| Ticket | 內容 | 驗收 |
|---|---|---|
| T0.1 | 重複生成 dedup fix：`_already_sent` 認 skipped / generate 前查當日已有 row | 9/4 全日生成 ≤5 條（而家 29）|
| T0.2 | im_delivery_prefs slots key 對齊 greeting keys（lateNight 缺失）| 23:00 深夜 briefing 收到 |
| T0.3 | WhatsApp fallback 鏈路診斷（sent=0 + 213 條冇 reason skip）| WhatsApp 至少 1 次成功 or 明確停用 |

### Phase 1 — 分類重構 4→6
| Ticket | 內容 | 驗收 |
|---|---|---|
| T1.1 | MODULE_CATEGORY v3（6 類歸屬表）+ MODULE_PRIORITY dict | dict 單元測試過 |
| T1.2 | prompt 骨架更新：6 分類固定 section + 空內容規則 + cancel event 指示 | 生成內容 6 類結構穩定 |
| T1.3 | Canceled events source 層 filter（唔再照出）| 9/4 briefing 冇「Canceled:」行 |
| T1.4 | push 順序/header 更新（6 類 label）| 收 6 條分類 message |

### Phase 2 — P 級分層 + 摺疊（系統層）
| Ticket | 內容 | 驗收 |
|---|---|---|
| T2.1 | source function 計 item P 級（formula 上表）入 payload | payload 每 item 有 p_level |
| T2.2 | 待辦/項目分層顯示 prompt 範本（🔴🟡⚪）| 輸出跟範本 |
| T2.3 | payload 層 pre-collapse（上限 +「+X 項」）| 長 module 自動截 |
| T2.4 | traffic 出門前時段 logic | 非出門時段唔出交通 |

### Phase 3 — Event-triggered P0 pipeline（最大工程，獨立排期）
| Ticket | 內容 | 驗收 |
|---|---|---|
| T3.1 | calendar change detection（sync 後 diff：新增/取消/改期）| 改期 5 分鐘內觸發 |
| T3.2 | P0 即時 push（bypass 15min cron）| 衝突/取消即時通知 |
| T3.3 | task due / 新增 overdue detection | 到期日 05:00 前收到 |

---

## 四、Grill — 決定記錄（2026-09-04 已答）

**G1：分類數 → ✅ 6 類**（🔔通知 / ⏰提醒 / 📅行程 / 📋待辦項目 / 📰資訊 / 📖靈修）
**G2：傍晚內容 → ✅ 保留收工回顧**（Tasks Summary 精簡版 + 今日完成 + 聽日預告；天氣/新聞/靈修唔重複）
**G3：Message 數 → ✅ 減到 5 條**（📅行程 + 📋待辦/項目 合併一條 push；生成骨架仍 6 類）
**G4：DB 預存共用內容 → ❌ 唔做**（2026-09-04 用戶決定：直接每用戶生成，唔加 tenant 共用 cache 層）
**G5：今期範圍 → ✅ Phase 0-2 先，Phase 3 另排期**

---

## 四A. G4 — 「先儲存到數據庫，共用項目減少 AI token」開發建議

### 用戶原話
> 「可否先儲存到數據庫？因為有些項目是可以和其他用戶共用的，減少AI token」

### 背景數據（點解合理）
- 現行每 slot 每用戶一次 full LLM call：8 月 1,057 條生成（~34 條/日，正常應 4 條/日/用戶）
- Tenant 有 12 個 members scanned，有 CRM data 嘅先 generate — 多用戶場景下，**news / project_status / team_updates / weather 呢類 tenant 共用內容，每個用戶都重新 fetch + 重新生成一次** = 重複 token
- 新聞 RSS fetch + LLM 格式化（2-5 條×3 子類）— 全日 4 slots 內容一樣但 regenerate 4 次（§0 已知問題 #8）

### 建議理解（待你確認）
將 briefing 內容分兩層：
1. **Tenant 共用層（DB cache）**：news_industry / project_status / team_updates / weather / traffic / bible 進度 — 呢啲內容同一 tenant 所有用戶睇到嘅係一樣（projects 係共用 CRM 數據）
2. **User 專屬層（每用戶生成）**：today_tasks / meetings / overdue_followup / personal_reminders — 每個用戶唔同

**機制：**
- 共用層每日第一次生成（例如 04:30 morning slot 或獨立預生成 job）→ **格式化結果存 DB**（新表 `briefing_shared_cache`）
- 之後任何用戶任何 slot 生成時：共用內容由 DB 直接讀取**已格式化文字**嵌入 prompt（LLM 唔使再生產），LLM 只負責 user 專屬部分 + 整合
- 新聞全日只 fetch + 格式化 1 次（而家 4 次）

**Token 效益估算（tenant 12 members 計）：**
| 場景 | 現行 | 之後 |
|---|---|---|
| 共用內容 LLM 生成 | 每用戶×每 slot | 每日 1 次 |
| 新聞 fetch | 每用戶×每 slot | 每日 1 次 |
| User 專屬生成 | 照舊 | 照舊（但 dedup fix 後正常 4 次/日）|

### 要你決定嘅子問題
- **G4a：共用內容係咪 tenant-wide？**（即 tenant 任何 briefing 用戶都 share 同一份 news/projects 格式化文字）→ Rec: 係，tenant_id 做 key
- **G4b：共用內容幾時預生成？** → Rec: 每日 04:30 一個 job 預生成全日共用塊（唔跟 slot）
- **G4c：共用塊失效條件？** → Rec: 新聞/projects 每日過期（briefing_date 做 key）；突發改動（如 calendar 大變）下一 slot 自動 refresh 共用塊

---

## 五、現行系統對照 Reference（AI 優化時用）

- `briefing_generator.py:40-122` — SLOT_PROMPTS / SYSTEM_PROMPT / MODULE_TAGS / MODULE_CATEGORY
- `briefing_generator.py:278-448` — _build_prompt（單一 call 核心）
- `briefing_scheduler.py:137-169` — _is_due / _already_sent（dedup bug 所在）
- `briefing_scheduler.py:310-395` — _push_telegram 分類分拆 push
- `briefing_scheduler.py:59-64` — SLOT_MAP（greeting key → slot key）
- `briefing_sources.py` — 20 個 source functions
- 真實數據：`docs/briefing-system-export-2026-09-03.md` §0（重複生成 29 條/日、push 統計）

---

*待 Grill 共識後 → 寫 SPEC.md（禁 code）→ 垂直切片 tickets → TDD 實作*
