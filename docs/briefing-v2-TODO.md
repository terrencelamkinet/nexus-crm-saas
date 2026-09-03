# TODO — CRM AI Briefing v2（Phase 0-2）

> **來源：** `docs/briefing-v2-SPEC.md`（2026-09-04）
> **規則：** 每個 ticket 垂直切片（用戶可見功能），完成即 demo。做一個 tick 一個。
> **狀態追蹤：** 完成 → 打勾 + 更新本檔

---

## Phase 0 — 地基修復

### Ticket T0.1: 停止重複生成（每 slot 每日只 generate+push 一次）

**Blocked by:** —

**目標：** 用戶唔再為同一 briefing 燒多次 LLM call；被 gate 擋（quiet hours / slot off / weekend）嘅 slot 都計入已處理，唔會觸發下一個 15-min tick regenerate

**驗收標準：**
- [ ] 同一 slot + 同一 briefing_date：第一次處理後（無論 sent / skipped / failed）記低，之後 tick skip
- [ ] 9/5 全日 generated_briefings：每 slot ≤1 條（morning/noon/evening/night；manual run 除外）
- [ ] push_log 冇「同一 slot 同一日 >1 次 sent」
- [ ] regression test：連續 8 個 mock tick → 只有第 1 個 generate

**涉及檔案：** `backend/app/services/briefing_scheduler.py`

**完成即可：** 睇 9/5 push_log + generated_briefings count

---

### Ticket T0.2: Channel prefs slot key 對齊

**Blocked by:** —

**目標：** im_delivery_prefs 嘅 slots key 同 greeting_slots key 一致，深夜 slot 唔再因為 key 對唔上而錯誤 slot_off

**驗收標準：**
- [ ] 每個用戶 prefs slots 包含佢 greeting_slots 所有 key（深夜 key 缺失 → migration 補，值跟 channel enabled）
- [ ] 深夜 23:00 喺靜音窗內（22:00-04:30）→ push_log 1 條 skipped(quiet_hours)，唔係 slot_off，亦冇 regenerate
- [ ] 現有 prefs 數據 migration 後冇遺失 enabled/slots/weekend_mute/quiet_hours 設定

**涉及檔案：** migration + `briefing_scheduler.py` gate

**完成即可：** 9/5 23:00 睇 push_log reason = quiet_hours（而家係 slot_off × 重複）

---

### Ticket T0.3: WhatsApp 靜默失敗診斷

**Blocked by:** —

**目標：** 搵出 WhatsApp 全部 skipped 冇 reason 嘅原因；能修就修，唔能修就明確停用（寫清楚 reason），唔可以靜默

**驗收標準：**
- [ ] 診斷報告：WhatsApp mapping / credential / gate 邊層斷
- [ ] push_log 每 tick 每 channel ≤1 條記錄（而家 WhatsApp 每 tick 2 條 — 一條內部 + 一條外層）
- [ ] 修復後 WhatsApp 至少 1 次真實 sent；或者用戶確認停用 WhatsApp briefing channel

**涉及檔案：** `briefing_scheduler.py`（_push_whatsapp + run_scheduler 記錄邏輯）

**完成即可：** 睇 push_log 冇 duplicate + 診斷報告

---

## Phase 1 — 分類重構 4→6

### Ticket T1.1: 6 類歸屬表 + Default P 級（MODULE_CATEGORY v3 + MODULE_PRIORITY）

**Blocked by:** —

**目標：** Module 歸屬由現行 4 類改為 SPEC §Solution 嘅 6 類表；每 module 有 default P 級

**驗收標準：**
- [ ] 每個 module 有歸屬分類，冇 module 重複歸兩類
- [ ] 每個 module 有 default P 級（bible 除外）
- [ ] 單元測試 cover 歸屬表完整性

**涉及檔案：** `briefing_generator.py`

**完成即可：** 單元測試綠燈

---

### Ticket T1.2: Canceled events 標示（唔再當正常行程）

**Blocked by:** T1.1

**目標：** 取消咗嘅行程喺 briefing 顯示「已取消」標記 + 原時間，唔可以同正常行程平排當有效

**驗收標準：**
- [ ] Source 層 filter：canceled event 帶 status=canceled 入 payload
- [ ] 生成指示：已取消行程顯示「已取消」+ 原時間，排正常行程後面
- [ ] 9/5 冇「Canceled: xxx」當正常行程照出（9/3 樣本嘅 bug）

**涉及檔案：** `briefing_sources.py`（meetings）+ `briefing_generator.py`（prompt 指示）

**完成即可：** manual run briefing，內容見到已取消標記格式正確

---

### Ticket T1.3: 收工回顧格式（evening Tasks Summary 精簡版）

**Blocked by:** T1.1

**目標：** Evening briefing 保留收工回顧：✅今日完成 + 🔴 優先未完 + 聽日預告；天氣/新聞/靈修唔喺傍晚重複

