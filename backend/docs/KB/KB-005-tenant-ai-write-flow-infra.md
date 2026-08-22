# KB-005 — 新 Tenant AI Write Flow 壞：AI 只出草稿、回「確認」無限循環

## 📅 日期 / 🔴 Severity / 📍 系統
- **日期:** 2026-08-22
- **Severity:** 🔴 Critical（IM 渠道 AI 寫入功能完全失效）
- **系統:** backend（AI confirm flow / guard / tenant infra）

## 1. 症狀 (Symptom)
- Telegram 問「幫我開個 task XXX」→ AI 出草稿（text 內含「✍️/📋 草稿摘要」）
- 用戶 reply「確認」→ **冇執行**，AI 當普通訊息 → 又出一份新草稿 → **無限循環**
- `/chat` response 有 `text` 草稿，但 **`action` envelope = `None`**
- 即使 action 出到，confirm 時可能 500：`ForeignKeyViolationError: tasks_workspace_id_fkey`

## 2. 問題 log (Error Log)
```
# 症狀 A：action envelope 從未出現（/chat response）
{"text": "收到。請確認以下任務內容：...", "action": null}

# 症狀 B：confirm 500
sqlalchemy.exc.IntegrityError: insert or update on table "tasks"
violates foreign key constraint "tasks_workspace_id_fkey"
```

## 3. 成因 (Root Cause)
**兩個獨立 infra 缺失，令 confirm flow 斷兩截：**

1. **Tenant 冇開 AI 編輯權限** → draft 出唔到
   - `app/ai/tools/guard.py: _ai_edit_allowed()` 查 `nexus_crm.module_settings`
     `WHERE module_key='ai'`，要 `settings.allow_edit == true`
   - Tenant 冇 row → `False` → `ScopeViolation("AI editing is disabled")`
   - `_fallback_draft_task` 返回 `{"error": ...}` → caller 見到 `"error"` key
     就當 `action = None` → **`pending_action_id` 從未存入 mapping.config**
   - 用戶 reply「確認」→ `_handle_pending_action_reply` 見無 pending →
     當普通訊息 → AI 又出 draft → 無限循環

2. **Tenant 冇 workspace** → confirm 執行爆 FK
   - `app/ai/session/context.py: build_ai_session_context()`：
     - 先查 `workspace_members`（**呢張表根本唔存在** → exception）
     - fallback 查 `nexus_auth.workspaces WHERE tenant_id=:tid LIMIT 1`
     - Tenant 冇 workspace → `uuid.UUID(int=0)` sentinel（`00000000-...`）
   - `_create_task_draft` execute mode 直接 `workspace_id=ctx.workspace_id`
     → insert `tasks` 時 FK violation（sentinel 唔存在於 nexus_auth.workspaces）

**點解 WhatsApp 正常、Telegram 壞：** WhatsApp mapping 嘅 tenant 係
`00000000-0000-0000-0000-000000000001`（有 allow_edit + Default Workspace）；
Telegram 用 Kinetix tenant（`edc6add4-...`，兩樣都缺）。

### 後續發現（同日，用戶實測仍然 fail 後再挖）：

3. **Webhook stale-config overwrite（致命）** — `telegram_inbound.handle_webhook_update`
   喺 `process_update()` **之前** capture `cfg = dict(mapping.config)`，process_update
   入面 `handle_telegram_message` 存入 `pending_action_id` + `ai_session_id` 落 DB，
   之後 handle_webhook_update 用舊 `cfg` 覆寫 `mapping.config` + commit →
   **每次 webhook update 都沖走 pending_action_id**（連 ai_session_id 都冇埋，
   config 淨返 watermark）。用戶「確認」永遠搵唔到 pending → 無限循環。
   Fix：process_update 後 re-load fresh row，只 merge watermark（commit `16e7ce8`）。

4. **Draft-summary parser 唔 match markdown bold** — AI 慣性出
   `- **任務標題**：xxx`（標籤同冒號之間有 `**`），但 regex 寫死
   `任務標題\s*[：:]` → parser return None → action 從未建立。
   Fix：`\s*\**\s*[：:]` 允許中間有 `*`（commit `d714d9c`）。
   同日加埋：中文日期格式（`2025年9月15日`）+ AI 年份提示
   （prompt 註明「現在日期 2026年8月22日 HKT，冇年份一律用今年」—
   AI 曾將「9月15日」錯判做 2025）。

