# KB-001 — Telegram Inbound 靜默丟失訊息 (Dedup Watermark 污染)

## 📅 日期 / 🔴 Severity / 📍 系統
- **日期:** 2026-08-06
- **Severity:** 🔴 Critical — 用戶訊息靜默消失,零 error,用戶以為 bot 死咗
- **系統:** G08 NEXUS CRM backend (`nexus-crm.service` systemd)
- **Bot:** ainexuscrmBot (chat_id=7380833889)

---

## 1. 症狀 (Symptom)

- 用戶 send 訊息俾 bot → 完全冇回覆,亦冇任何 error 顯示
- `getWebhookInfo` 顯示 `pending_update_count=0`、冇 `last_error`、URL 正確 → **Telegram 側 100% 健康**
- `/tmp/telegram_webhook.log` 顯示用戶 update **有到達 server**
- 但 `journalctl -u nexus-crm.service` 顯示 update 處理到一半就停:
  ```
  POST /api/v1/telegram/webhook HTTP/1.1" 200 OK
  SELECT ... FROM nexus_telegram_mappings ...
  SELECT set_config('app.tenant_id', ...), set_config('app.user_id', ...)
  ROLLBACK          ← 之後就冇晒,冇 AI call,冇 INSERT,冇 sendMessage
  ```
- `nexus_telegram_mappings.config->>'tg_last_webhook_update_id'` **高過** webhook log 入面最後一條真實 update_id

**Signature:** 「POST 200 → SELECT mapping → set_config → ROLLBACK,冇下文」= dedup early-return (被當重複丟棄)

---

## 2. 問題 log (Error Log) — 實際摘錄

### Webhook log (`/tmp/telegram_webhook.log`)
```
[2026-08-06T15:55:50.720659] update_id=999999998   ← Telegram test ping (setWebhook 時)
[2026-08-06T18:07:33.298452] update_id=392261539   ← 用戶 "Te"
[2026-08-06T18:08:09.144259] update_id=392261541   ← 用戶 "Ghost" (最後成功處理)
[2026-08-06T18:17:29.920426] update_id=392261542   ← 用戶 → 被 drop
[2026-08-06T18:26:48]         update_id=392261543   ← 用戶 → 被 drop
[2026-08-06T18:31:00]         update_id=392261546   ← 用戶 → 被 drop
[2026-08-06T18:40:10]         update_id=392261548   ← 用戶 → 被 drop
```

### Journal (`journalctl -u nexus-crm.service`) — 被 drop 嘅 update
```
Aug 06 18:26:48 python[881873]: INFO: 91.108.5.1:0 - "POST /api/v1/telegram/webhook HTTP/1.1" 200 OK
Aug 06 18:26:48 sqlalchemy.engine.Engine BEGIN (implicit)
Aug 06 18:26:48 sqlalchemy.engine.Engine SELECT nexus_crm.nexus_telegram_mappings.id, ... 
Aug 06 18:26:48 sqlalchemy.engine.Engine SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)
Aug 06 18:26:48 sqlalchemy.engine.Engine ROLLBACK     ← dedup early-return,冇 commit
```

### getWebhookInfo (Telegram 側 — 一切正常,誤導!)
```json
{"url": "https://nexus-crm-api.kinet-poc.com/api/v1/telegram/webhook",
 "pending_update_count": 0, "max_connections": 40, "allowed_updates": ["message", "edited_message"]}
```

---

## 3. 成因 (Root Cause)

### 核心機制
`handle_webhook_update()` 用 **monotonic watermark** (`mapping.config.tg_last_webhook_update_id`) 做 dedup:
```
if update_id <= watermark:  return  # 當重複,靜默丟棄
```

呢個設計有兩個致命弱點:

**弱點 A — Telegram test ping 污染 (15:55 開始):**
- Telegram 註冊 webhook 時會 send `update_id=999999998` 假 ping
- 舊 code 將佢寫入 watermark → watermark 變成 9 億+
- 之後所有真實 update (1e6–4e8 範圍) 全部 `<= 999999998` → **全部被當重複丟棄**
- ✅ 已修:加 guard `if update_id >= 900_000_000: return` (test ping 永唔寫入 watermark)

**弱點 B — 人為測試污染 + reset race (18:23–18:27):**
- Debug 時用假 update_id (392261551, 392261560) POST 測試 → watermark 被推高
- Reset watermark 落 392261541 之後,**背景仲有個 in-flight update (tunnel_test) 未 commit**,佢嘅 `handle_webhook_update` 幾秒後 commit 返 `392261560` → 覆蓋咗 reset
- 真實用戶 update (392261543/544/545) 到達 → `<= 392261560` → 全部被 drop

**根本問題:** 單調遞增 watermark 假設 update_id 永遠順序到達,但 Telegram 係 at-least-once delivery (有 retry/reorder),任何一個較高 id 嘅 update 都會令之後嘅低 id update 永久丟失。

---

## 4. 解決過程 (Debug Process)

1. **確認 Telegram 側健康:** `getWebhookInfo` → pending=0、無 error → 排除 delivery 問題
2. **確認 update 有到達:** `/tmp/telegram_webhook.log` → 用戶 update 有記錄 → 排除 tunnel 問題
3. **搵到 drop 證據:** journal 顯示 `SELECT → set_config → ROLLBACK` 冇下文 = dedup early-return signature
4. **對比 watermark vs 真實 update_id:** watermark (392261560) > 用戶 update (392261543) → 確認被 dedup
5. **追溯點解 watermark 高:** 發現自己頭先測試 POST 嘅假 update_id 污染咗
6. **Loop 教訓:** 每次 reset 之後又用假 id 驗證 → 又污染 → 用戶再 drop。最終停晒所有模擬測試,set watermark 低過所有真實 id (392261542),叫用戶 send 真實訊息驗證

