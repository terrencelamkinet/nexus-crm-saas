# SPEC — CRM AI Briefing v2（6 類骨架 + P 級分層 + 地基修復）

> **日期：** 2026-09-04
> **狀態：** Grill 完成（G1-G5 已答）→ Spec 固化
> **對照文件：** `docs/briefing-v2-dev-proposal-2026-09-03.md`（§四 決定記錄）
> **本文件禁 code** — 只講業務邏輯。技術實作參考 `docs/briefing-system-export-2026-09-03.md`

---

## Problem Statement（用戶角度）

1. **Message 大雜燴**：而家所有 module 內容塞入固定 4 段格式，module 開少咗就出空泛句填位，開多咗就一條 message 爆長
2. **分類歸屬唔合理**：項目狀態（project_status）、交通（traffic）屬於「提醒」；用戶期望行程歸行程、待辦歸待辦
3. **取消咗嘅行程照出街**：9/3 briefing 出現「Canceled: HPE Appreciation Dinner」當正常行程顯示
4. **待辦/項目冇分層**：逾期 13 日嘅圖書同冇日期嘅「買拖板」flat list 一齊，睇唔出輕重
5. **收工 briefing 唔穩定**：18:00 時段試過完全收唔到（prefs bug），用戶要求嘅「今日回顧」內容間中缺失
6. **系統燒 token**：同一 slot 每 15 分鐘 regenerate（9/3 全日 29 條生成，正常 4 條）；新聞每 slot 每用戶重新 fetch + 重新生成
7. **深夜 briefing 永遠收唔到**：23:00 lateNight slot 因 channel prefs 用咗舊 key 對唔上，一直 slot_off

---

## Solution（用戶會得到咩）

### 分類骨架：固定 6 類（生成層），5 條 push message

LLM 生成時內容分 6 個固定 section，**唔受用戶 module 開關影響**（module 只影響該 section 有幾多內容）：

```
🔔 通知     — 衝突、逾期跟進（事件性，有先出）
⏰ 提醒     — 天氣、個人提醒、發票/報價到期（行動導向）
📅 行程     — 會議、交通（今日要做/要去）
📋 待辦/項目 — 今日任務、項目狀態、商機（按 P 級分層）
📰 資訊     — 新聞、團隊更新（純資訊，晨早一次）
📖 靈修     — 讀經進度（晨早一次，固定格式）
```

**Push 時 📅 行程 + 📋 待辦/項目 合併一條 message**（用戶 G3：減到 5 條），header 用「📅📋 行程與待辦」，內部以 module tag 分開顯示。其餘 4 類各自一條。

**空內容規則：** section 喺生成骨架永遠存在（LLM 知道有呢個位），但內容空 → push 時唔出嗰條 message（唔留空殼 header）。

### Module 歸屬（v2 修訂，取代現行 MODULE_CATEGORY）

| Module | 分類 | Default P |
|---|---|---|
| calendar_conflicts | 🔔 通知 | P0 |
| overdue_followup | 🔔 通知 | P1 |
| unread_messages | 🔔 通知 | P1 |
| customer_sentiment | 🔔 通知 | P2 |
| weather | ⏰ 提醒 | P2 |
| personal_reminders | ⏰ 提醒 | P2 |
| quote/invoice/expense | ⏰ 提醒 | P1（到期前 3 日 P0）|
| email_draft_review | ⏰ 提醒 | P2 |
| birthday_reminders | ⏰ 提醒 | P3 |
| meetings | 📅 行程 | P1 |
| calendar changes（取消/改期）| 📅 行程 | P0（顯示喺原行程旁，唔另起條目）|
| traffic_commute | 📅 行程 | P2（出門時段先出）|
| today_tasks | 📋 待辦/項目 | P1 |
| project_status | 📋 待辦/項目 | P2（逾期 >90 日 P3）|
| stale_deals / hot_leads / sales_kpi | 📋 待辦/項目 | P2 |
| team_updates | 📰 資訊 | P3 |
| news_industry | 📰 資訊 | P3 |
| bible_reading | 📖 靈修 | — |