**完整修復鏈（4 commits）:** infra (allow_edit+workspace) → confirm words 加寬
(`3219b0f`) → webhook stale overwrite (`16e7ce8`) → parser markdown/日期/年份
(`d714d9c`)。

## 4. 解決過程 (Debug Process)
1. 查 `nexus_crm.nexus_telegram_mappings.config` → `pending_action_id = None`
   但 `ai_session_id` 存在 → 用戶有傾偈但 pending 從未存入
2. 睇 session messages → AI 每次 reply 都喺 text 寫「**草稿摘要：**」，
   用戶回「確認」/「Go」後又出新 draft → 確認 loop 被當普通訊息
3. 直接 call `/chat`（channel=telegram）→ `action: None`
4. 單測 `_extract_task_draft_params` → 有 title，regex 正常
5. 睇 `guard.py` → `_ai_edit_allowed` 查 `module_settings` → Kinetix 冇 row
   （其他 4 個 tenant 都有 allow_edit=True）
6. 補 allow_edit 後 draft 出到，但 confirm 500 → `tasks_workspace_id_fkey`
7. 查 `nexus_auth.workspaces` → Kinetix 冇 workspace → sentinel 全零 → FK 爆
8. 補 Default Workspace → 全流程通過

## 5. 解決方法 (Fix)
```sql
-- ① 開 AI 編輯權限（tenant 冇 row 先要 insert；有就 UPDATE settings）
INSERT INTO nexus_crm.module_settings (id, tenant_id, module_key, enabled, settings)
VALUES (gen_random_uuid(), '<tenant_id>', 'ai', true, '{"allow_edit": true}');

-- ② 建 Default Workspace（tenant 冇 workspace 先要做）
INSERT INTO nexus_auth.workspaces (id, name, tenant_id)
VALUES (gen_random_uuid(), 'Default Workspace', '<tenant_id>');
```
兩個都係 data fix，唔使改 code、唔使 restart。

## 6. 成功 log (Success Log)
```
1. DRAFT: create_task_draft 2291bfa2
2. CONFIRM status: 200
   result: {"action": "create_task", "title": "跟進 SYSTEX 報價", "priority": "high",
            "status": "pending", "validated": true, "id": "c917ab09-..."}
```

## 7. 驗證 (Verification)
1. `SELECT tenant_id, settings FROM nexus_crm.module_settings WHERE module_key='ai'`
   → 有 `{"allow_edit": true}`
2. `SELECT id, name FROM nexus_auth.workspaces WHERE tenant_id='<tenant_id>'`
   → 有 row
3. call `/api/v1/ai/chat`（channel=telegram）→ response 有 `action.action_id`
4. call `/api/v1/ai/actions/{id}/confirm` → 200 → `nexus_crm.tasks` 出現新 task

## 8. 預防 (Prevention)
- **新 tenant onboarding 必查兩樣：**
  - `nexus_crm.module_settings`（ai / allow_edit）
  - `nexus_auth.workspaces`（至少一個 Default Workspace）
- 診斷捷徑：IM 渠道 AI 出草稿但回「確認」冇反應 → 先查 `pending_action_id`
  有冇存入 mapping.config → 冇即係 action envelope 被 guard 拒 → 查 allow_edit
- `build_ai_session_context` 嘅 sentinel workspace_id（`uuid.UUID(int=0)`）
  係隱形炸彈：任何 tenant 冇 workspace 都會喺 write tool 執行時爆 FK。
  長遠應改為：ctx.workspace_id 唔可以用 sentinel，要明確 error 或 fallback 到
  真實 workspace。

## 9. 相關檔案 (Files Affected)
- `backend/app/ai/tools/guard.py` — `_ai_edit_allowed`（module_settings gate）
- `backend/app/ai/session/context.py` — `build_ai_session_context`（workspace fallback）
- `backend/app/ai/tool_registry.py` — `_create_task_draft`（workspace_id 直接寫入）
- `backend/app/services/telegram_inbound.py` — pending_action_id 存取
- `backend/app/routers/ai.py` — `_fallback_draft_task`（error 被當 None）
