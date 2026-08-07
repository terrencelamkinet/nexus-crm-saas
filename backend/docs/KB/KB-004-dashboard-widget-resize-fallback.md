# KB-004 — Dashboard Widget Resize: Width/Height 只改 DOM 唔 Save, Reload 即 Fallback

## 📅 日期 / 🔴 Severity / 📍 系統
- **日期:** 2026-08-07
- **Severity:** 🟠 High — 用戶 resize widget 寬度/高度, reload 後全部回復 default span
- **系統:** G08 NEXUS CRM frontend (`src/pages/DashboardNew.tsx`)

---

## 1. 症狀 (Symptom)

- Edit mode 拖 resize-grip 改 widget 寬度 → 當下睇到變闊 ✅
- **Refresh 之後 width 全部 fallback 返 default span**（例如 kpi 卡 span 6、pipeline span 8）
- Height 一樣 fallback
- Save 冇 error, network 有 PUT,但 payload 根本冇 width/height 資料

**Signature:** `PUT /module-settings/dashboard` body 只有 `{widgetOrder:[...]}`,冇任何 size 欄位

---

## 2. 問題 log (Error Log) — 實際摘錄

```
修復前 (resize kpi_contacts 6→8 之後):
  PUT /module-settings/dashboard  body: {settings:{widgetOrder:[...16 keys]}}
                                                  ↑ 只有 order,冇 widgetSpans / widgetHeights
  reload 後:
  kpi_contacts gridColumn: "span 6"   ← fallback 返 default

修復後:
  PUT body: {settings:{widgetOrder:[...], widgetSpans:{kpi_contacts:8}, widgetHeights:{kpi_contacts:200}}}
  reload 後:
  kpi_contacts gridColumn: "span 8" ✅  offsetWidth 631px ✅  height 200px ✅
  reload 期間 PUT 次數: 0 (無 write-back)
```

---

## 3. 成因 (Root Cause)

**Resize-grip 係「DOM-only」操作,完全冇入 React state / save payload:**

```tsx
// 1. effSpan 永遠由 default 決定 — 冇 per-widget override state
const effSpan = isKpi && isCompact ? 6 : def.span

// 2. resize handler 直接改 DOM style,唔 setState
const onMove = (ev) => {
  widgetEl.style.gridColumn = `span ${currentSpan}`   // ← 純 DOM
  widgetEl.style.height = `${newH}px`                  // ← 純 DOM
}
const onUp = () => {
  document.removeEventListener(...)                    // ← 只清 listeners,冇 commit
}

// 3. save payload 只有 order
settings: { widgetOrder: order }                       // ← 冇 spans / heights
```

**機制:** resize 期間用戶睇到嘅 width 係 DOM inline style 即時效果;但 React state 完全唔知 → save 唔到 → 任何 reload 都用返 `def.span` default render → fallback。

---

## 4. 解決過程 (Debug Process)

1. 用戶報告「refresh 後 widget width 又 fallback」→ 確認 production build 已含 v4.4 fix（hash `index-DddaEk6W.js`,13:45 build）
2. 讀 `DashboardNew.tsx`:發現 `effSpan = def.span` 冇任何 override source;resize-grip 只有 `onMouseDown` + DOM manipulation
3. `onUp` 只 removeEventListener → 確認 resize 結果冇 commit 去任何 state
4. Save effect payload 只有 `widgetOrder` → 確認 width/height 根本冇得 save
5. Browser 實測（synthetic mousedown/mousemove/mouseup）:gridColumn 即時變 span 8,但 PUT payload 冇 size → 確認 root cause

---

## 5. 解決方法 (Fix)

`src/pages/DashboardNew.tsx`:

```tsx
// 1. 新增 per-widget override state（只有用戶 resize 過嘅先有 entry）
const [spans, setSpans] = useState<Record<string, number>>({})
const [heights, setHeights] = useState<Record<string, number>>({})

// 2. loadAll: 讀返 server settings（skipSaveRef 一併 cover）
if (dash?.settings) {
  skipSaveRef.current = true
  if (dash.settings.widgetOrder?.length) setOrder(dash.settings.widgetOrder)
  if (dash.settings.widgetSpans) setSpans(dash.settings.widgetSpans)
  if (dash.settings.widgetHeights) setHeights(dash.settings.widgetHeights)
}

// 3. save effect: payload 加 size（deps 加 spans/heights）
settings: { widgetOrder: order, widgetSpans: spans, widgetHeights: heights }
}, [order, spans, heights])

// 4. render: effSpan 用 override, height 用 override
const effSpan = spans[k] ?? (isKpi && isCompact ? 6 : def.span)
style={{ gridColumn: `span ${effSpan}`, height: heights[k] ?? undefined, ... }}

// 5. resize onUp: commit 入 state（mouseup 一次過,唔會 per-move re-render）
const onUp = () => {
  document.removeEventListener('mousemove', onMove)
  document.removeEventListener('mouseup', onUp)
  setSpans(prev => ({ ...prev, [k]: currentSpan }))
  setHeights(prev => ({ ...prev, [k]: finalH }))
}
```

