# KB-007 — Multi-tenant 資料洩漏：Kinetix data 被複製入 FWD Life (Caleb) tenant

## 📅 日期 / 🔴 Severity / 📍 系統
- **日期:** 2026-08-25
- **Severity:** 🔴 Critical（security / 違反核心 tenant 隔離規則）
- **系統:** backend / DB（nexus_crm RLS + audit trigger）

## 1. 症狀 (Symptom) — 用戶見到咩 / 系統表現
用戶報告：**terrence_lam 帳戶嘅聯絡人、公司，其他帳戶都睇到** — 「所有嘅聯絡人、公司其他人也可以看到」。檢查發現：
- FWD Life (Caleb) tenant：**199 contacts + 100 companies + 54 projects + 124 tasks + 622 custom_field_values** 係 Kinetix data 嘅 copy（Caleb 自己嘅 data 得 1 contact + 3 companies）
- terrence (6d332a4a) 測試 tenant：2 contacts + 2 companies + 3 name_cards 係 Kinetix dup
- 其他 40+ tenant：0 洩漏

## 2. 問題 log (Error Log) — 實際 log 摘錄
`rls_audit_log` 證據（trigger 一直有記錄，但冇人睇）：
```
2026-07-31 15:46:49  companies UPDATE  ×100  detail: actual_tenant=6c5843c2 (Caleb), expected_tenant=(null), user_id=(null)
2026-07-31 15:46:49  contacts  UPDATE  ×199  detail: actual_tenant=6c5843c2, expected_tenant=(null)
2026-07-31 15:46:49  tasks     UPDATE  ×128  detail: actual_tenant=6c5843c2, expected_tenant=(null)
2026-07-31 15:46:49  projects  UPDATE  ×54   detail: actual_tenant=6c5843c2, expected_tenant=(null)
2026-08-18 15:01:36  tasks     UPDATE  ×4    detail: expected=00000000...0001 (Kinetix), actual=6c5843c2 / 50572cf8
```
`expected_tenant=(null)` + `user_id=(null)` = **superuser（postgres）直連寫入、冇 set session GUC**。

## 3. 成因 (Root Cause) — 根本原因
**RLS 本身有效**（驗證：Caleb 視角 1/3/7、Kinetix 206、冇 GUC 0 rows）— 問題係：
1. **superuser 直寫 bypass RLS**：`sudo -u postgres psql` 或 superuser script 寫入任何 tenant 都唔受 RLS 限制（FORCE RLS 都 bypass）
2. **`rls_check_violation` trigger 只 audit 唔 block**：有記錄 `NEW.tenant_id != session GUC` 嘅寫入，但 `v1_allowed=true` 照放行 → 記錄咗但冇人監控 → 洩漏持續 25 日
3. 07-31 嘅操作係**手動 SQL**（git 無 commit 對應）— 一次性人為錯誤將 Kinetix rows 嘅 tenant_id UPDATE 成 Caleb

## 4. 解決過程 (Debug Process) — 點樣搵到
1. 用戶報告洩漏 → scan 所有 tenant 嘅 contacts/companies 同 Kinetix 重複（email/name join）
2. 確認 Caleb tenant 199+100 dup（2026-07-28 created_at / 07-31 audit 記錄）
3. 追 source：git log 07-31 附近無 commit → 手動操作；`rls_audit_log` 有完整證據（trigger 一直記錄緊）
4. 驗證 RLS 有效（SET ROLE nexus_briefing + 各 tenant GUC 測 count）— 排除 RLS 失效
5. 發現 `rls_check_violation` 係 audit-only → 升級做 block 模式