---

## 5. 解決方法 (Fix)

### Fix 1 — test ping guard (已 commit)
```python
# handle_webhook_update 入面,dedup check 之後:
# Real update_ids are ~1e6–4e8; anything >= 9e8 is a Telegram test ping.
if upd_id is not None and upd_id >= 900_000_000:
    return  # test ping — ignore entirely, keep watermark
```

### Fix 2 — send_message retry (parallel bug, 18:08 發現)
`telegram_service.send_message`:
- 3 次 retry (1.5s/3s backoff)
- 30s timeout (原本 15s)
- 429 處理 (`retry_after` 尊重)

### Fix 3 — watermark reset (操作修復)
```sql
-- 將 watermark set 低過 webhook log 入面所有真實 update_id
UPDATE nexus_crm.nexus_telegram_mappings
SET config = jsonb_set(config, '{tg_last_webhook_update_id}', '"392261542"'::jsonb)
WHERE status = 'active';
```

### ⚠️ 最終驗證方法 (最重要嘅教訓)
**唔好再用模擬 update_id 驗證!** 每個 realistic id (1e6–4e8) 嘅模擬 POST 本身就會污染 watermark。
正確做法:set watermark 低過所有真實 id → 叫用戶 send 一條真實訊息 → 睇 webhook log 有新 update → 確認 watermark 推進到佢 + `nexus_ai.messages` 有新 row + 用戶收到回覆。

---

## 6. 成功 log (Success Log) — 修復後

```
[2026-08-06T18:48:53.179468] update_id=392261550   ← 用戶 "hi" 到達
```
Journal:
```
18:48:53 POST /api/v1/telegram/webhook HTTP/1.1" 200 OK
18:48:53 INSERT INTO nexus_ai.messages ... (user, 'Question: hi')
18:48:54 POST /api/v1/ai/chat?session_id=... HTTP/1.1" 200 OK
18:48:54 INSERT INTO nexus_ai.messages ... (assistant, '您好,系統連線正常...')
18:48:55 UPDATE nexus_crm.nexus_telegram_mappings SET config=... (watermark -> 392261550)
18:48:55 COMMIT
```
✅ Watermark: 392261542 → 392261550 (推進 = 完整處理)
✅ 用戶收到 AI 回覆

---

## 7. 驗證 (Verification)

1. `tail -5 /tmp/telegram_webhook.log` → 有新真實 update_id
2. `journalctl -u nexus-crm.service --since "2 min ago" | grep -E "INSERT INTO nexus_ai.messages|COMMIT"` → 有 user + assistant INSERT
3. Watermark 推進到嗰個 update_id:
   ```sql
   SELECT config->>'tg_last_webhook_update_id' FROM nexus_crm.nexus_telegram_mappings WHERE status='active';
   ```
4. 用戶 Telegram 收到回覆

---

## 8. 預防 (Prevention)

1. **❌ 永遠唔好用 realistic update_id (1e6–4e8) 做模擬測試** — 用 `update_id: 1` (safe no-op) 或者叫用戶 send 真實訊息
2. **Reset watermark 後:**
   - 用 fresh session readback 確認
   - 等 60s 再 grep journal 有冇 competing `UPDATE nexus_telegram_mappings` (in-flight commit 會覆蓋 reset)
   - 先至 send 真實測試
3. **查 log 用啱表:** 真實 messages 表係 `nexus_ai.messages` (plain table);`nexus_ai.ai_messages` 係 partitioned parent + RLS,直接 query 會見到 0 rows (誤導!)
4. **RLS:** 冇 set `app.tenant_id`/`app.user_id` GUC 嘅 query 會被 RLS 靜默 filter → 用 `sudo -u postgres psql` 攞 ground truth
5. **systemd:** backend 係 `nexus-crm.service` (Restart=always, NRestarts=895!) — 唔好手動 kill + uvicorn restart (會 `Errno 98 address already in use`),用 `systemctl restart nexus-crm.service`,log 用 `journalctl -u nexus-crm.service`
6. **Logger:** `logging.getLogger("telegram_inbound")` 嘅 warning 可能冇 attach 到 journald — 「SELECT → ROLLBACK 冇 error」唔代表冇 exception
7. **長期根治 (Perplexity 建議):** 用 DB unique constraint on update_id (`INSERT ... ON CONFLICT DO NOTHING` 做 atomic claim) 或 Redis `SETNX update:{id} 1 EX <ttl>`,取代單調 watermark

---

## 9. 相關檔案 (Files Affected)

| 檔案 | 改動 |
|------|------|
| `backend/app/services/telegram_inbound.py` | test ping guard (`>= 900_000_000` return) |
| `backend/app/services/telegram_service.py` | send_message 3x retry + 30s timeout + 429 |
| `backend/app/routers/telegram.py` | (webhook endpoint,本身冇改) |
| `nexus_crm.nexus_telegram_mappings.config` | watermark 操作修復 |

## 10. 相關 Skill / Reference
- Skill: `debug-system` → entry **D035** (完整版)
- Reference: `debug-system/references/telegram-webhook-watermark-race-2026-08-06.md`
