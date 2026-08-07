# KB-003 — Dashboard Widget Save: 每次 Load 重複寫入 + Stale GET 靜默 Revert

## 📅 日期 / 🔴 Severity / 📍 系統
- **日期:** 2026-08-07
- **Severity:** 🟠 High — widget 改動有時「save 咗都唔見」（靜默 revert），且每次 dashboard load 都無謂寫入 DB
- **系統:** G08 NEXUS CRM frontend (`src/pages/DashboardNew.tsx` + `backend/app/routers/crm_module_settings.py`)

---

## 1. 症狀 (Symptom)

- 用戶加 widget / 排 widget 順序 → 表面 save 成功 → 但某啲情況下 reload 後改動唔見咗（被靜默 revert）
- Dashboard 每次 load 都會觸發一次 `PUT /api/v1/crm/module-settings/dashboard`（重複寫入相同 order）
- Save 完全靜默（`catch { /* silent */ }`）— 用戶冇任何成功/失敗 feedback

**Signature:** network log 出現兩次相同 body 嘅 PUT（一次係用戶動作，一次係 load 之後）

---

## 2. 問題 log (Error Log) — 實際摘錄

Playwright 實測（加一個 widget 後等 3s + reload）：

```
修復前:
  PUT /module-settings/dashboard  body: {widgetOrder:[...13 keys]}        ← 用戶加 widget 後 (200)
  GET /module-settings (reload, 3 個 component 同時 fetch)
  PUT /module-settings/dashboard  body: {widgetOrder:[...13 keys]}        ← reload 後重複寫入 (200)
  兩個 PUT body 相同 — 每次 load 都寫一次

修復後:
  PUT /module-settings/dashboard  body: {widgetOrder:[...16 keys]}        ← 只有用戶動作 (200)
  之後 reload → 冇第二個 PUT ✅
```

---

## 3. 成因 (Root Cause)

`DashboardNew.tsx` 嘅 save effect 冇分辨「order 係用戶改定係 server load 返嚟」:

```tsx
// loadAll() — mount / modules-changed 事件觸發
setOrder(dash.settings.widgetOrder)   // ← server 數據 setState

// save effect — [order] 依賴
useEffect(() => {
  if (!orderLoaded.current) return
  clearTimeout(saveTimer.current)
  saveTimer.current = setTimeout(async () => {
    await apiClient.put('/api/v1/crm/module-settings/dashboard', { settings: { widgetOrder: order } })
  }, 1500)
}, [order])
```

**機制:**
1. `loadAll()` 用 server 數據 `setOrder()` → 新 array reference → React state 改變 → save effect 觸發
2. Effect 唔知呢個 order 係 load 返嚟，照樣 debounce 之後 PUT 寫返落 DB → **每次 load 都重複寫入**
3. **Race:** 如果用戶改 order 之後，一個較早發出嘅 GET（stale response，未含用戶最新改動）喺用戶 PUT commit 前返到 → `setOrder(舊)` → 觸發另一個 PUT 寫返**舊 order** → 用戶改動被靜默 revert → 用戶以為 save 壞咗

**根本問題:** 用「state 改變」做 save trigger，但冇 track 呢個改變係咪用戶發起。Server load 同用戶 action 都係 setState — effect 分唔開。

---

## 4. 解決過程 (Debug Process)

1. **Playwright 實測加 widget 流程** — network monitor 發現兩次相同 body 嘅 PUT
2. **對比時間線** — 第二個 PUT 喺 reload 嘅 GET 完成 ~1.5s 後出現 → 確認係 loadAll → setOrder → effect → PUT
3. **確認 403 係假警報** — raw fetch 冇 JWT header 先 403；app 自己嘅 apiClient GET 全部 200
4. **確認 save 本身 work** — PUT 200 + reload 後 widget 仲喺度 → 問題係重複寫入 + race 窗口
5. **設計 fix** — skipSaveRef: load 設定 order 時 mark skip，effect 見到 skip 就唔 save

---

## 5. 解決方法 (Fix)

`src/pages/DashboardNew.tsx`:

```tsx
// 1. 新 ref
const skipSaveRef = useRef(false)

// 2. loadAll() 設定 order 前 mark skip
if (dash?.settings?.widgetOrder?.length) {
  skipSaveRef.current = true
  setOrder(dash.settings.widgetOrder)
}

// 3. save effect 開頭檢查 skip（consume 一次）
useEffect(() => {
  if (!orderLoaded.current) return
  if (skipSaveRef.current) { skipSaveRef.current = false; return }
  clearTimeout(saveTimer.current)
  saveTimer.current = setTimeout(async () => { ... }, 600)   // 1500 → 600
  return () => clearTimeout(saveTimer.current)
}, [order])
```

- Server-load 嘅 order 永遠唔會觸發寫回
- Debounce 1500 → 600ms：縮短「改完即 reload」嘅流失窗口
- 用戶動作（addWidget / removeW / moveW / drag end）全部照舊 save

---

## 6. 成功 log (Success Log) — 修復後

```
Playwright 實測:
  PUT requests: 1 (只有用戶動作) ✅
  PUT responses: [200] ✅
  加 widget: keys 15 → 16 → reload 後 16 keys 全部留住 ✅
```

---

## 7. 驗證 (Verification)

1. Playwright 全流程（login → edit mode → 加 widget → 3s → reload）: PUT 得 1 次
2. Reload 後 widget order 同 DB 一致
3. `npx tsc --noEmit` 0 errors + build pass
4. 重複 3 次確認無 flaky

---

## 8. 預防 (Prevention)

1. **任何「state 改變 → 自動 save」嘅 pattern 必須分辨來源** — server load vs user action 要用 ref flag 分開，否則 load 會觸發 write-back
2. **自動 save 唔好靜默失敗** — 起碼 console warn / retry，用戶層面要有 save 狀態指示（saving / saved / error）
3. **Debounce 唔好太長** — 1500ms 令「改完即刻離開頁面」嘅流失窗口太大；600ms 平衡
4. **測試自動 save 一定要查 network** — build pass 唔等於 save 正確，要數 PUT 次數

---

## 9. 相關檔案 (Files Affected)

| 檔案 | 改動 |
|------|------|
| `src/pages/DashboardNew.tsx` | skipSaveRef + debounce 1500→600 |

---

## 10. 相關 Skill / Reference
- Skill: `quality-check-output` — claim 必須 browser/network 實測（今次用 Playwright network monitor 驗證）
- 相關: `nexus-crm-development` — module-settings API pattern
