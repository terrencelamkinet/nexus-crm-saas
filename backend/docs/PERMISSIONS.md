# G08 AI 權限模型 — 邊界原則（2026-08-22 確立）

> **Terrence 原則（原話）**：Tenants 內所有內容加減應該都可以；系統框架、內容不能修改。

即係：**AI 對 tenant 自己嘅 CRM 內容（contacts/companies/projects/tasks/deals/touchpoints/namecards）有完整 read + write（draft→confirm）能力；但系統框架 — config、settings、credentials、schema、platform 表 — AI 一律掂唔到。**

## 權限模型總覽

```
EffectivePermission = ToolExists(whitelist) ∩ SystemBoundary(CRM layer only)
                    ∩ AgentGrant(ai_agent_permissions, default deny)
                    ∩ TenantEditGate(module_settings.ai.allow_edit, write only)
                    ∩ TenantScope(tenant_id/workspace_id match)
                    ∩ DataIdInTenant(write tools: IDs resolve inside tenant)
```

## 層層檢查（guard.py `authorize_tool_call` 執行順序）

1. **Tool 存在** — 只可 call `TOOL_REGISTRY`（code 內 17 個，單一 source）
2. **System boundary** — tool 嘅 `module` 必須以 `app.services.crm` 開頭；任何 system module（config/settings/credentials）→ `system_module_out_of_bounds`。將來誤加 system tool 落 registry 都會即刻被擋
3. **Agent permission** — session 綁定 agent 時，必須有 `ai_agent_permissions` grant（tool_key 或 `'*'` + module exact/prefix + read→can_read / write→can_write）；冇 grant → default deny
4. **Tenant edit gate** — write tools 要 tenant 開咗 `allow_edit`（AI Apps settings）
5. **Tenant / workspace scope** — 參數內 tenant_id/workspace_id 必須 match session context
6. **Data-ID verification** — write tools 嘅 contact_id/company_id/… 必須 resolve 喺同 tenant（防跨租戶寫入）

## Agent 權限表（已 seed 2026-08-22）

| Agent | Scope | 權限 |
|---|---|---|
| personal_assistant | private | 全部 17 tools（read + write draft） |
| team_sales_assistant | team | 全部 17 tools（read + write draft） |
| daily_briefing | workspace | 8 read only |
| widget_insight | workspace | 8 read only |

## AI 可觸達 surface 審計（2026-08-22）

- **AI tools**：17 個全 CRM 內容操作，冇 system tools ✅
- **AI routes**（/chat, /tools/*/execute, /actions/*, /sessions）：全 tenant-scoped，冇 system 修改路徑 ✅
- **/prompts（GET/POST）**：tenant-scoped prompt template 管理 — tenant 自己內容，AI 冇 tool 觸發；人類前端用
- **module_settings**：tenant 設定（人類改），AI 只讀（guard 讀 allow_edit）✅
- **provider_credentials**：加密 at rest（見 SECRETS.md），AI 冇 tool 觸發 ✅

## 已知限制

1. `max_scope`（private/team/workspace 分級）未有 record-level enforcement — CRM tables 未有 workspace_id/team_id columns，需 data model migration 先行
2. `agent_id` session binding middleware 未接 — 而家全部 user-direct session（agent permission check 已 ready，一旦綁定即刻生效）
3. RBAC role 分級未做（成個 system 係 tenant-scoped JWT 模式）— 符合「tenant 內全權」原則，暫無需 role

## 新增 AI tool 嘅 check-list

1. Tool 必須操作 tenant 內容（module 以 `app.services.crm` 開頭）
2. 加入 `TOOL_REGISTRY`（code）後，同步 seed `ai_tool_registry`（`INSERT ... ON CONFLICT DO NOTHING`）
3. 按 agent 需要喺 `ai_agent_permissions` 加 grant（read/write 分開）
4. Write tool：行 draft→confirm 流程 + `requires_confirmation=True`
5. 跑 guard 測試確認 boundary + permission 兩層都過