### P 級分層顯示（📋 待辦/項目）

- **🔴 P0-P1**：全數列出（逾期 / 今日到期，需要行動）
- **🟡 P2**：冇變化就摺疊成一行摘要（「5 個項目維持逾期狀態，無新進展」）
- **⚪ P3**：壓縮成一行（無日期任務）

P 級由 **source function 規則計**（deadline/逾期日數），唔由 LLM 判斷。

### 各時段推送內容（slot × 分類 matrix）

| Slot | 🔔通知 | ⏰提醒 | 📅📋行程待辦 | 📰資訊 | 📖靈修 |
|---|---|---|---|---|---|
| morning 05:00 | ✅ 有先出 | ✅ | ✅ 全日+聽日 | ✅ | ✅ |
| noon 12:00 | — | ✅ 輕量 | ✅ 餘下 | — | — |
| evening 18:00 | ✅ 新變化先出 | — | ✅ **收工回顧**（今日完成 + 🔴優先 + 聽日預告）| — | — |
| night 23:00 | — | — | ✅ 聽日預告精簡 | — | — |

**收工回顧（G2）：** evening 保留 Tasks Summary 精簡版 — ✅今日完成 + 🔴 優先（未完/逾期）+ 聽日預告。天氣/新聞/靈修唔重複發送。

### 地基修復（Phase 0）

1. **重複生成停止**：一個 slot 喺同一 briefing_date 只 generate + push 一次。被 gate 擋（quiet hours / slot off / weekend mute）嘅 slot 都計入「已處理」— 唔可以令下一個 15-min tick 再燒一次 LLM call
2. **Channel prefs slot key 對齊**：im_delivery_prefs 嘅 slots key 同 greeting_slots key 一致（深夜 key 缺失要補）
3. **WhatsApp 靜默失敗診斷**：搵出 WhatsApp 全部 skipped 冇 reason 嘅原因；send 唔到就要明確停用，唔可以靜默

---

## User Stories

- As a 用戶, I want 每類內容一條獨立 message, so that 我可以跳讀/刪除唔想睇嘅類別
- As a 用戶, I want 行程同待辦一齊顯示, so that 我 morning 睇一條就知今日要做咩
- As a 用戶, I want 項目唔再喺「提醒」出現, so that 分類符合我嘅心智模型
- As a 用戶, I want 逾期任務/項目同普通任務分層, so that 我一眼睇到邊啲要即刻處理
- As a 用戶, I want 取消咗嘅行程標示「已取消」, so that 我唔會白去
- As a 用戶, I want 傍晚收到今日回顧+聽日預告, so that 收工前知道有咩未完
- As a 用戶, I want 同一 briefing 唔會重複生成, so that 系統唔浪費 token
- As a 用戶, I want 新聞/團隊更新只喺晨早出現, so that 傍晚唔會收到重複資訊
- As a 用戶, I want 深夜 briefing 正常收到（如果開啟）, so that slot 設定同實際推送一致
- As a 用戶, I want 靈修內容格式唔變, so that 每日讀經習慣唔受影響

---

## Edge Cases Handling

