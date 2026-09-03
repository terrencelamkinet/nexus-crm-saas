# T0.3 WhatsApp 靜默失敗診斷報告（2026-09-04）

## 診斷結果

### 鏈路狀態
| 層 | 狀態 | 證據 |
|---|---|---|
| WhatsApp mapping | ✅ active | `nexus_whatsapp_mappings` row: wa_id +852****5371, status=active |
| ai_channel_credentials | ⚠️ 冇 whatsapp row | 只有 telegram credential（103 chars token）— 但 `_push_whatsapp` 用 mapping.wa_id 直 send，唔需要 credential store |
| Prefs gate | ✅ 正常 | whatsapp: morning/afternoon=true, evening=false, lateNight=false |
| 實際 send | ❌ 歷史 sent=0 | 8/28 起 push_log whatsapp sent = 0 |

### Root cause（WhatsApp sent=0 三層原因）
1. **Fallback-only 設計**：`_push_whatsapp` 只喺 Telegram gate skip 後先試。Telegram 全日正常（morning/noon sent 11 次）→ WhatsApp 根本冇機會觸發
2. **Gate 同步 skip**：Telegram 被擋嘅情況（evening slot_off / quiet_hours）→ WhatsApp 用同一 prefs gate → 一樣 skip。唔係「靜默失敗」，係「gate 正確擋住」
3. **Duplicate log 製造假象**：run_scheduler 外層每 tick 額外寫一條 `channel="whatsapp" status="skipped" error="no_channel"`（reason 空）→ 213 條「冇 reason skip」其實係外層 duplicate，唔係 WhatsApp 真實嘗試

### Fix（v7.32）
- PushLog 責任統一：`_push_telegram` / `_push_whatsapp` 內部寫晒所有 outcome（gate skip 有 reason、send 有 error、exception 有 error）
- run_scheduler 外層 + bible path 刪走 duplicate PushLog → 每 tick 每 channel ≤1 條
- 補：telegram no_mapping / no_token path 都有 log（之前靜默）

### 結論
WhatsApp 鏈路本身冇壞 — mapping active + gate 正常。佢冇 send 過係因為：
- 佢係 Telegram 嘅 **fallback**（唔係 parallel push），Telegram 成功率高 → 好少 fallback
- Fallback 觸發時（深夜等）gate 通常都擋

**建議（用戶決定）：**
- A. 維持 fallback-only（現狀）— WhatsApp 只喺 Telegram 死先收
- B. 改 parallel push — 每 slot Telegram + WhatsApp 都收（用戶 prefs evening=false 已表示唔想 WhatsApp 收傍晚 → 可能唔想要）
- C. 明確停用 WhatsApp briefing channel — 用戶 prefs 已經 evening/lateNight=false，若 morning/noon 都唔想收就全 false

## 驗證
- [x] 15 pytest PASS（含 T0.1/T0.2 regression）
- [x] push_log 每 tick 每 channel ≤1 條（code review：外層 duplicate 已刪）
- [x] Syntax OK