## 5. 解決方法 (Fix) — 具體修復步驟
### 5a. 清走洩漏 data（backup: /tmp/leak_backup_20260825.sql）
```sql
-- Caleb tenant：先刪 children 再刪 parent（FK 順序）
DELETE FROM nexus_crm.custom_field_values WHERE tenant_id='6c5843c2...';
DELETE FROM nexus_crm.tasks WHERE tenant_id='6c5843c2...' AND title IN (SELECT title FROM nexus_crm.tasks WHERE tenant_id=KINETIX);
DELETE FROM nexus_crm.touchpoints / deals / quotations / quotes WHERE tenant_id='6c5843c2...';
DELETE FROM nexus_crm.projects WHERE tenant_id='6c5843c2...' AND name IN (Kinetix names);
DELETE FROM nexus_crm.contacts WHERE tenant_id='6c5843c2...' AND (email OR name IN Kinetix);
DELETE FROM nexus_crm.companies WHERE tenant_id='6c5843c2...' AND name IN (Kinetix names);
-- terrence (6d332a4a) 同 pattern
```
結果：Caleb 淨返 1 contact（Wong Ka Ming）+ 3 companies + 4 tasks；Kinetix 完整（206/110/151/56）。

### 5b. Trigger 升級 block 模式（核心防護）
```sql
CREATE OR REPLACE FUNCTION nexus_crm.rls_check_violation() RETURNS trigger ...
IF NEW.tenant_id IS DISTINCT FROM NULLIF(_tid,'')::uuid THEN
    INSERT INTO rls_audit_log(...) VALUES (..., v2_blocked=true, blocked=true);
    _bypass := current_setting('app.allow_tenant_mismatch', true);
    IF COALESCE(_bypass,'') != 'on' THEN
        RAISE EXCEPTION 'RLS tenant mismatch blocked: %.% tenant=% expected=%', ...;
    END IF;
END IF;
```
- **Bypass（maintenance/restore 專用）**：`SET app.allow_tenant_mismatch = on`（restore 冇 GUC 會撞 trigger，必須 set）
- 測試 4 項 PASS：正常 app 寫入 OK / GUC mismatch BLOCK / superuser 無 GUC BLOCK / bypass 成功

### 5c. 監控 cron
`~/.hermes/scripts/tenant_leak_scan.sh` + cron `tenant-leak-scan`（每日 09:00，watchdog）：
- Check 1: 非 Kinetix tenant 同 Kinetix contacts/companies 大量重複（≥5）→ alert
- Check 2: rls_audit_log 24h 內新跨 tenant 寫入記錄 → alert

## 6. 成功 log (Success Log) — 修復後嘅正常 log
```
RLS tenant mismatch blocked: nexus_crm.contacts tenant=6c5843c2... expected=00000000...0001
```
（TEST 2 實測 — 跨 tenant INSERT 被 RAISE EXCEPTION 擋）

## 7. 驗證 (Verification) — 點確認真係修好
- 全庫 scan：contacts/companies/projects/tasks/deals 跨 tenant dup = **0**
- RLS 三連測：Caleb GUC → 1/3/7；Kinetix GUC → 206；無 GUC → 0
- Trigger 4 項測試全 PASS（見 5b）
- `tenant_leak_scan.sh` 空輸出 = 乾淨

## 8. 預防 (Prevention) — 點避免再犯
1. **任何直接寫 DB 操作**（script/psql）必須：set GUC + INSERT/UPDATE 用 explicit tenant_id
2. **Superuser 直寫**：先 `SET app.allow_tenant_mismatch = on`（有 audit trail）先寫
3. 寫完**檢查 rls_audit_log** 有冇意外記錄（`SELECT * FROM rls_audit_log ORDER BY created_at DESC LIMIT 5`）
4. 每日 cron `tenant-leak-scan` 自動監控（09:00，有問題先 alert）
5. 測試 script 用獨立測試 tenant，唔好共用 Kinetix GUC

## 9. 相關檔案 (Files Affected)
- `nexus_crm.rls_check_violation()` — trigger function（audit-only → block 模式）
- `nexus_crm.rls_audit_log` — 跨 tenant 寫入記錄（v2_blocked 而家會 = true）
- `~/.hermes/scripts/tenant_leak_scan.sh` — 每日洩漏監控
- Skill: `g08-red-team-tenant-security`（已更新 §2026-08-25 洩漏事件 + Trigger Block 加固）
- Backup: `/tmp/leak_backup_20260825.sql`（清理前完整 dump）