**設計要點:**
- **onUp 先 commit**,drag 期間只改 DOM → 唔會每次 mousemove re-render 成個 dashboard（82KB component）
- Override map 係 sparse — 只有 resize 過嘅 widget 有 entry,default 行為完全唔變
- Backend `settings` 係 freeform JSON → 唔使改 backend
- 同一 tick 內 setOrder+setSpans+setHeights → React batch → save effect 跑一次 → skipSaveRef consume 一次 → 唔會誤 write-back

**6. 後續 fix — reload 第一下 flash default size（v4.6）**

用戶反映:reload 後第一下見到 default size,再跳去設定 size。原因:mount 時 `spans={}` 先 render 一次,GET 返到先 setSpans。

```tsx
// layoutReady gate — grid 喺 server layout load 完先 render
const [layoutReady, setLayoutReady] = useState(false)

// loadAll 完成（成功/失敗都 set）:
orderLoaded.current = true
setLayoutReady(true)   // 同 setOrder/setSpans/setHeights 同一 tick batch

// render: grid 包 gate
{layoutReady && (
  <div ref={gridRef} className="grid" ...>
    ...
  </div>
)}
```

效果:grid 首次 render 已經係正確 size（settings 已 load）,完全冇 default→custom 嘅 flash。代價:grid 延遲 ~1 個 GET round-trip 先出現（toolbar 照常即刻顯示）。

**7. 後續 fix — height 指定 size snap（v4.7）**

用戶要求:height 都要好似 width 咁有「指定 size」,唔係自由像素。加入 `HEIGHT_STEPS` snap 系統:

```tsx
// 檔位:160 / 240 / 320 / 400 / 480 px（mirror width 嘅整數 span snap）
const HEIGHT_STEPS = [160, 240, 320, 400, 480]

// onMove 內:height snap 去最近 step
const rawH = startH + dy
let snappedH = HEIGHT_STEPS[0]
for (const s of HEIGHT_STEPS) {
  if (Math.abs(rawH - s) < Math.abs(rawH - snappedH)) snappedH = s
}
// drag 期間 grip 上方顯示 size badge（如 "320px"）,mouseup 移除
```

效果:垂直 drag 會喺固定檔位之間跳（160→240→320→400→480）,drag 期間有 badge 顯示當前 size。保存/還原鏈路同 width 一樣（widgetHeights）。

實測:200px drag +90px → rawH 290 → snap 320 ✅;reload 後 height 320px 留住 ✅

---

## 6. 成功 log (Success Log) — 修復後

```
Browser 實測 (synthetic drag kpi_contacts +180px):
  afterDrag: gridColumn "span 8", height "200px"
  PUT body: {"widgetOrder":[...16],"widgetSpans":{"kpi_contacts":8},"widgetHeights":{"kpi_contacts":200}}
  reload 後: gridColumn "span 8" ✅  offsetWidth 631 ✅  height 200px ✅
  reload 後 PUT 次數: 0 ✅ (skipSaveRef 完好)
```

---

## 7. 驗證 (Verification)

1. `npx tsc --noEmit` 0 errors
2. `npm run build` pass（新 hash `index-DddaEk6W.js` serve 緊）
3. Browser production 實測:resize → PUT payload 含 widgetSpans/widgetHeights → reload → span/height 留住
4. Reload 後 network 0 個 dashboard PUT（無 write-back regression）

---

## 8. 預防 (Prevention)

1. **任何「用戶直接改 DOM style」嘅交互,一定要 commit 返去 React state** — DOM 係 render 嘅 output,唔係 state
2. **Save payload 必須包含所有用戶可改嘅屬性** — widgetOrder + widgetSpans + widgetHeights 一個唔少
3. Resize/拖拽類交互:mouseup 先 commit state,避免 per-move re-render 效能問題
4. 測 resize 一定要 reload 驗證,唔好淨係睇當下 DOM

---

## 9. 相關檔案 (Files Affected)

| 檔案 | 改動 |
|------|------|
| `src/pages/DashboardNew.tsx` | +spans/heights state, load/save/render/resize 全鏈路 |
| `VERSION` | v4.4 → v4.5 |

---

## 10. 相關 Skill / Reference
- Skill: `quality-check-output` — claim 必須 browser/network 實測（今次用 synthetic mouse events + fetch 攔截驗證）
- 相關: KB-003（同一 dashboard save 鏈路,skipSaveRef pattern 沿用）
