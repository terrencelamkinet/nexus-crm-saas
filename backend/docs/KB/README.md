# 📚 G08 NEXUS CRM — Knowledge Base (KB)

> **用途:** 記錄所有已知問題嘅成因、解決方法、解決過程、問題 log 同成功 log。
> **對象:** 人類工程師 + AI agent 都要睇得明。
> **規則:** 每次解決一個新問題,必須加一條 entry。遇到疑似重複問題,先查呢度。

---

## 📖 點樣用呢個 KB

### 人類工程師
- 遇到問題 → 睇 `INDEX.md` 或搜尋 `grep -ri "<症狀關鍵字>" docs/KB/`
- 每條 entry 有:症狀 → 成因 → 修復 → 驗證 → 預防

### AI Agent
- 每次 debug 前:讀 `INDEX.md`,用 `search_files` 搜尋 `docs/KB/` 匹配 symptoms
- 匹配到 → 直接參考 entry 嘅 diagnostic protocol,唔好重新診斷
- 解決新問題後:必須寫一條新 entry (跟 TEMPLATE)

### 快速診斷手冊 (Quick Reference)
| 症狀 | 可能成因 | Entry |
|------|---------|-------|
| Bot 收唔到/唔回覆訊息,零 error | dedup watermark 污染 / test ping | [KB-001](./KB-001-telegram-inbound-silent-drop.md) |
| Journal 顯示 `SELECT → ROLLBACK` 冇下文 | dedup early-return (watermark 高過 update_id) | [KB-001](./KB-001-telegram-inbound-silent-drop.md) |
| AI 有回覆但用戶收唔到 | sendMessage timeout 無 retry | [KB-001](./KB-001-telegram-inbound-silent-drop.md) §5 |
| AI chat send 鍵跌落輸入框下面 | `.send-btn-hitarea` padding/margin 衝突 | [KB-002](./KB-002-ai-chat-panel-send-key-scroll.md) |
| 打字時背景 page scroll / panel 開住照 scroll | ChatboxPanel 冇 body scroll lock | [KB-002](./KB-002-ai-chat-panel-send-key-scroll.md) |
| Widget save 咗 reload 唔見 / 每次 load 重複寫入 | loadAll setOrder 觸發 save effect (stale revert race) | [KB-003](./KB-003-dashboard-widget-save-race.md) |
| Widget resize 後 reload width/height fallback | resize-grip 只改 DOM 冇 commit state/save | [KB-004](./KB-004-dashboard-widget-resize-fallback.md) |
| IM AI 回「確認」冇反應、無限重複草稿 | tenant 冇 ai allow_edit / 冇 workspace | [KB-005](./KB-005-tenant-ai-write-flow-infra.md) |
| AI 草稿 confirm 時 500 tasks_workspace_id_fkey | tenant 冇 workspace → sentinel 全零 | [KB-005](./KB-005-tenant-ai-write-flow-infra.md) |

---

## 📑 Entry 索引

| ID | 日期 | 標題 | Severity | 系統 |
|----|------|------|----------|------|
| [KB-001](./KB-001-telegram-inbound-silent-drop.md) | 2026-08-06 | Telegram inbound 靜默丟失訊息 (watermark 污染) | 🔴 Critical | backend |
| [KB-002](./KB-002-ai-chat-panel-send-key-scroll.md) | 2026-08-07 | AI chat panel: send 鍵走位 + 打字時背景 scroll | 🟠 High | frontend |
| [KB-003](./KB-003-dashboard-widget-save-race.md) | 2026-08-07 | Dashboard widget save: load 重複寫入 + stale GET 靜默 revert | 🟠 High | frontend |
| [KB-004](./KB-004-dashboard-widget-resize-fallback.md) | 2026-08-07 | Dashboard widget resize: width/height 只改 DOM 唔 save, reload fallback | 🟠 High | frontend |
| [KB-005](./KB-005-tenant-ai-write-flow-infra.md) | 2026-08-22 | 新 tenant AI write flow 壞：AI 只出草稿、回「確認」無限循環 | 🔴 Critical | backend |

---

## ➕ 加新 Entry 嘅 Template

```markdown
# KB-XXX — <簡短標題>

## 📅 日期 / 🔴 Severity / 📍 系統
## 1. 症狀 (Symptom) — 用戶見到咩 / 系統表現
## 2. 問題 log (Error Log) — 實際 log 摘錄
## 3. 成因 (Root Cause) — 根本原因,唔好只寫表面
## 4. 解決過程 (Debug Process) — 點樣搵到,每一步
## 5. 解決方法 (Fix) — 具體修復步驟 / patch
## 6. 成功 log (Success Log) — 修復後嘅正常 log
## 7. 驗證 (Verification) — 點確認真係修好
## 8. 預防 (Prevention) — 點避免再犯
## 9. 相關檔案 (Files Affected)
```

---

## 🔗 相關資源
- `backend/app/services/telegram_inbound.py` — webhook/queue consumer 核心邏輯
- `backend/app/routers/telegram.py` — webhook endpoint
- `backend/app/services/telegram_service.py` — Telegram API client (sendMessage retry)
- `/tmp/telegram_webhook.log` — webhook 收到嘅 update 記錄
- `journalctl -u nexus-crm.service` — backend 完整 log
- Skill: `debug-system` (D035 有同步記錄)
