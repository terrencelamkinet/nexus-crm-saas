# KB-008 — 讀經進度錯章（以西結書 6 vs 但以理書 3）+ 多 tenant 機制加固

> 日期：2026-08-26 · 版本：v7.02 · 狀態：已修復 ✅

## 症狀
- 用戶收到 05:01 靈修 push，顯示「以西結書 6:1-14」，但期望係「但以理書 3」
- 之前 08-25 已經投訴過一次「CRM briefing 亂了」（經文冇每日推進、morning push 被擋）

## 證據
- `bible_reading_progress` custom_pace row：`day_index=2, last_completed_at=2026-08-26 05:01:07`（= push 時間）
- `ai_secretary_settings.bible_reading`：`start_book=以西結書, start_chapter=5` ← **起點設錯**
- 用戶期望今日 = 但以理書 3（`_resolve_passages_for_day(start_book=但以理書, start_chapter=3, day_index=0)` 計算正確）

## Root Cause
1. **直接原因**：08-22 用戶 setup 讀經計劃時，`start_book/start_chapter` 設成「以西結書 5」而唔係用戶想要嘅「但以理書 3」→ 每日一章推進，08-26 出到以西結書 6
2. **機制缺陷（真正要修）**：`bible_reading_progress` 冇任何設定變更偵測 — 用戶改 settings（plan / book_selection / start_book / start_chapter / end_book / end_chapter / chapters_per_push）時，`day_index` 唔會 reset → 會跳章/錯章。任何 tenant 用戶都會中招。

## 修復
1. **數據修正**：`ai_secretary_settings` → `start_book=但以理書, start_chapter=3`；`bible_reading_progress` custom_pace → `day_index=0`
2. **機制加固（v7.02）**：
   - `bible_reading_progress` 加 `config_fingerprint VARCHAR(64)` column（migration `008_bible_progress_config_fingerprint.sql`）
   - `_bible_config_fingerprint()`：hash `plan|book_selection|start_book|start_chapter|end_book|end_chapter|chapters_per_push`
   - `bible_reading()`：progress row fingerprint 唔 match settings → 自動 `day_index=0` + sync `book_selection` + reset `last_completed_at`
   - legacy rows backfill `'legacy'`（正常 hash 唔會係呢個值 → 下次 generate 一定 reset）

## 驗證
- Integration test PASS（真 DB session）：
  - settings 但以理書3 → 今日經文 = 但以理書 3:1（cuv）✅
  - fingerprint match → day_index 保持（唔亂 reset）✅
  - 模擬改設定（馬太福音1）→ 經文即刻跳去馬太福音 1 + day_index=0 ✅
  - 改返真 settings → 自動校正返但以理書 3 ✅
- Scheduler dry-run：10 users scanned（所有 tenant）✅
- RLS 確認：`bible_reading_progress` FORCE RLS + `user_isolation_bible_progress`（user_id + tenant_id）✅；`bible_verses` 冇 RLS（靜態公開經文，所有 tenant 可讀 — 正確設計）✅
- UI 確認：AI Apps bible_reading module 已有完整設定（8 種 book_selection + start/end book/chapter + plan + chapters_per_push）✅

## 多 Tenant 使用（用戶要求：「其他 tenant 用戶也可以單獨使用」）
- Scheduler `run_scheduler()` iterate `nexus_auth_tenant_members` 全部 members，每個 user 獨立 set RLS GUC
- 每個 user 有自己嘅 `bible_reading_progress` row（tenant_id + user_id + plan unique）
- settings 變更 → fingerprint 唔 match → 自己嘅 day_index reset，唔影響其他人
- 冇 RLS 洩漏風險（progress 表 FORCE RLS）

## 預防
- 任何讀經進度相關 bug → 先查 `config_fingerprint` 有冇 match settings
- 用戶改讀經計劃後，第一日經文應該係新計劃嘅起點（day 0），唔係舊 day_index 繼續行
- UI 改 bible_reading settings 時會自動經 API 存落 `ai_secretary_settings.modules.bible_reading` — 唔好直接改 DB（會 bypass fingerprint sync 邏輯... 但下次 generate 都會偵測到，所以安全）