**驗收標準：**
- [ ] Evening content 有「今日完成」section（有完成 task 先出）
- [ ] Evening content 有 🔴 優先（未完/逾期）精簡版
- [ ] Evening content 有聽日預告（聽日行程/到期）
- [ ] 天氣/新聞/靈修冇喺 evening content 出現
- [ ] Tasks Summary 完整版（🔴📌⚪💭）淨係 morning 出

**涉及檔案：** `briefing_generator.py`（prompt 骨架 slot 差異）

**完成即可：** manual run evening slot，內容符合 matrix

---

### Ticket T1.4: Push 5 條 message（📅+📋 合併 + slot × 分類 matrix）

**Blocked by:** T1.1

**目標：** 晨早收 5 條獨立 message（🔔 / ⏰ / 📅📋 / 📰 / 📖）；行程同待辦合併一條；空分類唔出空 message；時段 matrix 生效

**驗收標準：**
- [ ] Morning push：5 條 message（有內容嘅類別），header 正確（📅📋 用「行程與待辦」）
- [ ] 行程 + 待辦合併一條，內部以 module tag / 分隔線分開
- [ ] 空內容類別 → 唔出 message
- [ ] Evening push：通知（新變化）+ 📅📋 收工回顧 兩條為主；冇 📰 / 📖
- [ ] Noon push：輕量（提醒 + 行程待辦餘下）
- [ ] Night push：聽日預告精簡（若靜音窗內 → skipped 記錄，唔 push）

**涉及檔案：** `briefing_scheduler.py`（_push_telegram categories 順序 + 合併）+ `briefing_generator.py`（categories 組裝）

**完成即可：** manual push 晨早時段，Telegram 收到 5 條正確 message

---

## Phase 2 — P 級分層 + 摺疊

### Ticket T2.1: P 級規則計 + 📋 分層顯示（🔴🟡⚪）

**Blocked by:** T1.4

**目標：** Task/project/invoice 嘅 P 級由 source function 按規則計（唔靠 LLM），📋 待辦/項目 message 按 P 級分層顯示

**驗收標準：**
- [ ] Payload 每個 task/project/deal item 有 p_level（規則：task overdue>7→P0、overdue≤7 或今日→P1、有 deadline→P2、冇日期→P3；project overdue>90→P3 其餘 P2；invoice 到期≤3 日→P0）
- [ ] 📋 message 格式：🔴 P0-P1 全列 → 🟡 P2 摺疊（冇變化）→ ⚪ P3 壓縮一行
- [ ] P 級邊界單元測試（0/7/90 日）
- [ ] 冇 P0/P1 時，🔴 section 唔出現（唔出空 header）

**涉及檔案：** `briefing_sources.py`（P 級計）+ `briefing_generator.py`（分層格式指示）

**完成即可：** manual run，📋 message 見到 🔴🟡⚪ 結構

---

### Ticket T2.2: Traffic 出門時段 logic + 長內容摺疊上限

**Blocked by:** T2.1

**目標：** 交通只喺出門前時段出（唔全日重複）；各分類內容超上限自動摺疊（📅 5 條+「+X 個」、📋 P0-P1 ≤8 條、📰 每子類 2-5 條）

**驗收標準：**
- [ ] 非出門時段（morning 後 / evening 回程後）→ 交通 module 唔出
- [ ] 行程 >5 條 → 顯示 5 條 +「+X 個」
- [ ] 📰 每子類 >5 條 → 截到 5 條
- [ ] 摺疊邏輯喺 payload 層做（數據先截，唔靠 LLM 自律）

**涉及檔案：** `briefing_sources.py`（traffic 時段 + 上限參數）+ `briefing_generator.py`（payload 組裝）

**完成即可：** manual run 睇長 list 摺疊 + 非出門時段冇交通

---

### Ticket T2.3: Task 跨 module 去重

**Blocked by:** T2.1

**目標：** 同一 task/event 唔可以喺兩個分類重複出現（9/3 樣本：返還圖書喺「跟進」+「任務」各出一次）

**驗收標準：**
- [ ] Source 層以 entity id 去重：overdue_followup 同 today_tasks 重疊嘅 task 只喺其歸屬分類出現一次
- [ ] 去重優先次序定義：task 歸 today_tasks（📋），overdue_followup 淨係報「冇喺 today_tasks 出現」嘅逾期 contact
- [ ] 9/5 briefing 冇同一 task 出現兩次

**涉及檔案：** `briefing_sources.py`（overdue_followup + today_tasks）

**完成即可：** manual run 睇內容冇重複 entity

---

## 執行順序建議

T0.1 → T0.2 → T0.3 → T1.1 → T1.2 → T1.3 → T1.4 → T2.1 → T2.2 → T2.3

（Phase 0 全做完先入 Phase 1 — 地基穩先起樓；T1.2/T1.3 喺 T1.1 後可並行）