- **Module 全關 / 全開**：6 類骨架固定；全開 → 各 section 有內容上限（📅 5 條+「+X 個」、📋 P0-P1 ≤8 條、📰 每子類 2-5 條）；全關 → 全部唔 push，唔出空 header
- **某分類所有 module 都俾用戶關閉**：該分類 message 唔生成（骨架喺 prompt 但內容空 → skip）
- **Canceled event**：顯示「已取消」標記並附原時間，唔可以當正常行程；若同日有替代行程，取消嗰條排後面
- **Traffic 非出門時段**：唔出交通 module（唔好全日重複報同一段路）
- **Weekend**：weekend_mute 生效時成個 slot 唔 push（現行行為保留）
- **Quiet hours（22:00-04:30）**：night 23:00 如果喺用戶靜音窗內 → 唔 push 但計入已處理（唔好 regenerate）；morning 05:00 豁免
- **同一 task 喺兩個 module 都出現**（overdue_followup + today_tasks）：系統層去重 — 同一 entity 只喺其歸屬分類出現一次
- **LLM 生成失敗/空內容**：記 skipped + 已處理（唔好下個 tick 重試無限燒）
- **Push 部分成功**（4 條 message 中 2 條成功）：已成功嘅唔重發；下 tick 唔好因為「未齊」而 regenerate

---

## 驗收標準（Acceptance Criteria）

- [ ] 9/5 全日 generated_briefings 每 slot ≤1 條（morning/noon/evening/night 各 1 = 全日 ≤4，唔計 manual run）
- [ ] 9/5 收工 briefing 收到：今日完成 + 🔴 優先未完 + 聽日預告
- [ ] 晨早收到 5 條獨立 message（通知/提醒/行程與待辦/資訊/靈修），冇內容嘅類別唔出空 message
- [ ] 行程同待辦喺同一條 message，內部有清晰分隔
- [ ] 9/5 briefing 冇「Canceled:」當正常行程顯示（取消咗會標「已取消」）
- [ ] 📋 待辦/項目 message 見到 🔴/🟡/⚪ 分層（有逾期任務時 🔴 全列，冇變化項目 🟡 摺疊）
- [ ] 深夜 23:00 slot：若用戶靜音窗內 → push_log 有一條 skipped(quiet_hours) 記錄 + 唔再每 15 分鐘重複
- [ ] 新聞/團隊更新冇喺傍晚 briefing 重複出現
- [ ] push_log 每 tick 每 channel 最多 1 條記錄（而家 WhatsApp 每 tick 2 條）
- [ ] WhatsApp：診斷報告寫明原因（成功 / 明確停用 / 修復），唔再有無 reason 靜默 skip
- [ ] 靈修格式同而家一致（🙏⛪📖💡⏳ + 讀經連結 + worship + ❤️）

---

## 涉及範圍

**In scope（今期 Phase 0-2）：**
- briefing_scheduler：dedup / gate 順序 / push log 記錄
- briefing_generator：MODULE_CATEGORY v3（6 類歸屬）+ MODULE_PRIORITY + prompt 骨架 + 收工回顧格式
- briefing_sources：P 級規則計、cancel event filter、traffic 時段 logic、task 去重
- im_delivery_prefs：slot key 對齊 migration
- WhatsApp 鏈路診斷

**Out of scope（明確唔做）：**
- Phase 3：Event-triggered P0 即時推送 pipeline（另排期）
- G4：DB cache / tenant 共用內容層（用戶已決定唔做）
- 靈修內容本身嘅改動（格式不變）
- Dashboard briefing 顯示（AI App 前端）

---

## 測試策略

- **Scheduler dedup**：mock 15-min tick 連續 8 次 → 只有第 1 次 generate + push，其餘 skipped(already_processed)
- **Gate-skip 計入已處理**：quiet hours 內 due → push_log 1 條 skipped，無 regenerate
- **分類歸屬**：MODULE_CATEGORY v3 單元測試（每 module 有歸屬、無 module 重複歸兩類）
- **P 級 formula**：overdue 日數邊界測試（0/7/90 日）
- **Cancel filter**：canceled event 輸入 → 輸出帶「已取消」標記
- **5 條 message 結構**：integration test 驗證 categories 輸出 key 集合 + push 合併邏輯
- **E2E（9/5 真實 cron）**：驗收標準頭 3 條

---

*Spec 完成 — 下一步：垂直切片 tickets（TODO.md），拆完問用戶由邊張開始*
